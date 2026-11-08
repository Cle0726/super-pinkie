"""11-04/11-05: the portable update renamed the install folder while processes
the App had started (WebView2, a browser with an extension from the install,
gateway children) still held files in it. The rename failed with "Access
denied" / "in use", the rollback failed the same way and left only
``超級碧琪.previous-<token>`` behind, so the desktop shortcut pointed at nothing.

The replacer now stops helpers whose command line names the install folder
or the App's own WebView2 profile before every rename (each process alone, so
programs 碧琪 opened for the user survive), and, if the rollback still fails,
moves the previous version back at the next sign-in. The update cards also
find 碧琪's picture in the install folders when <state>/updates/art is
missing (updates started by 2.5.37 and earlier showed an empty circle)."""
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import time
import unittest

from app.windows_desktop import WindowsUpdater

HELPER = WindowsUpdater._directory_helper_source()


def function_body(name):
    return HELPER.split(f"function {name}", 1)[1].split("\nfunction ", 1)[0]


class LeftoverOrderTest(unittest.TestCase):
    def test_leftovers_are_stopped_before_each_folder_rename(self):
        self.assertIn("Stop-InstallLeftovers $Root", function_body("Stop-InstallProcesses"))
        swap = HELPER.index("Move-Item -LiteralPath $TargetDir -Destination $Backup")
        self.assertLess(HELPER.index("Stop-InstallProcesses $TargetDir\n"), swap)

    def test_each_leftover_is_stopped_alone(self):
        body = function_body("Stop-InstallLeftovers")
        self.assertIn("taskkill.exe /PID $process.ProcessId /F", body)
        code = "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("#"))
        self.assertNotIn("/T", code)

    def test_update_cards_find_art_in_the_install_folders(self):
        self.assertIn("$script:PinkieArtFallbacks", function_body("Get-PinkieArt"))
        fallbacks = HELPER.split("$script:PinkieArtFallbacks = @(", 1)[1].split(")\n", 1)[0]
        self.assertIn("Join-Path $TargetDir '_internal\\ui\\assets'", fallbacks)
        self.assertIn("Join-Path $Backup '_internal\\ui\\assets'", fallbacks)

    def test_failed_rollback_schedules_a_restore_at_sign_in(self):
        failed = HELPER.split('Write-UpdateLog "rollback failed:', 1)[1]
        self.assertLess(failed.index("Register-RestoreAtLogon"), failed.index("Show-UpdateProblem"))
        body = function_body("Register-RestoreAtLogon")
        self.assertIn(r"HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce", body)
        self.assertIn("if ((Test-Path -LiteralPath $TargetDir) -or -not (Test-Path -LiteralPath $Backup)) { return }", body)

    def test_only_app_helpers_are_matched_by_command_line(self):
        body = function_body("Stop-InstallLeftovers")
        self.assertIn("'msedgewebview2.exe'", body)
        self.assertNotIn("'explorer.exe'", body)
        self.assertNotIn("'code.exe'", body)
        self.assertIn("--user-data-dir=", body)

    def test_portable_command_passes_the_state_root(self):
        source = Path(__file__).resolve().parents[1].joinpath("app/windows_desktop.py").read_text(encoding="utf-8")
        launch = source.split("def launch_replacer(", 1)[1].split("else:", 1)[0]
        self.assertIn('"-StateRoot", str(state_root())', launch)


HELPER_FILE = Path(tempfile.gettempdir()) / "pinkie-update-helper-under-test.ps1"


def extract_functions(names):
    """PowerShell that defines the named functions of the real helper.

    PowerShell's own parser finds each function, so the test runs exactly the
    code the replacer ships.
    """
    HELPER_FILE.write_text(HELPER, encoding="utf-8-sig")
    lines = [f"$__helperAst = [System.Management.Automation.Language.Parser]::ParseFile('{HELPER_FILE}', [ref]$null, [ref]$null)"]
    for name in names:
        lines.append(
            "$__fn = $__helperAst.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] "
            f"-and $n.Name -eq '{name}' }}, $true); "
            f"if (-not $__fn) {{ throw 'missing function {name}' }}; . ([scriptblock]::Create($__fn.Extent.Text))"
        )
    return "\n".join(lines)


