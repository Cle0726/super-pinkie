"""便携版更新后「没有变化」：旧网关挡住目录替换，或者新版直接接上了旧网关。"""
import json
import os
from pathlib import Path
import subprocess
import sys
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

    def test_an_ipv6_only_loopback_listener_is_still_found(self):
        """双栈竞争：127.0.0.1 被别的程序占住，网关退而绑定 [::1]（Windows 允许两个地址族各自
        独立监听同一端口号）。旧代码只认 ``TCP`` 这一行前缀，``TCP6`` 整行被跳过——找不到占着
        端口的网关，retire_stale() 就不退它，更新后新版又接上旧网关，还是「更新了没变化」。
        """
        output = (
            "  TCP6   [::1]:18789            [::]:0                 LISTENING       4343\n"
            "  TCP6   [::1]:18790            [::]:0                 ESTABLISHED     4343\n"
        )
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 0, output, ""))
        self.assertEqual(4343, gateway_listener_pid(18789, runner=runner))
        self.assertIsNone(gateway_listener_pid(18790, runner=runner))

    def test_an_ipv4_listener_is_found_even_next_to_an_unrelated_ipv6_row(self):
        """双栈但两边各管各的端口：TCP6 那行不该挡住同端口号 TCP 行的匹配。"""
        output = (
            "  TCP6   [::1]:28789            [::]:0                 LISTENING       9001\n"
            "  TCP    127.0.0.1:18789        0.0.0.0:0              LISTENING       4242\n"
        )
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 0, output, ""))
        self.assertEqual(4242, gateway_listener_pid(18789, runner=runner))

    def test_netstat_in_a_non_utf8_console_code_page_does_not_crash_startup(self):
        """法语 / 德语 Windows 的 netstat 按控制台 OEM 代码页输出（État → 0x90）。

        旧代码 text=True 不带 errors：按 cp1252 或 UTF-8（PYTHONUTF8=1）严格解码都在读线程里抛
        UnicodeDecodeError，stdout 变 None，找不到占着端口的旧网关，retire_stale() 就不退它——
        更新后新版接上旧网关，又是「更新了没变化」。只用到 ASCII 字段，坏字节替换掉就行。
        """
        output = (
            b"  Proto  Adresse locale          Adresse distante       \x90tat\r\n"
            b"  TCP    127.0.0.1:18789        0.0.0.0:0              LISTENING       4242\r\n"
        )
        script = f"import sys; sys.stdout.buffer.write({output!r})"
        passed = ("capture_output", "text", "encoding", "errors", "timeout")

        def runner(command, **options):
            return subprocess.run([sys.executable, "-c", script], **{k: v for k, v in options.items() if k in passed})

        self.assertEqual(4242, gateway_listener_pid(18789, runner=runner))


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

    # ---- B44: branches the cases above did not reach ----
    def _stale(self, ready, kill, wait=0):
        logs = []
        listener = {"pid": 9, "image": "C:/old/node.exe", "started": 1}
        with mock.patch.object(windows_desktop, "http_ready", side_effect=ready), \
                mock.patch.object(GatewaySupervisor, "_listener", return_value=listener), \
                mock.patch.object(windows_desktop, "stale_gateway_reason", return_value="another version"), \
                mock.patch.object(windows_desktop, "append_log", lambda _kind, message: logs.append(message)):
            return self.supervisor.retire_stale(kill=kill, wait=wait), logs

    def test_b44_kill_that_fails_leaves_it_and_says_so(self):
        for error in (OSError("access denied"), subprocess.TimeoutExpired("taskkill", 8)):
            def kill(_pid, error=error):
                raise error
            reason, logs = self._stale(lambda _: True, kill)
            self.assertIsNone(reason)
            self.assertTrue(any("could not be stopped" in line for line in logs), logs)

    def test_b44_gateway_still_answering_after_stop_is_logged(self):
        killed = []
        reason, logs = self._stale(lambda _: True, killed.append, wait=0.3)
        self.assertEqual("another version", reason)
        self.assertEqual([9], killed)
        self.assertTrue(any("still answering" in line and "pid=9" in line for line in logs), logs)

    def test_b44_gateway_gone_after_stop_logs_nothing_more(self):
        ready = iter([True, False])
        reason, logs = self._stale(lambda _: next(ready), lambda _pid: None, wait=1)
        self.assertEqual("another version", reason)
        self.assertFalse(any("still answering" in line for line in logs), logs)

    def test_b44_answer_without_a_listener_pid_is_left_alone(self):
        with mock.patch.object(windows_desktop, "http_ready", return_value=True), \
                mock.patch.object(GatewaySupervisor, "_listener", return_value=None):
            self.assertIsNone(self.supervisor.retire_stale(kill=self.fail, wait=0))


