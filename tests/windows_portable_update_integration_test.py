"""Real Windows process/port regression for the portable updater.

All executables, ports, configuration and update files belong to a temporary
fixture. No installed App, real gateway, account data or system proxy is used.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile


PROGRAM = r'''
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
public class Fixture {
  public static int Main(string[] args) {
    string kind = args.Length == 0 ? "" : args[0];
    if (kind == "--hold") { Thread.Sleep(120000); return 0; }
    if (kind == "--child") {
      string stop=Environment.GetEnvironmentVariable("FIXTURE_CHILD_STOP");
      for (int i=0;i<300 && !File.Exists(stop);i++) Thread.Sleep(100);
      return 0;
    }
    if (kind == "--gateway" || kind == "openclaw.mjs") {
      var listener=new TcpListener(IPAddress.Loopback,Int32.Parse(Environment.GetEnvironmentVariable("FIXTURE_PORT")));
      try { listener.Start(); } catch (SocketException) { return 2; }
      var child=Process.Start(Environment.GetEnvironmentVariable("FIXTURE_CHILD_EXE"),"--child");
      File.WriteAllText(Environment.GetEnvironmentVariable("FIXTURE_CHILD_PID"),child.Id.ToString());
      Thread.Sleep(120000); return 0;
    }
    if (kind.StartsWith("--update-health-token=")) {
      int port=Int32.Parse(Environment.GetEnvironmentVariable("FIXTURE_PORT"));
      bool oldUi=Environment.GetEnvironmentVariable("FIXTURE_EXTERNAL_REAPPEARS")=="1";
      TcpListener listener=null;
      if (oldUi) {
        // The actual App can load an old gateway's page and then signal health.
        Thread.Sleep(8000);
        try { using (var connection=new TcpClient()) connection.Connect(IPAddress.Loopback,port); }
        catch (SocketException) { return 2; }
      } else {
        listener=new TcpListener(IPAddress.Loopback,port);
        try { listener.Start(); } catch (SocketException) { return 2; }
      }
      string token=kind.Substring("--update-health-token=".Length);
      string marker=Path.Combine(Environment.GetEnvironmentVariable("PINKIE_STATE_ROOT"),"updates","health",token+".ready");
      File.WriteAllText(Environment.GetEnvironmentVariable("FIXTURE_NEW_PID"),Process.GetCurrentProcess().Id.ToString());
      File.WriteAllText(marker,"ready");
      string stop=Environment.GetEnvironmentVariable("FIXTURE_CHILD_STOP");
      for (int i=0;i<300 && !File.Exists(stop);i++) Thread.Sleep(100);
      if (listener!=null) listener.Stop(); return 0;
    }
    return 0;
  }
}
'''

CALLER = r'''
import json
import os
from pathlib import Path
import sys
repo,exe,payload,digest,result=sys.argv[1:]
sys.path.insert(0,repo)
import app.windows_desktop as desktop
desktop.GATEWAY_URL='http://127.0.0.1:'+os.environ['FIXTURE_PORT']+'/'
WindowsUpdater=desktop.WindowsUpdater
exe=Path(exe);payload=Path(payload)
updater=WindowsUpdater(exe.parent/'_internal',executable=exe)
assert updater.portable
updater.prepared={'payload':payload,'sha256':digest,'version':'9.9.9'}
outcome=updater.launch_replacer()
Path(result).write_text(json.dumps(outcome),encoding='utf-8')
raise SystemExit(0 if outcome.get('started') else 1)
'''

ACL_FIXTURE = r'''
param([string]$Folder,[string]$Saved,[string]$Action)
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$ErrorActionPreference='Stop'
$acl=Get-Acl -LiteralPath $Folder
if ($Action -eq 'deny') {
  [IO.File]::WriteAllText($Saved,$acl.Sddl)
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,
    [Security.AccessControl.FileSystemRights]::CreateFiles,
    [Security.AccessControl.InheritanceFlags]::None,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Deny)
  $acl.AddAccessRule($rule)
} else {
  $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($Saved),[Security.AccessControl.AccessControlSections]::Access)
}
Set-Acl -LiteralPath $Folder -AclObject $acl
'''


def fixture_child_alive(pid, expected):
    kernel=ctypes.windll.kernel32
    kernel.OpenProcess.argtypes=(ctypes.c_uint32,ctypes.c_int,ctypes.c_uint32)
    kernel.OpenProcess.restype=ctypes.c_void_p
    kernel.QueryFullProcessImageNameW.argtypes=(ctypes.c_void_p,ctypes.c_uint32,ctypes.c_wchar_p,ctypes.POINTER(ctypes.c_uint32))
    kernel.GetExitCodeProcess.argtypes=(ctypes.c_void_p,ctypes.POINTER(ctypes.c_uint32))
    kernel.CloseHandle.argtypes=(ctypes.c_void_p,)
    handle=kernel.OpenProcess(0x1000,False,pid)
    if not handle:return False
    try:
        size=ctypes.c_uint32(32768);name=ctypes.create_unicode_buffer(size.value);code=ctypes.c_uint32()
        return (bool(kernel.QueryFullProcessImageNameW(handle,0,name,ctypes.byref(size))) and
                os.path.normcase(name.value)==os.path.normcase(str(expected)) and
                bool(kernel.GetExitCodeProcess(handle,ctypes.byref(code))) and code.value==259)
    finally:kernel.CloseHandle(handle)


@unittest.skipUnless(os.name=='nt', 'portable process replacement requires Windows')
class PortableUpdateIntegrationTests(unittest.TestCase):
    def test_gateway_releases_port_new_package_starts_and_other_processes_survive(self):
        self._run_case('same_install')

    def test_verified_gateway_from_previous_install_is_replaced(self):
        self._run_case('verified_external')

    def test_unknown_gateway_is_left_running_and_update_does_not_start(self):
        self._run_case('unknown_external')

    def test_forged_or_stale_owner_record_does_not_authorize_shutdown(self):
        self._run_case('mismatched_record')

    def test_non_gateway_command_is_not_stopped_even_with_owner_record(self):
        self._run_case('wrong_command')

    def test_real_directory_acl_denial_is_reported_before_window_shutdown(self):
        self._run_case('acl_denied')

    def test_reappearing_old_gateway_cannot_make_old_ui_look_like_success(self):
        self._run_case('external_reappears')

    def _run_case(self, gateway_kind):
        with tempfile.TemporaryDirectory(prefix='pinkie-portable-update-') as temp:
            root=Path(temp).resolve()
            csc=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
            self.assertTrue(csc.is_file(),'Windows .NET Framework compiler is required for the process fixture')
            source=root/'fixture.cs';source.write_text(PROGRAM,encoding='utf-8')
            compiled=root/'fixture.exe'
            hidden=getattr(subprocess,'CREATE_NO_WINDOW',0)
            subprocess.run([str(csc),'/nologo','/target:winexe','/out:'+str(compiled),str(source)],
                           check=True,creationflags=hidden,capture_output=True)
            binary=compiled.read_bytes()
            parent=root/'acl-test-parent' if gateway_kind=='acl_denied' else root
            target=parent/'PortableFixture';(target/'_internal/runtime/bin').mkdir(parents=True)
            executable=target/'超級碧琪.exe';executable.write_bytes(binary)
            gateway_exe=(target if gateway_kind in ('same_install','acl_denied') else root/'previous-copy')/'_internal/runtime/bin/node.exe'
            gateway_exe.parent.mkdir(parents=True,exist_ok=True);gateway_exe.write_bytes(binary)
            (target/'old-version.txt').write_text('old')
            outside=root/'outside';outside.mkdir();outside_exe=outside/'node.exe';outside_exe.write_bytes(binary)
            previous=root/'PortableFixture.previous';previous.mkdir();(previous/'keep.txt').write_text('unchanged')
            state=root/'state';(state/'logs').mkdir(parents=True)
            payload=root/'new.zip'
            with zipfile.ZipFile(payload,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('超級碧琪/超級碧琪.exe',binary)
                archive.writestr('超級碧琪/new-version.txt','new')
            digest=hashlib.sha256(payload.read_bytes()).hexdigest()
            caller=root/'caller.py';caller.write_text(CALLER,encoding='utf-8')
            result=root/'caller-result.json';child_pid=root/'child-pid';child_stop=root/'child-stop';new_pid=root/'new-pid'
            for path in (target,previous,outside,state,payload,child_stop):path.resolve().relative_to(root)
            with socket.socket() as reserve:
                reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1]
            shadow=root/'shadow/Microsoft.PowerShell.Utility';shadow.mkdir(parents=True)
            (shadow/'Microsoft.PowerShell.Utility.psm1').write_text('function Get-FileHash { throw "wrong module selected" }',encoding='ascii')
            (shadow/'Microsoft.PowerShell.Utility.psd1').write_text(
                "@{ RootModule='Microsoft.PowerShell.Utility.psm1'; ModuleVersion='99.0.0'; FunctionsToExport=@('Get-FileHash') }",
                encoding='ascii')
            env=os.environ.copy()
            env.update(PINKIE_STATE_ROOT=str(state),FIXTURE_PORT=str(port),FIXTURE_CHILD_EXE=str(outside_exe),
                       FIXTURE_CHILD_PID=str(child_pid),FIXTURE_CHILD_STOP=str(child_stop),FIXTURE_NEW_PID=str(new_pid),
                       PSModulePath=str(shadow.parent)+os.pathsep+env.get('PSModulePath',''))
            if gateway_kind=='external_reappears':env['FIXTURE_EXTERNAL_REAPPEARS']='1'
            children=[];child_id=None;acl_changed=False;update_started=False
            stop_watch=threading.Event();revived=[];watcher=None
            acl_script=root/'acl-fixture.ps1';acl_script.write_text(ACL_FIXTURE,encoding='utf-8-sig')
            saved_acl=root/'acl-original.sddl'
            def fixture_acl(action):
                result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
                                       '-File',str(acl_script),'-Folder',str(parent),'-Saved',str(saved_acl),'-Action',action],
                                      capture_output=True,creationflags=hidden)
                if result.returncode:raise RuntimeError('fixture ACL error: '+result.stderr.decode(errors='replace'))
            try:
                gateway_args=(['--gateway'] if gateway_kind in ('same_install','acl_denied','wrong_command') else
                              ['openclaw.mjs','gateway','run','--port',str(port)])
                gateway=subprocess.Popen([str(gateway_exe),*gateway_args],env=env,creationflags=hidden);children.append(gateway)
                relay=subprocess.Popen([str(executable),'--hold'],env=env,creationflags=hidden);children.append(relay)
                other=subprocess.Popen([str(outside_exe),'--hold'],env=env,creationflags=hidden);children.append(other)
                deadline=time.monotonic()+10
                while time.monotonic()<deadline and not child_pid.exists():time.sleep(.1)
                self.assertTrue(child_pid.is_file(),'test gateway did not start')
                child_id=int(child_pid.read_text())
                self.assertTrue(fixture_child_alive(child_id,outside_exe))
                if gateway_kind in ('verified_external','mismatched_record','wrong_command','external_reappears'):
                    recorded_exe=str(gateway_exe)+('.wrong' if gateway_kind=='mismatched_record' else '')
                    (state/'gateway-owner.json').write_text(json.dumps({'pid':gateway.pid,'node':recorded_exe}),encoding='utf-8')
                if gateway_kind=='external_reappears':
                    def revive_previous_gateway():
                        try:gateway.wait(timeout=40)
                        except subprocess.TimeoutExpired:return
                        # Restart only after the old-gateway stop and folder swap
                        # have completed, so the test exercises the later race.
                        until=time.monotonic()+35
                        while time.monotonic()<until and not (target/'new-version.txt').is_file():
                            if stop_watch.wait(.1):return
                        if stop_watch.is_set() or not (target/'new-version.txt').is_file():return
                        restarted=subprocess.Popen([str(gateway_exe),*gateway_args],env=env,creationflags=hidden)
                        revived.append(restarted)
                        (state/'gateway-owner.json').write_text(json.dumps({'pid':restarted.pid,'node':str(gateway_exe)}),encoding='utf-8')
                    watcher=threading.Thread(target=revive_previous_gateway,daemon=True);watcher.start()
                if gateway_kind=='acl_denied':
                    fixture_acl('deny');acl_changed=True
                repo=Path(__file__).resolve().parents[1]
                process=subprocess.Popen([sys.executable,'-X','utf8',str(caller),str(repo),str(executable),
                                          str(payload),digest,str(result)],env=env,stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE,creationflags=hidden)
                out,err=process.communicate(timeout=30)
                outcome=json.loads(result.read_text(encoding='utf-8'))
                if gateway_kind in ('unknown_external','mismatched_record','wrong_command','acl_denied'):
                    self.assertEqual(process.returncode,1,err.decode('utf-8',errors='replace'))
                    self.assertFalse(outcome['started'])
                    self.assertIn('管理员授权' if gateway_kind=='acl_denied' else '网关端口被其他程序占用',outcome['message'])
                    self.assertTrue((target/'old-version.txt').is_file())
                    self.assertFalse((target/'new-version.txt').exists())
                    self.assertIsNone(gateway.poll())
                    self.assertIsNone(relay.poll())
                    self.assertIsNone(other.poll())
                    self.assertTrue(fixture_child_alive(child_id,outside_exe))
                    self.assertEqual((previous/'keep.txt').read_text(),'unchanged')
                    return
                self.assertEqual(process.returncode,0,err.decode('utf-8',errors='replace'))
                self.assertTrue(outcome['started'])
                update_started=True
                log=state/'logs/updater.log';deadline=time.monotonic()+40;text=''
                while time.monotonic()<deadline:
                    if log.exists():text=log.read_text(encoding='utf-8-sig',errors='replace')
                    if 'portable update completed' in text or 'portable update failed' in text:break
                    time.sleep(.2)
                if gateway_kind=='external_reappears':
                    self.assertTrue(revived and revived[0].poll() is None,'previous gateway did not reappear')
                    self.assertIn('portable update failed',text)
                    self.assertIn('new version attached to a different install gateway',text)
                    until=time.monotonic()+20
                    while time.monotonic()<until and not (target/'old-version.txt').is_file():time.sleep(.2)
                    self.assertTrue((target/'old-version.txt').is_file(),'old package was not restored')
                    self.assertFalse((target/'new-version.txt').exists())
                    self.assertIsNone(other.poll())
                    self.assertTrue(fixture_child_alive(child_id,outside_exe))
                    self.assertEqual((previous/'keep.txt').read_text(),'unchanged')
                    return
                self.assertIn('portable update completed',text)
                self.assertTrue((target/'new-version.txt').is_file())
                self.assertFalse((target/'old-version.txt').exists())
                self.assertIsNotNone(gateway.poll())
                self.assertIsNotNone(relay.poll())
                self.assertIsNone(other.poll())
                self.assertTrue(fixture_child_alive(child_id,outside_exe),'unrelated gateway child was killed')
                self.assertEqual((previous/'keep.txt').read_text(),'unchanged')
            finally:
                if acl_changed:fixture_acl('restore')
                stop_watch.set()
                if watcher:watcher.join(timeout=5)
                child_stop.write_text('stop')
                for process in reversed(children+revived):
                    if process.poll() is None:process.terminate()
                for process in children+revived:
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
                deadline=time.monotonic()+5
                while child_id and time.monotonic()<deadline and fixture_child_alive(child_id,outside_exe):time.sleep(.1)
                if update_started and new_pid.exists():
                    fresh_id=int(new_pid.read_text());deadline=time.monotonic()+5
                    while time.monotonic()<deadline and fixture_child_alive(fresh_id,executable):time.sleep(.1)


if __name__=='__main__':unittest.main()