@unittest.skipUnless(os.name == "nt", "Windows process behaviour")
class LeftoverProcessIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.temporary.name)
        self.install = self.root / "超級碧琪"
        self.install.mkdir()
        self.state = self.root / "state"
        (self.state / "webview").mkdir(parents=True)
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
        self.temporary.cleanup()

    def spawn(self, *marker):
        # cmd.exe keeps its full command line, so the marker text is visible
        # to Win32_Process.CommandLine exactly like a real helper's arguments.
        command = "ping -n 60 127.0.0.1 >nul & rem " + " ".join(marker)
        child = subprocess.Popen(["cmd.exe", "/c", command], creationflags=subprocess.CREATE_NO_WINDOW)
        self.children.append(child)
        return child

    def run_powershell(self, body):
        script = self.root / "probe.ps1"
        script.write_text(body, encoding="utf-8-sig")
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
            capture_output=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        return result.stdout.decode("utf-8", "replace")

    def test_app_leftovers_stop_and_unrelated_processes_survive(self):
        by_path = self.spawn(str(self.install / "_internal" / "extensions" / "fanvpn"))
        by_profile = self.spawn("--user-data-dir=" + str(self.state / "webview"))
        bystander = self.spawn(str(self.root / "somewhere-else"))
        # A helper naming the install that has opened a program of its own
        # (ping -n 67, whose command line names nothing of the App).
        opener = subprocess.Popen(
            # Its own (hidden) console: a `start /b` child shares the parent's
            # console and dies with it, which a real opened program does not.
            # A raw command line: list quoting would escape the inner quotes.
            'cmd.exe /c "powershell -NoProfile -Command Start-Process ping -ArgumentList \'-n\',\'67\',\'127.0.0.1\' '
            f'-WindowStyle Hidden & ping -n 60 127.0.0.1 >nul & rem {self.install}"',
            creationflags=subprocess.CREATE_NO_WINDOW)
        self.children.append(opener)
        time.sleep(2.5)
        log = self.root / "updater.log"
        functions = extract_functions(["Write-UpdateLog", "Stop-InstallLeftovers"])
        out = self.run_powershell(textwrap.dedent(f"""
            $ErrorActionPreference = 'Stop'
            $LogPath = '{log}'
            $StateRoot = '{self.state}'
            {functions}
            'before=' + @(Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" | Where-Object {{ $_.CommandLine -like '*-n 67 *' }}).Count
            Stop-InstallLeftovers '{self.install}'
            Start-Sleep -Milliseconds 800
            $opened = @(Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" | Where-Object {{ $_.CommandLine -like '*-n 67 *' }})
            $opened.Count
            $opened | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}
        """))
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and (by_path.poll() is None or by_profile.poll() is None):
            time.sleep(.2)
        self.assertIsNotNone(opener.poll(), "the helper that opened a program kept running")
        self.assertIsNotNone(by_path.poll(), "a helper naming the install folder kept running")
        self.assertIsNotNone(by_profile.poll(), "a process on the App's WebView2 profile kept running")
        self.assertIsNone(bystander.poll(), "an unrelated process was stopped")
        self.assertIn("before=1", out, "the fixture did not start its opened program")
        self.assertEqual(out.strip().splitlines()[-1], "1", "a program the stopped helper had opened was stopped too")
        self.assertIn("stopping leftover processes of the App", log.read_text(encoding="utf-8-sig"))

    def test_restore_at_sign_in_script_moves_the_backup_back(self):
        backup = self.root / "超級碧琪.previous-0123"
        self.install.rename(backup)
        (backup / "超級碧琪.exe").write_text("exe", encoding="utf-8")
        updates = self.root / "updates"
        updates.mkdir()
        log = self.root / "updater.log"
        functions = extract_functions(["Write-UpdateLog", "Register-RestoreAtLogon"])
        out = self.run_powershell(textwrap.dedent(f"""
            $ErrorActionPreference = 'Stop'
            $TargetDir = '{self.install}'
            $Backup = '{backup}'
            $UpdateRoot = '{updates}'
            $LogPath = '{log}'
            $Token = '0123456789abcdef0123456789abcdef'
            # Never touch the real registry from a test.
            function New-Item {{ param($Path, [switch]$Force) }}
            function Set-ItemProperty {{ param($Path, $Name, $Value) "runonce=$Name|$Value" }}
            {functions}
            Register-RestoreAtLogon
        """))
        self.assertIn("runonce=SuperPinkieRestore-01234567|", out)
        restore = next(updates.glob("restore-*.ps1"))
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(restore)],
            capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        self.assertTrue((self.install / "超級碧琪.exe").is_file())
        self.assertFalse(backup.exists())
        self.assertFalse(restore.exists())
        self.assertIn("previous version restored at sign-in", log.read_text(encoding="utf-8-sig"))


if __name__ == "__main__":
    unittest.main()
