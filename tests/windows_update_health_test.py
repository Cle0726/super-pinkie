"""Portable update health handshake (11-04): why "updated but nothing changed".

The replacer of the version being *replaced* decides whether the new folder
stays.  2.5.27-2.5.31 helpers only waited 120 s for "<token>.ready", which the
new version wrote after its chat page loaded -- i.e. after per-version setup
and a cold gateway start over freshly unpacked files.  When that took longer,
the helper killed a healthy new version and moved the old folder back.

These tests pin both halves of the fix: the new version answers each helper
generation at the earliest moment that helper accepts, and the new helper
never rolls back a started version merely for being slow.
"""
from pathlib import Path
import os
import socket
import tempfile
import time
import unittest

from app.windows_desktop import UpdateHealthReporter, WindowsUpdater, update_helper_protocol, update_in_progress

TOKEN = "0123456789abcdef0123456789abcdef"

# Distinguishing lines of the helpers that shipped in releases (verbatim).
HELPER_2_5_27 = "function Restore-PreviousVersion {\n  $launched = Start-Process -FilePath $TargetExe -ArgumentList \"--update-health-token=$Token\" -PassThru\n"
HELPER_2_5_29 = HELPER_2_5_27 + "function Confirm-NewInstallGateway {\n  throw 'new gateway is not listening'\n}\n"


class ProtocolDetectionTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "updates").mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def _helper(self, text):
        (self.root / "updates" / f"apply-{TOKEN}.ps1").write_text(text, encoding="utf-8-sig")

    def test_each_released_helper_generation_is_recognised(self):
        self._helper(HELPER_2_5_27)
        self.assertEqual("marker", update_helper_protocol(TOKEN, self.root))
        self._helper(HELPER_2_5_29)
        self.assertEqual("gateway", update_helper_protocol(TOKEN, self.root))
        for source in (WindowsUpdater._directory_helper_source(), WindowsUpdater._helper_source()):
            self._helper(source)
            self.assertEqual("two-phase", update_helper_protocol(TOKEN, self.root))

    def test_missing_helper_is_treated_as_the_strictest_generation(self):
        self.assertEqual("gateway", update_helper_protocol(TOKEN, self.root))


class ReporterTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "updates").mkdir()
        self.node = self.root / "new" / "_internal" / "runtime" / "bin" / "node.exe"
        self.listener = {"pid": 7, "image": None}
        os.environ["PINKIE_STATE_ROOT"] = str(self.root)

    def tearDown(self):
        os.environ.pop("PINKIE_STATE_ROOT", None)
        self.temporary.cleanup()

    def _marker(self, suffix):
        return self.root / "updates" / "health" / f"{TOKEN}{suffix}"

    def _reporter(self, helper, port=None):
        (self.root / "updates" / f"apply-{TOKEN}.ps1").write_text(helper, encoding="utf-8-sig")
        return UpdateHealthReporter(TOKEN, self.node, listener=lambda: dict(self.listener),
                                    root=self.root, poll=.01, limit=5, port=port or self._free_port(), hold_limit=5)

    @staticmethod
    def _free_port():
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            return probe.getsockname()[1]

    @staticmethod
    def _listening(port):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.5):
                return True
        except OSError:
            return False

    def _wait(self, path, seconds=2):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and not path.exists():
            time.sleep(.01)
        return path.exists()

    def test_marker_only_helper_is_answered_at_process_start(self):
        # 2.5.27/2.5.28 check nothing after the marker; answering at once is
        # what lets an update from them survive a slow first start.
        reporter = self._reporter(HELPER_2_5_27)
        self.assertIsNone(reporter.start())
        self.assertTrue(self._marker(".started").is_file())
        self.assertTrue(self._marker(".ready").is_file())

    def test_gateway_helper_is_answered_within_seconds_from_the_new_exe(self):
        # 2.5.29-2.5.31 accept only if every listener on the gateway port runs
        # from the new folder, and give up after 120 s.  Users in China cannot
        # fall back to a manual GitHub download, so the new exe answers at once
        # by listening on the port itself, then frees it for the real gateway
        # as soon as the old helper has finished (it deletes its own script).
        port = self._free_port()
        reporter = self._reporter(HELPER_2_5_29, port=port)
        thread = reporter.start()
        self.assertTrue(self._marker(".started").is_file())
        self.assertTrue(self._marker(".ready").is_file(), "must not wait for the cold gateway")
        self.assertTrue(self._listening(port))
        self.assertFalse(reporter.port_free.is_set(), "the real gateway must wait for the helper")
        time.sleep(.3)
        self.assertFalse(reporter.port_free.is_set())
        (self.root / "updates" / f"apply-{TOKEN}.ps1").unlink()  # helper finished
        self.assertTrue(reporter.wait_for_gateway_port(timeout=3))
        thread.join(timeout=2)
        self.assertFalse(self._listening(port))
        # The port can now be bound by the real gateway.
        with socket.socket() as gateway:
            gateway.bind(("127.0.0.1", port))

    def test_gateway_helper_without_a_free_port_waits_for_our_own_gateway(self):
        with socket.socket() as busy:
            busy.bind(("127.0.0.1", 0)); busy.listen(1)
            reporter = self._reporter(HELPER_2_5_29, port=busy.getsockname()[1])
            thread = reporter.start()
            self.assertTrue(reporter.port_free.is_set())
            time.sleep(.1)
            self.assertFalse(self._marker(".ready").exists())
            self.listener["image"] = str(self.root / "old" / "_internal" / "runtime" / "bin" / "node.exe")
            time.sleep(.1)
            self.assertFalse(self._marker(".ready").exists(), "an old install's gateway must not count")
            self.listener["image"] = str(self.node)
            self.assertTrue(self._wait(self._marker(".ready")))
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive())

    def test_helper_that_never_finishes_cannot_block_the_gateway_forever(self):
        reporter = self._reporter(HELPER_2_5_29)
        reporter.hold_limit = .3
        reporter.start()
        self.assertTrue(reporter.wait_for_gateway_port(timeout=3))

    def test_two_phase_helper_gets_started_now_and_ready_from_the_page_or_gateway(self):
        reporter = self._reporter(WindowsUpdater._directory_helper_source())
        thread = reporter.start()
        self.assertTrue(self._marker(".started").is_file())
        self.assertFalse(self._marker(".ready").exists())
        reporter.ready()  # the chat page loaded first
        self.assertTrue(self._marker(".ready").is_file())
        thread.join(timeout=2)
        self.assertFalse(thread.is_alive())


