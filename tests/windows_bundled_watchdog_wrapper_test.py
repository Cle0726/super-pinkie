"""B109: the bundled gateway watchdog task must not outlive the App folder.

The Windows App is a portable folder, so "uninstall" is deleting it. The task
register-bundled-watchdog.ps1 sets up (at logon + every minute for ten years) used
to run the watchdog straight from that folder and start in it: after a delete it
failed every minute forever and nothing removed it, and there was no unregister
script at all.

Now the task runs a wrapper kept outside the App folder. These tests run that
wrapper for real in Windows PowerShell, with Unregister-ScheduledTask and
Remove-ItemProperty replaced by recording stubs (a function shadows a cmdlet),
so the real task on this machine is never touched.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMAND = ROOT / "installer" / "windows" / "watchdog-command.ps1"
POWERSHELL = shutil.which("powershell") or shutil.which("powershell.exe")

# Chinese, a space and a single quote: the wrapper embeds these paths in '...'.
APP_NAME = "超級碧琪 it's"

FAKE_WATCHDOG = (
    "param($NodePath, $OpenClawEntry, $Port, [switch]$Loop)\n"
    "Set-Content -LiteralPath (Join-Path $env:PINKIE_STATE_ROOT 'ran.txt') -Encoding UTF8 "
    "-Value (@{port=$Port; loop=[bool]$Loop; node=$NodePath; entry=$OpenClawEntry} | ConvertTo-Json -Compress)\n"
)

DRIVER = r"""
$ErrorActionPreference = 'Stop'
$global:calls = @()
function Unregister-ScheduledTask { [CmdletBinding(SupportsShouldProcess)] param($TaskName) $global:calls += "task:$TaskName" }
function Remove-ItemProperty { [CmdletBinding()] param($Path, $Name) $global:calls += "run:$Path|$Name" }
. $env:B109_COMMAND
switch ($env:B109_STEP) {
  'write' {
    $paths = Get-BundledWatchdogPaths $env:B109_INSTALL
    $wrapper = Write-BundledWatchdogWrapper $env:B109_INSTALL $paths
    @{ wrapper = $wrapper; args = (New-BundledWatchdogArguments $wrapper) } | ConvertTo-Json -Compress
  }
  'run' {
    & (Get-BundledWatchdogWrapperPath)
    @{ calls = @($global:calls) } | ConvertTo-Json -Compress
  }
}
"""


@unittest.skipUnless(os.name == "nt" and POWERSHELL, "needs Windows PowerShell")
class BundledWatchdogWrapper(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name)
        self.state = self.base / "state"
        self.programs = self.base / "Programs"
        self.install = self.programs / APP_NAME
        internal = self.install / "_internal"
        watchdog = internal / "services" / "watchdog" / "windows-gateway-watchdog.ps1"
        watchdog.parent.mkdir(parents=True)
        watchdog.write_text(FAKE_WATCHDOG, encoding="utf-8-sig")
        for rel in ("runtime/bin/node.exe", "runtime/node_modules/openclaw/openclaw.mjs"):
            (internal / rel).parent.mkdir(parents=True, exist_ok=True)
            (internal / rel).write_text("", encoding="utf-8")
        self.driver = self.base / "driver.ps1"
        self.driver.write_text(DRIVER, encoding="utf-8-sig")
        self.written = self.ps("write")
        self.wrapper = Path(self.written["wrapper"])

    def ps(self, step):
        env = dict(os.environ, PINKIE_STATE_ROOT=str(self.state), B109_COMMAND=str(COMMAND),
                   B109_INSTALL=str(self.install), B109_STEP=step)
        out = subprocess.run(
            [POWERSHELL, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(self.driver)],
            env=env, capture_output=True, timeout=60,
        )
        stdout, stderr = out.stdout.decode("utf-8", "replace"), out.stderr.decode("utf-8", "replace")
        self.assertEqual(out.returncode, 0, stderr or stdout)
        return json.loads(stdout.strip().splitlines()[-1])

    def test_wrapper_lives_outside_the_app_folder(self):
        self.assertTrue(self.wrapper.is_file())
        self.assertNotIn(str(self.install), str(self.wrapper))
        self.assertTrue(str(self.wrapper).startswith(str(self.state)))
        self.assertEqual(self.wrapper.read_bytes()[:3], b"\xef\xbb\xbf", "PowerShell 5.1 needs the BOM for a Chinese path")
        self.assertIn(f'-File "{self.wrapper}"', self.written["args"])
        self.assertNotIn(str(self.install), self.written["args"], "the task must not point into the App folder")

    def test_app_present_runs_the_watchdog_and_keeps_the_task(self):
        self.assertEqual(self.ps("run")["calls"], [])
        ran = json.loads((self.state / "ran.txt").read_text(encoding="utf-8-sig"))
        self.assertEqual(ran["port"], 18789)
        self.assertTrue(ran["loop"])
        self.assertTrue(ran["node"].endswith("node.exe"))
        self.assertIn(APP_NAME, ran["entry"])
        self.assertTrue(self.wrapper.is_file())

    def test_app_folder_deleted_removes_task_run_value_and_itself(self):
        shutil.rmtree(self.install)
        calls = self.ps("run")["calls"]
        self.assertIn("task:SuperPinkieGatewayWatchdog", calls)
        self.assertIn("run:HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run|SuperPinkieGatewayWatchdog", calls)
        self.assertFalse(self.wrapper.exists())
        self.assertFalse((self.state / "ran.txt").exists())

    def test_folder_still_there_without_watchdog_is_left_alone(self):
        # Mid copy of an update: the folder exists but the file is not in yet.
        (self.install / "_internal" / "services" / "watchdog" / "windows-gateway-watchdog.ps1").unlink()
        self.assertEqual(self.ps("run")["calls"], [])
        self.assertTrue(self.wrapper.is_file())

    def test_update_backup_next_to_it_is_left_alone(self):
        # The updater renamed the folder to <name>.previous-<token> and the new
        # one is not in place yet (or a failed update waits for the restore at sign-in).
        self.install.rename(self.programs / (APP_NAME + ".previous-0123abcd"))
        self.assertEqual(self.ps("run")["calls"], [])
        self.assertTrue(self.wrapper.is_file())


if __name__ == "__main__":
    unittest.main()