class RestartBackoffTest(unittest.TestCase):
    """B44: a gateway that never gets ready (port held by another program, dies at once)
    used to be respawned every 2 s forever."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name) / "app"
        (root / "runtime/bin").mkdir(parents=True)
        (root / "VERSION").write_text("2.5.27\n", encoding="utf-8")
        state = Path(self.temp.name) / "state"
        state.mkdir()
        self.clock = [1000.0]
        self.spawned = []

        class Dead:
            pid = 9

            def poll(self):
                return 1

        for patch in (mock.patch.object(windows_desktop, "state_root", return_value=state),
                      mock.patch.object(windows_desktop, "http_ready", return_value=False),
                      mock.patch.object(windows_desktop, "keep_gateway_after_close", return_value=True),
                      mock.patch.object(windows_desktop, "append_log", lambda *_: None),
                      mock.patch.object(windows_desktop.time, "monotonic", lambda: self.clock[0]),
                      mock.patch.object(GatewaySupervisor, "root_proxy", return_value=None),
                      # a plain function, not side_effect: a Mock keeps call args, i.e. the open gateway.log,
                      # and Windows then cannot delete the temp folder
                      mock.patch.object(windows_desktop.subprocess, "Popen",
                                        new=lambda *a, **k: self.spawned.append(self.clock[0]) or Dead())):
            patch.start()
            self.addCleanup(patch.stop)
        self.supervisor = GatewaySupervisor(BundledRuntime(root))

    def tick(self, seconds, step=.75):
        for _ in range(int(seconds / step)):
            self.clock[0] += step
            self.supervisor.start()

    def test_respawns_back_off_to_a_minute(self):
        self.supervisor.start()
        self.tick(600)
        gaps = [b - a for a, b in zip(self.spawned, self.spawned[1:])]
        self.assertLess(len(self.spawned), 20, gaps)  # was ~270 in ten minutes
        self.assertTrue(all(later >= earlier for earlier, later in zip(gaps, gaps[1:])), gaps)
        self.assertGreaterEqual(gaps[-1], 60)
        self.assertLess(gaps[-1], 62)
        self.assertLess(gaps[0], 3)  # the first retry is still quick

    def test_ready_gateway_resets_the_backoff(self):
        self.supervisor.start()
        self.tick(300)
        with mock.patch.object(GatewaySupervisor, "config_repair", create=True):
            self.supervisor.note_ready()
        before = len(self.spawned)
        self.tick(3)
        self.assertEqual(before + 1, len(self.spawned))


    def test_repair_button_restarts_at_once_even_after_a_minute_of_backoff(self):
        # #317 review: the startup page's repair button is pressed exactly when the gateway keeps failing,
        # i.e. when the gap has grown to 60 s; start() then returned and the page still said it restarted.
        self.supervisor.start()
        self.tick(600)
        self.assertEqual(self.supervisor.restart_gap, 60.0)
        self.clock[0] = self.spawned[-1] + 5  # 5 s after the last respawn: well inside the 60 s gap
        before = len(self.spawned)
        bridge = windows_desktop.NativeBridge(mock.Mock())
        bridge._gateway = self.supervisor
        with mock.patch.object(GatewaySupervisor, "repair_config", return_value={"repaired": True, "step": "migration", "message": "已经自动修好"}):
            self.assertEqual(bridge.startup_repair(), {"ok": True, "message": "已经自动修好"})
        self.assertEqual(before + 1, len(self.spawned), "repair did not start the gateway right away")
        self.assertEqual(self.supervisor.restart_gap, 2.0)

class ReplacerTest(unittest.TestCase):
    def test_portable_swap_stops_processes_from_the_install_first(self):
        helper = WindowsUpdater._directory_helper_source()
        swap = helper.index("Move-Folder $TargetDir $Backup")
        self.assertLess(helper.index("Stop-InstallProcesses $TargetDir\n"), swap)
        self.assertIn("ExecutablePath.StartsWith($prefix", helper)
        self.assertIn("Invoke-WithRetry", helper)
        self.assertIn("'install folder' $SwapSeconds", helper)

    def test_health_marker_is_not_enough_when_an_old_gateway_reappears(self):
        helper = WindowsUpdater._directory_helper_source()
        health = helper.index("if (Test-Path -LiteralPath $HealthMarker) { $ready = $true; break }")
        validate = helper.index("if ($ready -and (Test-Path -LiteralPath $TargetExe)) {\n    Confirm-NewInstallGateway", health)
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
