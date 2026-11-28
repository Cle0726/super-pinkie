"""B120: tray 「退出碧琪」 when the main window will not close.

It used to fall straight to os._exit(0). The gateway, node and relay still died
with the kill-on-close job, but the exit handlers did not run -- the FanVPN
system proxy was not restored, so the registry kept a PAC pointing at a dead
port -- and the tray icon and WebView2 leftovers stayed, with nothing in the
log. Now the desktop's full exit path runs, and the reason is logged.
"""
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from app import windows_native
from app.windows_native import WindowsNative


class Window:
    def __init__(self, error=None):
        self.error = error
        self.destroyed = 0

    def destroy(self):
        self.destroyed += 1
        if self.error:
            raise self.error


class Bridge:
    def __init__(self, window, fallback=None):
        self._window = window
        if fallback is not None:
            self._exit_fallback = fallback


class TrayQuitTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Path(self.tmp.name) / "native.json"

    def tearDown(self):
        self.tmp.cleanup()

    def native(self, bridge):
        return WindowsNative(bridge, self.settings)

    def test_a_window_that_closes_is_all_it_takes(self):
        window, called = Window(), []
        with mock.patch.object(windows_native.os, "_exit") as hard_exit:
            self.native(Bridge(window, fallback=called.append)).quit_app()
        self.assertEqual(window.destroyed, 1)
        self.assertEqual(called, [])
        hard_exit.assert_not_called()

    def test_a_window_that_will_not_close_runs_the_full_exit_not_a_hard_exit(self):
        reasons, done = [], threading.Event()

        def fallback(reason):
            reasons.append(reason)
            done.set()

        with mock.patch.object(windows_native.os, "_exit") as hard_exit:
            self.native(Bridge(Window(RuntimeError("renderer gone")), fallback=fallback)).quit_app()
            self.assertTrue(done.wait(5), "exit fallback never ran")
        hard_exit.assert_not_called()
        self.assertEqual(len(reasons), 1)
        self.assertIn("tray quit: window destroy failed", reasons[0])
        self.assertIn("renderer gone", reasons[0])

    def test_the_fallback_runs_off_the_tray_thread(self):
        # finish_exit stops the tray thread (native.stop waits on it), so the
        # fallback must not run on the thread that handled the menu command.
        seen, done = [], threading.Event()

        def fallback(_reason):
            seen.append(threading.current_thread())
            done.set()

        self.native(Bridge(Window(OSError("x")), fallback=fallback)).quit_app()
        self.assertTrue(done.wait(5))
        self.assertIsNot(seen[0], threading.current_thread())
        self.assertEqual(seen[0].name, "pinkie-quit-fallback")

    def test_without_a_desktop_fallback_it_still_exits(self):
        with mock.patch.object(windows_native.os, "_exit") as hard_exit:
            self.native(Bridge(None)).quit_app()
        hard_exit.assert_called_once_with(0)


class DesktopWiringTest(unittest.TestCase):
    def setUp(self):
        app_dir = Path(windows_native.__file__).parent
        self.desktop = (app_dir / "windows_desktop.py").read_text(encoding="utf-8")
        self.native = (app_dir / "windows_native.py").read_text(encoding="utf-8")

    def test_tray_menu_quit_goes_through_quit_app(self):
        branch = self.native[self.native.index("elif command_id == MENU_QUIT:"):]
        branch = branch[:branch.index("elif command_id >= MENU_RUNNING_BASE")]
        self.assertIn("self.quit_app()", branch)
        self.assertNotIn("os._exit", branch)

    def test_desktop_hands_the_bridge_its_full_exit_path(self):
        self.assertIn("bridge._exit_fallback = exit_fallback", self.desktop)
        body = self.desktop[self.desktop.index("    def exit_fallback(reason):"):]
        body = body[:body.index("    bridge._exit_fallback = exit_fallback")]
        self.assertIn("append_log(\"launcher\"", body)
        self.assertIn("services.close", body)
        self.assertIn("computer.close", body)
        self.assertIn("run_finish_exit(force_close_gateway=True)", body)


if __name__ == "__main__":
    unittest.main()
