"""便携版更新后「没有变化」：旧网关挡住目录替换，或者新版直接接上了旧网关。"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

from app import windows_desktop
from app.windows_desktop import (
    BundledRuntime,
    GatewaySupervisor,
    WindowsUpdater,
    gateway_listener_pid,
    stale_gateway_reason,
)

NODE = r"F:\SuperPinkie\_internal\runtime\bin\node.exe"


class StaleGatewayReasonTest(unittest.TestCase):
    def test_a_users_own_gateway_is_never_replaced(self):
        listener = {"pid": 7, "image": r"C:\Program Files\nodejs\node.exe", "started": 1}
        self.assertIsNone(stale_gateway_reason(listener, NODE, "2.5.27", 100))

    def test_unknown_owner_is_left_alone(self):
        self.assertIsNone(stale_gateway_reason({"pid": 7, "image": None}, NODE, "2.5.27", 100))

    def test_recorded_gateway_of_another_version_is_stale(self):
        listener = {"pid": 7, "image": NODE, "started": 500}
        record = {"pid": 7, "version": "2.5.26"}
        self.assertIn("2.5.26", stale_gateway_reason(listener, NODE, "2.5.27", 100, record))
        self.assertIsNone(stale_gateway_reason(listener, NODE, "2.5.26", 100, record))

    def test_same_folder_gateway_older_than_the_install_is_stale(self):
        # 原地更新：路径一样，但进程比这次解压出来的文件还早启动。
        old = {"pid": 7, "image": NODE, "started": 50}
        self.assertIn("before this install", stale_gateway_reason(old, NODE, "2.5.27", 100))
        fresh = {"pid": 7, "image": NODE, "started": 150}
        self.assertIsNone(stale_gateway_reason(fresh, NODE, "2.5.27", 100))

    def test_gateway_from_another_install_folder(self):
        other = {"pid": 7, "image": r"D:\Downloads\超級碧琪\_internal\runtime\bin\node.exe", "started": 1}
        self.assertIn("another install", stale_gateway_reason(other, NODE, "2.5.27", 100, read_version=lambda _: "2.5.24"))
        # 单文件 EXE 每次启动换一个临时目录：同版本的照常复用。
        self.assertIsNone(stale_gateway_reason(other, NODE, "2.5.27", 100, read_version=lambda _: "2.5.27"))
        self.assertIn("unknown version", stale_gateway_reason(other, NODE, "2.5.27", 100, read_version=lambda _: "0.0.0"))


class ListenerTest(unittest.TestCase):
    def test_reads_the_listening_pid_for_the_gateway_port(self):
        output = (
            "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1000\n"
            "  TCP    127.0.0.1:18789        0.0.0.0:0              LISTENING       4242\n"
            "  TCP    127.0.0.1:18789        127.0.0.1:50000        ESTABLISHED     4242\n"
        )
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 0, output, ""))
        self.assertEqual(4242, gateway_listener_pid(18789, runner=runner))
        self.assertIsNone(gateway_listener_pid(18790, runner=runner))


class RetireStaleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name) / "app"
        (root / "runtime/bin").mkdir(parents=True)
        (root / "VERSION").write_text("2.5.27\n", encoding="utf-8")
        self.state = Path(self.temp.name) / "state"
        patch = mock.patch.object(windows_desktop, "state_root", return_value=self.state)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.temp.cleanup)
        self.supervisor = GatewaySupervisor(BundledRuntime(root))

    def test_an_older_kept_alive_gateway_is_stopped_before_attaching(self):
        self.state.mkdir(parents=True)
        (self.state / "gateway-owner.json").write_text(json.dumps({"pid": 9, "version": "2.5.26"}), encoding="utf-8")
        listener = {"pid": 9, "image": str(self.supervisor.runtime.node), "started": 1}
        ready = iter([True, False])
        killed = []
        with mock.patch.object(windows_desktop, "http_ready", side_effect=lambda _: next(ready)), \
                mock.patch.object(GatewaySupervisor, "_listener", return_value=listener):
            reason = self.supervisor.retire_stale(kill=killed.append, wait=1)
        self.assertIn("2.5.26", reason)
        self.assertEqual([9], killed)

    def test_current_gateway_is_kept_and_recorded(self):
        listener = {"pid": 9, "image": str(self.supervisor.runtime.node), "started": os.path.getctime(self.supervisor.runtime.root / "VERSION") + 60}
        killed = []
        with mock.patch.object(windows_desktop, "http_ready", return_value=True), \
                mock.patch.object(GatewaySupervisor, "_listener", return_value=listener):
            self.assertIsNone(self.supervisor.retire_stale(kill=killed.append, wait=0))
        self.assertEqual([], killed)
        record = json.loads((self.state / "gateway-owner.json").read_text(encoding="utf-8"))
        self.assertEqual({"pid": 9, "version": "2.5.27"}, {k: record[k] for k in ("pid", "version")})

    def test_nothing_running_means_nothing_to_retire(self):
        with mock.patch.object(windows_desktop, "http_ready", return_value=False):
            self.assertIsNone(self.supervisor.retire_stale(kill=self.fail))


class ReplacerTest(unittest.TestCase):
    def test_portable_swap_stops_processes_from_the_install_first(self):
        helper = WindowsUpdater._directory_helper_source()
        swap = helper.index("Move-Item -LiteralPath $TargetDir -Destination $Backup")
        self.assertLess(helper.index("Stop-InstallProcesses $TargetDir\n"), swap)
        self.assertIn("ExecutablePath.StartsWith($prefix", helper)
        self.assertIn("Invoke-WithRetry", helper)
        self.assertIn("'install folder' $SwapSeconds", helper)

    def test_health_marker_is_not_enough_when_an_old_gateway_reappears(self):
        helper = WindowsUpdater._directory_helper_source()
        health = helper.index("if (Test-Path -LiteralPath $HealthMarker) { $ready = $true; break }")
        validate = helper.index("if ($ready) { Confirm-NewInstallGateway }", health)
        remove_backup = helper.index("Remove-Item -LiteralPath $Backup -Recurse", validate)
        self.assertLess(health, validate)
        self.assertLess(validate, remove_backup)
        self.assertIn("new version attached to a different install gateway", helper)

    def test_both_replacers_record_a_rollback_for_the_next_launch(self):
        for helper in (WindowsUpdater._helper_source(), WindowsUpdater._directory_helper_source()):
            self.assertIn("[string]$Version = ''", helper)
            self.assertIn("Write-UpdateFailure $_.Exception.Message", helper)
            self.assertIn("last-failure.json", helper)

    def test_last_failure_is_read_once(self):
        with tempfile.TemporaryDirectory() as temp, \
                mock.patch.object(windows_desktop, "state_root", return_value=Path(temp)):
            path = Path(temp) / "updates/last-failure.json"
            path.parent.mkdir(parents=True)
            path.write_text("\ufeff" + json.dumps({"version": "2.5.27", "message": "install folder is still in use"}), encoding="utf-8")
            self.assertEqual("2.5.27", WindowsUpdater.take_last_failure()["version"])
            self.assertFalse(path.exists())
            self.assertIsNone(WindowsUpdater.take_last_failure())

    def test_replacer_is_told_which_version_it_installs(self):
        with tempfile.TemporaryDirectory() as temp:
            app_dir = Path(temp) / "超級碧琪"
            (app_dir / "_internal").mkdir(parents=True)
            exe = app_dir / "超級碧琪.exe"
            exe.write_bytes(b"x")
            payload = Path(temp) / "p.zip"
            payload.write_bytes(b"zip")
            updater = WindowsUpdater(Path(temp), executable=exe)
            updater.prepared = {"payload": str(payload), "sha256": updater._file_hash(payload), "version": "2.5.27"}
            with mock.patch.object(windows_desktop, "state_root", return_value=Path(temp) / "state"), \
                    mock.patch.object(windows_desktop.subprocess, "Popen") as popen, \
                    mock.patch.object(WindowsUpdater, "_wait_for_replacer", return_value=True):
                self.assertTrue(updater.launch_replacer()["started"])
            command = popen.call_args.args[0]
            self.assertEqual("2.5.27", command[command.index("-Version") + 1])
            # PowerShell 5.1 only reads the 超級碧琪 names correctly with a BOM.
            helper = Path(command[command.index("-File") + 1]).read_bytes()
            self.assertTrue(helper.startswith(b"\xef\xbb\xbf"))
            self.assertIn("超級碧琪".encode("utf-8"), helper)


if __name__ == "__main__":
    unittest.main()