class InProgressGuardTest(unittest.TestCase):
    """Opening the App during the swap used to show the old version."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "updates").mkdir()
        (self.root / "updates" / "in-progress.json").write_text('{"pid": 42, "version": "2.5.32"}', encoding="utf-8-sig")

    def tearDown(self):
        self.temporary.cleanup()

    def test_live_helper_blocks_a_second_start(self):
        image = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        self.assertEqual("2.5.32", update_in_progress(self.root, image_of=lambda pid: image if pid == 42 else None))

    def test_leftover_file_never_locks_the_user_out(self):
        self.assertIsNone(update_in_progress(self.root, image_of=lambda pid: None))
        self.assertIsNone(update_in_progress(self.root, image_of=lambda pid: r"C:\Windows\notepad.exe"))
        (self.root / "updates" / "in-progress.json").write_text("not json", encoding="utf-8")
        self.assertIsNone(update_in_progress(self.root, image_of=lambda pid: "powershell.exe"))

    def test_helper_writes_and_clears_the_guard(self):
        helper = WindowsUpdater._directory_helper_source()
        written = helper.index("Set-Content -LiteralPath $InProgress")
        self.assertLess(written, helper.index("[IO.File]::WriteAllText($ReadyMarker, $Token"))
        restore = helper.index("function Restore-PreviousVersion")
        self.assertLess(helper.index("Remove-Item -LiteralPath $InProgress", restore),
                        helper.index("Start-Process -FilePath $TargetExe | Out-Null", restore))
        self.assertIn("Remove-Item -LiteralPath $InProgress -Force -ErrorAction SilentlyContinue\nRemove-Item -LiteralPath $PSCommandPath", helper)


class NewHelperTest(unittest.TestCase):
    def setUp(self):
        self.helpers = (WindowsUpdater._directory_helper_source(), WindowsUpdater._helper_source())

    def test_started_version_is_never_rolled_back_for_being_slow(self):
        for helper in self.helpers:
            self.assertIn("pinkie-update-protocol: 2", helper)
            self.assertIn("[int]$StartSeconds = 120", helper)
            self.assertIn("[int]$ReadySeconds = 900", helper)
            # Only an unstarted or exited new version is a failure.
            self.assertIn("throw 'new version did not start'", helper)
            self.assertIn("new version exited before it was ready", helper)
            self.assertIn("keeping it", helper)
            self.assertNotIn("new version did not become healthy", helper)
            kill = helper.index("taskkill.exe /PID $launched.Id")
            self.assertLess(helper.rindex("if (-not $started -and (Get-Date) -ge $startDeadline)", 0, kill), kill)

    def test_every_folder_rename_is_retried(self):
        helper = WindowsUpdater._directory_helper_source()
        self.assertIn("Invoke-WithRetry { Move-Item -LiteralPath $newDir -Destination $TargetDir }", helper)
        self.assertIn("'install folder' $SwapSeconds", helper)
        self.assertIn("'previous version folder' $SwapSeconds", helper)
        self.assertNotIn("Remove-Item -LiteralPath $TargetDir -Recurse", helper,
                         "rollback must rename the failed copy aside, never half-delete it in place")

    def test_unpack_stays_out_of_desktop_and_onedrive_when_possible(self):
        helper = WindowsUpdater._directory_helper_source()
        self.assertIn("$stageParent = $UpdateRoot", helper)
        self.assertIn("GetPathRoot", helper)
        self.assertIn("Remove-Item -LiteralPath $script:stage -Recurse", helper)

    def test_unpack_uses_the_fast_extractor_with_a_fallback(self):
        helper = WindowsUpdater._directory_helper_source()
        fast = helper.index("[System.IO.Compression.ZipFile]::ExtractToDirectory($Payload, $stage)")
        self.assertLess(helper.index("Get-FileHash -LiteralPath $Payload"), fast)
        self.assertLess(fast, helper.index("Expand-Archive -LiteralPath $Payload -DestinationPath $stage -Force"))

    def test_failed_rollback_is_shown_to_the_user(self):
        helper = WindowsUpdater._directory_helper_source()
        failed = helper.index('Write-UpdateLog "rollback failed')
        self.assertLess(failed, helper.index("Show-UpdateProblem (", failed))
        self.assertIn("System.Windows.MessageBox", helper)

    def test_launch_passes_the_health_budgets(self):
        self.assertEqual(120, WindowsUpdater.health_start_seconds)
        self.assertEqual(900, WindowsUpdater.health_ready_seconds)

    def test_previous_copy_is_not_deleted_until_the_new_one_is_ready(self):
        # Clicking restart used to rename the desktop exe away, then delete it
        # before the new window existed. The shortcut then said the program
        # had been deleted, and a failed move left nothing to open.
        onefile = WindowsUpdater._helper_source()
        self.assertNotIn("Remove-Item -LiteralPath $Target -Force", onefile)
        put_back = onefile.index("Move-Item -LiteralPath $Backup -Destination $Target -Force")
        self.assertLess(put_back, onefile.index("Remove-Item -LiteralPath $failed -Force", put_back))
        self.assertLess(onefile.index("if ($ready -and (Test-Path -LiteralPath $Target))"),
                        onefile.index("Remove-Item -LiteralPath $Backup -Force"))
        portable = WindowsUpdater._directory_helper_source()
        put_back = portable.index("'previous version folder' $SwapSeconds")
        self.assertLess(put_back, portable.index("Remove-Item -LiteralPath $failed -Recurse -Force"))
        self.assertLess(portable.index("if ($ready -and (Test-Path -LiteralPath $TargetExe))"),
                        portable.index("Remove-Item -LiteralPath $Backup -Recurse -Force"))
        self.assertIn("请不要点击桌面上的图标", portable)
        self.assertNotIn("新版本已经打开，正在完成首次启动", portable)


if __name__ == "__main__":
    unittest.main()
