"""关掉窗口就是关掉碧琪：网关、它开出来的进程、辅助进程都跟着停，EXE 自己也退出。

原来窗口关了网关还留着（「给后台会话用」），用户反馈关掉以后占用一直在。
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import ntpath
import unittest
from types import SimpleNamespace
from unittest import mock

from app import windows_desktop
from app.windows_desktop import GatewaySupervisor, finish_exit, keep_gateway_after_close

NODE = r"F:\SuperPinkie\_internal\runtime\bin\node.exe"

# close() writes the watchdog marker and logs: keep both out of the real profile.
_STATE = tempfile.TemporaryDirectory()
_ENV = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": _STATE.name})


def setUpModule():
    _ENV.start()


def tearDownModule():
    _ENV.stop()
    _STATE.cleanup()


def supervisor():
    runtime = SimpleNamespace(root=None, node=NODE, openclaw=None)
    with mock.patch.object(windows_desktop, "app_version", return_value="2.5.50"):
        return GatewaySupervisor(runtime)


class KeepGatewayTest(unittest.TestCase):
    def test_closing_the_window_stops_the_gateway_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PINKIE_KEEP_GATEWAY", None)
            self.assertFalse(keep_gateway_after_close())

    def test_the_old_behaviour_is_opt_in(self):
        with mock.patch.dict(os.environ, {"PINKIE_KEEP_GATEWAY": "1"}):
            self.assertTrue(keep_gateway_after_close())
        with mock.patch.dict(os.environ, {"PINKIE_KEEP_GATEWAY": "0"}):
            self.assertFalse(keep_gateway_after_close())


class GatewayCloseTest(unittest.TestCase):
    def test_close_stops_the_started_process_and_an_adopted_one(self):
        gateway = supervisor()
        with mock.patch.object(gateway, "stop_process") as stop, mock.patch.object(gateway, "stop_adopted") as adopted:
            gateway.close()
        self.assertTrue(gateway.closing.is_set())
        stop.assert_called_once()
        adopted.assert_called_once()

    def test_an_adopted_gateway_of_this_install_is_stopped(self):
        gateway = supervisor()
        with mock.patch.object(gateway, "_listener", return_value={"pid": 4321, "image": NODE.upper()}), \
                mock.patch.object(windows_desktop, "kill_process_tree") as kill, \
                mock.patch.object(windows_desktop, "append_log"), \
                mock.patch.object(windows_desktop.os.path, "normcase", ntpath.normcase):
            self.assertTrue(gateway.stop_adopted())
        kill.assert_called_once_with(4321)

    def test_a_gateway_the_user_runs_themselves_is_left_alone(self):
        gateway = supervisor()
        for listener in (None, {"pid": 9, "image": None}, {"pid": 9, "image": r"C:\Program Files\nodejs\node.exe"}):
            with mock.patch.object(gateway, "_listener", return_value=listener), \
                    mock.patch.object(windows_desktop, "kill_process_tree") as kill:
                self.assertFalse(gateway.stop_adopted())
            kill.assert_not_called()

    def test_close_leaves_a_marker_the_watchdog_stands_down_on_and_a_new_launch_clears_it(self):
        # An install that registered the gateway watchdog would otherwise start
        # the gateway again seconds after the user closed the window.
        with tempfile.TemporaryDirectory() as state, mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": state}):
            gateway = supervisor()
            marker = Path(state) / "gateway-closed-by-app"
            with mock.patch.object(gateway, "stop_process"), mock.patch.object(gateway, "stop_adopted"):
                gateway.close()
            self.assertTrue(marker.exists())
            self.assertEqual(windows_desktop.gateway_closed_marker(), marker)
            watchdog = (Path(windows_desktop.__file__).resolve().parents[1]
                        / "services" / "watchdog" / "windows-gateway-watchdog.ps1").read_text(encoding="utf-8-sig")
            self.assertIn('"gateway-closed-by-app"', watchdog)
            self.assertRegex(watchdog, r"Test-Path -LiteralPath \$ClosedMarker\)\s*\{\s*\$script:missCount = 0\s*return")

            launch = supervisor()
            with mock.patch.object(windows_desktop, "http_ready", return_value=True):
                launch.start()
            self.assertFalse(marker.exists(), "the next launch lets the watchdog recover crashes again")

    def test_start_after_close_spawns_nothing(self):
        # A monitor tick already past its wait must not bring the gateway back.
        gateway = supervisor()
        gateway.closing.set()
        with mock.patch.object(windows_desktop.subprocess, "Popen") as popen, \
                mock.patch.object(windows_desktop, "http_ready", return_value=False):
            gateway.start()
        popen.assert_not_called()

    def test_a_failed_kill_is_logged_not_raised(self):
        gateway = supervisor()
        with mock.patch.object(gateway, "_listener", return_value={"pid": 5, "image": NODE}), \
                mock.patch.object(windows_desktop, "kill_process_tree", side_effect=OSError("denied")), \
                mock.patch.object(windows_desktop, "append_log") as log:
            self.assertFalse(gateway.stop_adopted())
        self.assertIn("could not be stopped", log.call_args.args[1])


class FinishExitTest(unittest.TestCase):
    def run_exit(self, environment):
        order = []
        gateway = SimpleNamespace(close=lambda: order.append("gateway"))
        native = SimpleNamespace(stop=lambda: order.append("tray"))
        bridge = SimpleNamespace(_native_bridge=native)
        with mock.patch.dict(os.environ, environment), \
                mock.patch.object(windows_desktop.atexit, "_run_exitfuncs", side_effect=lambda: order.append("atexit")), \
                mock.patch.object(windows_desktop, "cleanup_orphan_webview", side_effect=lambda _path: order.append("webview")), \
                mock.patch.object(windows_desktop, "append_log"):
            finish_exit(bridge, gateway, "storage", leave=lambda code: order.append(("exit", code)))
        return order

    def test_everything_is_stopped_before_the_hard_exit(self):
        os.environ.pop("PINKIE_KEEP_GATEWAY", None)
        self.assertEqual(self.run_exit({}), ["gateway", "tray", "atexit", "webview", ("exit", 0)])

    def test_keep_gateway_still_exits_the_app_itself(self):
        self.assertEqual(self.run_exit({"PINKIE_KEEP_GATEWAY": "1"}), ["tray", "atexit", "webview", ("exit", 0)])

    def test_one_failing_step_does_not_stop_the_exit(self):
        def broken():
            raise RuntimeError("boom")

        left = []
        with mock.patch.object(windows_desktop.atexit, "_run_exitfuncs", side_effect=broken), \
                mock.patch.object(windows_desktop, "cleanup_orphan_webview", side_effect=broken), \
                mock.patch.object(windows_desktop, "append_log"):
            finish_exit(SimpleNamespace(_native_bridge=SimpleNamespace(stop=broken)),
                        SimpleNamespace(close=broken), "storage", leave=left.append)
        self.assertEqual(left, [0])


class LifetimeBindingTest(unittest.TestCase):
    def test_children_join_the_kill_on_close_job(self):
        source = Path(windows_desktop.__file__).read_text(encoding="utf-8")
        self.assertIn('bind_to_app_lifetime(self.process, "gateway")', source)
        self.assertIn('bind_to_app_lifetime(process, "desktop control node")', source)
        self.assertIn('bind_to_app_lifetime(self.relay, "relay")', source)
        # A kept gateway must not be in the job, or it would die with the window after all.
        self.assertRegex(source, r"if not keep_gateway_after_close\(\):\s+bind_to_app_lifetime\(self\.process")
        # Any window left open (the quick-ask box) keeps webview.start() from
        # returning, so finish_exit would never run.
        closed = source[source.index("    def closed(*_):"):source.index("    window.events.before_show")]
        self.assertIn("native.quick_close()", closed)
        self.assertIn("bridge.close_workspace_dock()", closed)

    @unittest.skipUnless(os.name == "nt", "job objects are a Windows facility")
    def test_a_bound_child_dies_with_the_app_even_without_a_close_handler(self):
        # The parent binds a long-running child and then dies the hard way (no
        # handlers run), like a crash or 「结束任务」. Windows must end the child.
        root = Path(windows_desktop.__file__).resolve().parents[1]
        parent = (
            "import os, subprocess, sys\n"
            f"sys.path[:0] = [{str(root)!r}, {str(root / 'app')!r}]\n"
            "from app.windows_desktop import bind_to_app_lifetime\n"
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\n"
            "bind_to_app_lifetime(child, 'test')\n"
            "print(child.pid, flush=True)\n"
            "os._exit(0)\n"
        )
        done = subprocess.run([sys.executable, "-c", parent], capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        pid = int(done.stdout.strip().splitlines()[-1])

        def alive():
            listed = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, timeout=20)
            return str(pid) in listed.stdout

        deadline = time.monotonic() + 10
        while alive() and time.monotonic() < deadline:
            time.sleep(0.2)
        try:
            self.assertFalse(alive(), "the bound child outlived its parent")
        finally:
            subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, timeout=20)


if __name__ == "__main__":
    unittest.main()
