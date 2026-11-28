"""Real Windows process/port regression for the portable updater.

All executables, ports, configuration and update files belong to a temporary
fixture. No installed App, real gateway, account data or system proxy is used.
"""
import contextlib
import ctypes
from ctypes import wintypes
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
      File.WriteAllText(Environment.GetEnvironmentVariable("FIXTURE_CHILD_PID"),Process.GetCurrentProcess().Id.ToString());
      string stop=Environment.GetEnvironmentVariable("FIXTURE_CHILD_STOP");
      // B136: 30s (300*100ms) matched the old ~25-30s locked_rollback runtime;
      // the condition-based lock wait now added there can legitimately run
      // 44-46s, which made this self-timeout fire before the test's final
      // fixture_child_alive() check. 120s matches the --hold branch below.
      for (int i=0;i<1200 && !File.Exists(stop);i++) Thread.Sleep(100);
      return 0;
    }
    if (kind == "--gateway" || kind == "openclaw.mjs") {
      var listener=new TcpListener(IPAddress.Loopback,Int32.Parse(Environment.GetEnvironmentVariable("FIXTURE_PORT")));
      try { listener.Start(); } catch (SocketException) { return 2; }
      Process.Start(Environment.GetEnvironmentVariable("FIXTURE_CHILD_EXE"),"--child");
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
      string delay=Environment.GetEnvironmentVariable("FIXTURE_READY_DELAY_MS");
      if (!String.IsNullOrEmpty(delay)) {
        // A real first start: alive at once, gateway ready much later.
        File.WriteAllText(Path.ChangeExtension(marker,".started"),"started");
        Thread.Sleep(Int32.Parse(delay));
      }
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
# 打包的 App 里 app/ 就是脚本目录，windows_desktop 直接 import release_notes。
sys.path.insert(0,os.path.join(repo,'app'))
import app.windows_desktop as desktop
desktop.GATEWAY_URL='http://127.0.0.1:'+os.environ['FIXTURE_PORT']+'/'
WindowsUpdater=desktop.WindowsUpdater
# 测试里不弹真窗口（产品默认行为不变）：App 侧的进度窗口换成替身，照常返回进程对象，
# 于是命令行照常带 -ProgressShown，替换脚本不会自己再开一张；替换脚本里的问题窗口只记日志。
stand_in_calls=[]
class _NoWindow:
    def terminate(self):pass
    def poll(self):return None
def _progress_stand_in(update_root,token,version):
    stand_in_calls.append(token);return _NoWindow()
WindowsUpdater._start_progress_window=staticmethod(_progress_stand_in)
_PROBLEM='function Show-UpdateProblem([string]$Text) {'
_helper=WindowsUpdater._directory_helper_source
def _quiet_helper():
    source=_helper()
    assert source.count(_PROBLEM)==1,'Show-UpdateProblem signature changed; update the test stand-in'
    return source.replace(_PROBLEM,_PROBLEM+"\n  Write-UpdateLog ('test stand-in: update problem window suppressed: ' + $Text); return",1)
WindowsUpdater._directory_helper_source=staticmethod(_quiet_helper)
exe=Path(exe);payload=Path(payload)
updater=WindowsUpdater(exe.parent/'_internal',executable=exe)
assert updater.portable
updater.prepared={'payload':payload,'sha256':digest,'version':'9.9.9'}
if os.environ.get('FIXTURE_START_SECONDS'):updater.health_start_seconds=int(os.environ['FIXTURE_START_SECONDS'])
if os.environ.get('FIXTURE_SWAP_SECONDS'):updater.swap_seconds=int(os.environ['FIXTURE_SWAP_SECONDS'])
outcome=updater.launch_replacer()
outcome['progressStandIn']=len(stand_in_calls)
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


def fixture_unlink_executable(path, root, timeout=15):
    """Remove only the test-owned child binary after Windows releases it.

    A process can stop being queryable briefly before its executable image is
    released.  Retry the actual cleanup, without ignoring a persistent lock or
    changing any update assertions.  The resolved path must stay in this test's
    newly created temporary root.
    """
    path=path.resolve()
    path.relative_to(root.resolve())
    deadline=time.monotonic()+timeout
    while True:
        try:
            path.unlink(missing_ok=True)
            return
        except OSError as error:
            if getattr(error,'winerror',None) not in (5,32,33) or time.monotonic()>=deadline:
                raise
            time.sleep(.1)


@contextlib.contextmanager
def lock_log_exclusively(path):
    path.touch()
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                       wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    # GENERIC_READ, no sharing, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL.
    handle = create(str(path), 0x80000000, 0, None, 3, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield
    finally:
        kernel.CloseHandle(handle)


def read_updater_log(path, previous=''):
    try:
        return path.read_text(encoding='utf-8-sig', errors='replace')
    except (FileNotFoundError, PermissionError):
        # PowerShell may briefly hold an exclusive handle while appending.
        # Keep polling for the actual result; a locked log isn't that result.
        return previous


@unittest.skipUnless(os.name=='nt', 'portable process replacement requires Windows')
class PortableUpdateIntegrationTests(unittest.TestCase):
    def test_fixture_cleanup_waits_for_the_actual_image_lock_and_stays_in_root(self):
        with tempfile.TemporaryDirectory(prefix='pinkie-portable-cleanup-') as temp:
            root=Path(temp).resolve()
            source=root/'fixture.cs';source.write_text(PROGRAM,encoding='utf-8')
            executable=root/'node.exe'
            csc=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
            hidden=getattr(subprocess,'CREATE_NO_WINDOW',0)
            subprocess.run([str(csc),'/nologo','/target:winexe','/out:'+str(executable),str(source)],
                           check=True,creationflags=hidden,capture_output=True)
            process=subprocess.Popen([str(executable),'--hold'],creationflags=hidden)
            try:
                # Kept on purpose: the image lock has no separate observable
                # signal -- the assertRaises below *is* the probe, and retrying
                # unlink() until it fails would hide a lock that is never held.
                time.sleep(.2)
                with self.assertRaises(PermissionError):executable.unlink()
                def stop_after_delay():
                    time.sleep(.5)
                    if process.poll() is None:process.terminate()
                stopper=threading.Thread(target=stop_after_delay)
                stopper.start()
                fixture_unlink_executable(executable,root)
                stopper.join(timeout=5)
                self.assertFalse(stopper.is_alive())
                self.assertFalse(executable.exists())
                with self.assertRaises(ValueError):
                    fixture_unlink_executable(root.parent/'not-a-fixture.exe',root)
            finally:
                if process.poll() is None:process.terminate()
                process.wait(timeout=5)

    def test_gateway_releases_port_new_package_starts_and_other_processes_survive(self):
        self._run_case('same_install')

    def test_verified_gateway_from_previous_install_is_replaced(self):
        self._run_case('verified_external')

    def test_an_exclusively_held_diagnostic_log_does_not_block_the_update(self):
        self._run_case('log_lock')

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

    def test_slow_first_start_is_kept_instead_of_rolled_back(self):
        # 2.5.27-2.5.31 killed a new version that had not shown its page
        # within 120 s and moved the old folder back. Scaled down here: the
        # start budget is 5 s and the new gateway needs 12 s.
        self._run_case('slow_ready')

    def test_unpacked_files_held_open_by_a_scanner_do_not_fail_the_swap(self):
        self._run_case('scanner_lock')

    def test_rollback_copies_the_previous_version_when_its_folder_stays_locked(self):
        # A user report (2.5.35 -> 2.5.36): the rollback renamed the failed copy
        # away, the previous folder stayed "in use", and the install folder was
        # left empty. Now the previous version is copied back instead.
        self._run_case('locked_rollback')

    @contextlib.contextmanager
    def _reporting_tempdir(self):
        holder=tempfile.TemporaryDirectory(prefix='pinkie-portable-update-')
        try:yield holder.name
        finally:
            self._report_holders(holder.name)
            holder.cleanup()
    def _report_holders(self,temp):
        # Before the temporary folder is removed: name every process still inside it.
        name=Path(temp).name
        probe=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',
            "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*%s*' -or $_.ExecutablePath -like '*%s*' } | "
            "ForEach-Object { '{0}#{1} {2}' -f $_.Name,$_.ProcessId,$_.CommandLine }"%(name,name)],
            capture_output=True,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        text=probe.stdout.decode('utf-8',errors='replace').strip()
        if text:print('\n[still running inside %s]\n%s'%(name,text[-4000:]),file=sys.stderr)
        # The update helper can outlive a case (it waits for the new window); stop everything left in
        # this case's folder so the folder can be removed and the next case starts clean.
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',
            "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*%s*' -or $_.ExecutablePath -like '*%s*') -and $_.ProcessId -ne $PID } | "
            "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500"%(name,name)],
            capture_output=True,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    def _run_case(self, gateway_kind):
        with self._reporting_tempdir() as temp:
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
            # slow_ready / scanner_lock test timing and file locks, not gateway identity: their gateway is the install's own.
            gateway_exe=(target if gateway_kind in ('same_install','acl_denied','slow_ready','scanner_lock') else root/'previous-copy')/'_internal/runtime/bin/node.exe'
            gateway_exe.parent.mkdir(parents=True,exist_ok=True);gateway_exe.write_bytes(binary)
            (target/'old-version.txt').write_text('old', encoding="utf-8")
            outside=root/'outside';outside.mkdir();outside_exe=outside/'node.exe';outside_exe.write_bytes(binary)
            previous=root/'PortableFixture.previous';previous.mkdir();(previous/'keep.txt').write_text('unchanged', encoding="utf-8")
            state=root/'state';(state/'logs').mkdir(parents=True)
            payload=root/'new.zip'
            with zipfile.ZipFile(payload,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('超級碧琪/超級碧琪.exe',binary)
                archive.writestr('超級碧琪/new-version.txt','new')
            digest=hashlib.sha256(payload.read_bytes()).hexdigest()
            caller=root/'caller.py';caller.write_text(CALLER,encoding='utf-8')
            result=root/'caller-result.json';child_pid=root/'child-pid';child_stop=root/'child-stop';new_pid=root/'new-pid'
            revived_child_pid=root/'revived-child-pid'
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
            if gateway_kind in ('external_reappears','locked_rollback'):env['FIXTURE_EXTERNAL_REAPPEARS']='1'
            if gateway_kind=='locked_rollback':env['FIXTURE_SWAP_SECONDS']='8'  # B136: 3s let Stop-InstallProcesses alone eat the whole retry budget, so Move-Folder's first failure sometimes landed past the deadline and skipped the "busy, retrying" log line before falling back to copy.
            if gateway_kind=='slow_ready':env.update(FIXTURE_READY_DELAY_MS='12000',FIXTURE_START_SECONDS='5')
            locker=None;lock_seen=[]
            if gateway_kind=='scanner_lock':
                def hold_unpacked_file():
                    # Like a virus scanner reading the fresh unpack: a plain
                    # open handle (no delete sharing) blocks renaming its folder.
                    until=time.monotonic()+60
                    while time.monotonic()<until:
                        found=list((state/'updates').glob('.pinkie-stage-*/超級碧琪/new-version.txt'))
                        if found:
                            try:
                                with open(found[0],'rb'):
                                    lock_seen.append(found[0])
                                    # Hold until the helper's rename has actually met the lock. A fixed
                                    # 6 s hold raced the process-stop phase before the rename (about 8 s
                                    # on a Windows dev box), so the lock was gone before it was tested.
                                    # The helper retries the swap for 90 s; give up at 60 s.
                                    log_path=state/'logs/updater.log';text='';held_until=time.monotonic()+60
                                    while time.monotonic()<held_until and 'unpacked new version is busy, retrying' not in text:
                                        time.sleep(.2);text=read_updater_log(log_path,text)
                                return
                            except OSError:pass  # still being written; try again
                        time.sleep(.02)
                locker=threading.Thread(target=hold_unpacked_file,daemon=True)
            if gateway_kind=='locked_rollback':
                def hold_previous_folder():
                    # Like a scanner reading the renamed previous version for a
                    # long time: reading still works, renaming its folder does not.
                    until=time.monotonic()+60
                    while time.monotonic()<until:
                        found=list(root.glob('PortableFixture.previous-*/old-version.txt'))
                        if found:
                            try:
                                with open(found[0],'rb'):
                                    lock_seen.append(found[0])
                                    # Hold until the helper has actually given up retrying the rename
                                    # and switched to the copy fallback, not a guessed duration (B136;
                                    # the generic "busy, retrying" line fires on every retry inside the
                                    # FIXTURE_SWAP_SECONDS=3s budget, so waiting for that released the
                                    # lock too early and let a later retry's plain rename succeed).
                                    log_path=state/'logs/updater.log';text='';held_until=time.monotonic()+60
                                    while time.monotonic()<held_until and 'copying the previous version instead' not in text:
                                        time.sleep(.2);text=read_updater_log(log_path,text)
                                return
                            except OSError:pass
                        time.sleep(.02)
                locker=threading.Thread(target=hold_previous_folder,daemon=True)
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
                gateway_args=(['--gateway'] if gateway_kind in ('same_install','acl_denied','wrong_command','slow_ready','scanner_lock') else
                              ['openclaw.mjs','gateway','run','--port',str(port)])
                gateway=subprocess.Popen([str(gateway_exe),*gateway_args],env=env,creationflags=hidden);children.append(gateway)
                relay=subprocess.Popen([str(executable),'--hold'],env=env,creationflags=hidden);children.append(relay)
                other=subprocess.Popen([str(outside_exe),'--hold'],env=env,creationflags=hidden);children.append(other)
                deadline=time.monotonic()+10
                while time.monotonic()<deadline and not child_pid.exists():time.sleep(.1)
                self.assertTrue(child_pid.is_file(),'test gateway did not start')
                child_id=int(child_pid.read_text(encoding="utf-8"))
                self.assertTrue(fixture_child_alive(child_id,outside_exe))
                if gateway_kind in ('verified_external','log_lock','mismatched_record','wrong_command','external_reappears','locked_rollback'):
                    recorded_exe=str(gateway_exe)+('.wrong' if gateway_kind=='mismatched_record' else '')
                    (state/'gateway-owner.json').write_text(json.dumps({'pid':gateway.pid,'node':recorded_exe}),encoding='utf-8')
                if gateway_kind in ('external_reappears','locked_rollback'):
                    def revive_previous_gateway():
                        # B136: these two windows matched the old ~25-30s
                        # locked_rollback runtime; the condition-based lock wait
                        # added there can legitimately push the whole case past
                        # 50s now, so both are widened to the file's existing
                        # 60s "give up" convention (see hold_previous_folder).
                        try:gateway.wait(timeout=60)
                        except subprocess.TimeoutExpired:return
                        # Restart only after the old-gateway stop and folder swap
                        # have completed, so the test exercises the later race.
                        until=time.monotonic()+60
                        while time.monotonic()<until and not (target/'new-version.txt').is_file():
                            if stop_watch.wait(.1):return
                        if stop_watch.is_set() or not (target/'new-version.txt').is_file():return
                        revived_env=env.copy();revived_env['FIXTURE_CHILD_PID']=str(revived_child_pid)
                        restarted=subprocess.Popen([str(gateway_exe),*gateway_args],env=revived_env,creationflags=hidden)
                        revived.append(restarted)
                        (state/'gateway-owner.json').write_text(json.dumps({'pid':restarted.pid,'node':str(gateway_exe)}),encoding='utf-8')
                    watcher=threading.Thread(target=revive_previous_gateway,daemon=True);watcher.start()
                if gateway_kind=='acl_denied':
                    fixture_acl('deny');acl_changed=True
                if locker:locker.start()
                repo=Path(__file__).resolve().parents[1]
                log=state/'logs/updater.log'
                with (lock_log_exclusively(log) if gateway_kind=='log_lock' else contextlib.nullcontext()):
                    if gateway_kind=='log_lock':
                        with self.assertRaises(PermissionError):log.read_text(encoding='utf-8')
                    process=subprocess.Popen([sys.executable,'-X','utf8',str(caller),str(repo),str(executable),
                                              str(payload),digest,str(result)],env=env,stdout=subprocess.PIPE,
                                             stderr=subprocess.PIPE,creationflags=hidden)
                    out,err=process.communicate(timeout=30)
                    if gateway_kind=='log_lock':
                        # B68: keep the log locked until the helper is done. Releasing it after
                        # the handoff only exercised the first half, and a lock that outlived the
                        # handoff (CI, #414 job 140329917418) dropped the final log line while the
                        # update itself completed. Done = in-progress.json removed (both paths).
                        in_progress=state/'updates'/'in-progress.json'
                        until=time.monotonic()+60
                        while time.monotonic()<until and in_progress.exists():time.sleep(.2)
                        helper_done=not in_progress.exists()
                self.assertTrue(result.is_file(),'caller wrote no result (exit %s):\n%s\n%s'%(process.returncode,out.decode('utf-8',errors='replace')[-2000:],err.decode('utf-8',errors='replace')[-4000:]))
                outcome=json.loads(result.read_text(encoding='utf-8'))
                # 防复发：进度窗口必须走测试替身（不在桌面上弹真窗口）。
                self.assertEqual(outcome.pop('progressStandIn',None),1,'progress window was not replaced by the test stand-in')
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
                    self.assertEqual((previous/'keep.txt').read_text(encoding="utf-8"),'unchanged')
                    return
                updater_log=lambda:read_updater_log(log,'(updater.log unavailable)')[-6000:]
                self.assertEqual(process.returncode,0,'%s\noutcome=%s\nstdout=%s\n--- updater.log ---\n%s'%(err.decode('utf-8',errors='replace')[-3000:],json.dumps(outcome,ensure_ascii=False),out.decode('utf-8',errors='replace')[-2000:],updater_log()))
                self.assertTrue(outcome['started'])
                update_started=True
                deadline=time.monotonic()+(0 if gateway_kind=='log_lock' else 60);text=''
                while time.monotonic()<deadline:
                    text=read_updater_log(log,text)
                    if 'portable update completed' in text or 'portable update failed' in text:break
                    time.sleep(.2)
                if gateway_kind in ('external_reappears','locked_rollback'):
                    self.assertTrue(revived and revived[0].poll() is None,'previous gateway did not reappear')
                    self.assertIn('portable update failed',text)
                    self.assertIn('new version attached to a different install gateway',text)
                    until=time.monotonic()+20
                    while time.monotonic()<until and not (target/'old-version.txt').is_file():time.sleep(.2)
                    self.assertTrue((target/'old-version.txt').is_file(),'old package was not restored\n--- updater.log ---\n'+updater_log())
                    self.assertFalse((target/'new-version.txt').exists())
                    if gateway_kind=='locked_rollback':
                        self.assertTrue(lock_seen,'the fixture never held the previous folder open')
                        until=time.monotonic()+20
                        while time.monotonic()<until and 'previous version restored by copy' not in text:
                            time.sleep(.2);text=read_updater_log(log,text)
                        self.assertIn('previous version folder is busy, retrying',text)
                        self.assertIn('previous version restored by copy',text)
                        self.assertTrue(executable.is_file(),'the restored copy has no exe')
                    self.assertIsNone(other.poll())
                    self.assertTrue(fixture_child_alive(child_id,outside_exe))
                    self.assertEqual((previous/'keep.txt').read_text(encoding="utf-8"),'unchanged')
                    return
                if gateway_kind=='log_lock':
                    # The log was held for the whole update, so its lines may be missing
                    # (Write-UpdateLog falls back to stderr). Judge by what the helper leaves.
                    self.assertTrue(helper_done,'update helper still running 60 s after the handoff')
                    self.assertFalse((state/'updates'/'last-failure.json').exists(),'helper recorded a failure')
                    self.assertNotIn('portable update failed',read_updater_log(log,''))
                else:
                    self.assertIn('portable update completed',text,'--- updater.log ---\n'+text[-6000:])
                if gateway_kind=='slow_ready':
                    self.assertIn('new version started; waiting for its gateway',text)
                if gateway_kind=='scanner_lock':
                    self.assertTrue(lock_seen,'the fixture never held an unpacked file open')
                    self.assertIn('unpacked new version is busy, retrying',text)
                self.assertFalse(list((state/'updates').glob('.pinkie-stage-*')),'staging folder left behind')
                self.assertTrue((target/'new-version.txt').is_file())
                self.assertFalse((target/'old-version.txt').exists())
                self.assertIsNotNone(gateway.poll())
                self.assertIsNotNone(relay.poll())
                self.assertIsNone(other.poll())
                self.assertTrue(fixture_child_alive(child_id,outside_exe),'unrelated gateway child was killed')
                self.assertEqual((previous/'keep.txt').read_text(encoding="utf-8"),'unchanged')
            finally:
                if locker and locker.is_alive():locker.join(timeout=30)
                if acl_changed:fixture_acl('restore')
                stop_watch.set()
                if watcher:watcher.join(timeout=5)
                child_stop.write_text('stop', encoding="utf-8")
                for process in reversed(children+revived):
                    if process.poll() is None:process.terminate()
                for process in children+revived:
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
                child_ids={child_id} if child_id else set()
                if revived_child_pid.exists():child_ids.add(int(revived_child_pid.read_text(encoding="utf-8")))
                deadline=time.monotonic()+15
                while time.monotonic()<deadline and any(fixture_child_alive(pid,outside_exe) for pid in child_ids):time.sleep(.1)
                self.assertFalse(any(fixture_child_alive(pid,outside_exe) for pid in child_ids),'fixture child did not exit after stop signal')
                if update_started and new_pid.exists():
                    fresh_id=int(new_pid.read_text(encoding="utf-8"));deadline=time.monotonic()+5
                    while time.monotonic()<deadline and fixture_child_alive(fresh_id,executable):time.sleep(.1)
                fixture_unlink_executable(outside_exe,root)


if __name__=='__main__':unittest.main()
