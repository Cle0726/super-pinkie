"""The Mac shell's native affordances Windows used to be missing.

Each case here failed on Windows before the shell answered the same bridge
messages Mac registers. They are cheap contract checks: the bridge names the
page calls, the pywebview methods behind them, and the metadata Windows has to
report for a material so the chat card is not blank.
"""

import ctypes
import io
import json
import re
import threading
import types
import unittest
from pathlib import Path
from unittest import mock

from app import windows_desktop
from app.windows_desktop import NativeBridge, _describe_material


def bridge_script():
    with io.open(Path(windows_desktop.__file__).resolve(), encoding="utf-8") as handle:
        source = handle.read()
    start = source.index('BRIDGE_SCRIPT = r"""') + len('BRIDGE_SCRIPT = r"""')
    return source[start:source.index('"""', start)]


class FakeHandle:
    def ToInt64(self):
        return 12345


class FakeNative:
    Handle = FakeHandle()


class FakeWindow:
    """The pieces NativeBridge reaches for: an HWND, the current URL, JS eval."""

    def __init__(self, url="http://127.0.0.1:18789/chat?session=agent:project:main"):
        self.calls = []
        self.url = url
        self.destroyed = False
        self.js = []
        self.native = FakeNative()
        self.shown = []

    def get_current_url(self):
        return self.url

    def evaluate_js(self, script):
        self.js.append(script)

    def destroy(self):
        self.destroyed = True

    def show(self):
        self.shown.append(True)

    def restore(self):
        self.shown.append("restore")

    def load_url(self, url):
        self.url = url
        self.js.append("load_url:" + url)


def make_bridge(url=None):
    bridge = NativeBridge.__new__(NativeBridge)
    bridge._window = FakeWindow(url) if url is None else FakeWindow(url)
    bridge._gateway = None
    bridge._dock_window = None
    bridge._dock_opening = False
    bridge._dock_lock = threading.RLock()
    bridge.fullscreen = False
    bridge.maximized = False
    bridge.appearance_dark = False
    bridge.reduce_motion = False
    bridge.dictation_stop = None
    bridge.dictation_thread = None
    bridge.dictation_text = ""
    return bridge


class BridgeHandlerParityTests(unittest.TestCase):
    """The page asks for these names on both platforms."""

    def setUp(self):
        self.script = bridge_script()

    def test_fullscreen_and_appearance_are_answered(self):
        # Mac registers laolaoWindowControl; without it a fullscreen request and
        # the night switch both went nowhere.
        self.assertIn("laolaoWindowControl", self.script)
        self.assertIn("toggle_fullscreen", self.script)
        self.assertIn("apply_appearance", self.script)

    def test_motion_preference_reaches_the_shell(self):
        # laolao-motion-preference.js posts to pinkieMotion on every change.
        self.assertIn("pinkieMotion", self.script)
        self.assertIn("apply_motion_preference", self.script)

    def test_workspace_dock_is_advertised(self):
        # The split button only renders when this handler exists, so a missing
        # one hides a feature instead of failing loudly.
        self.assertIn("laolaoWorkspaceDock", self.script)
        self.assertIn("open_workspace_dock", self.script)
        self.assertIn("close_workspace_dock", self.script)


class FullscreenTests(unittest.TestCase):
    def test_fullscreen_uses_the_win32_call_that_exists(self):
        # pywebview's Windows backend has no toggle_fullscreen, so the bridge
        # must not call one. SW_MAXIMIZE fills the work area; SW_RESTORE undoes it.
        # ctypes.windll only exists on Windows; a Linux CI run must still be able
        # to exercise this contract, so install the same mockable surface first.
        if not hasattr(ctypes, "windll"):
            ctypes.windll = types.SimpleNamespace(
                user32=types.SimpleNamespace(ShowWindow=lambda handle, command: 1))
        bridge = make_bridge()
        calls = []
        real = ctypes.windll.user32.ShowWindow
        ctypes.windll.user32.ShowWindow = lambda handle, command: calls.append(command) or 1
        try:
            self.assertEqual(bridge.toggle_fullscreen(), {"fullscreen": True})
            self.assertEqual(bridge.toggle_fullscreen(), {"fullscreen": False})
        finally:
            ctypes.windll.user32.ShowWindow = real
        self.assertEqual(calls, [3, 9])  # SW_MAXIMIZE, SW_RESTORE

    def test_fullscreen_without_a_window_is_a_no_op(self):
        bridge = make_bridge()
        bridge._window = None
        self.assertEqual(bridge.toggle_fullscreen(), {"fullscreen": False})


class AppearanceTests(unittest.TestCase):
    def test_night_switch_is_remembered_even_without_a_window(self):
        bridge = make_bridge()
        bridge._window = None
        self.assertEqual(bridge.apply_appearance({"dark": True}), {"dark": True})
        self.assertTrue(bridge.appearance_dark)

    def test_missing_payload_defaults_to_light(self):
        bridge = make_bridge()
        self.assertEqual(bridge.apply_appearance(), {"dark": False})


class MotionTests(unittest.TestCase):
    def test_reduce_motion_is_forwarded(self):
        bridge = make_bridge()
        self.assertEqual(bridge.apply_motion_preference({"reduce": True}), {"reduce": True})
        self.assertTrue(bridge.reduce_motion)


class WorkspaceDockTests(unittest.TestCase):
    def test_dock_url_carries_the_session_and_the_companion_flag(self):
        bridge = make_bridge()
        url = bridge._dock_url("learning", "")
        self.assertIn("session=agent%3Alearning%3Amain", url)
        self.assertIn("laolao-dock=1", url)

    def test_the_primary_mode_is_read_from_the_page_session(self):
        bridge = make_bridge("http://127.0.0.1:18789/chat?session=agent:learning:main")
        self.assertEqual(bridge._primary_mode(), "learning")

    def test_the_same_mode_cannot_be_split_against_itself(self):
        bridge = make_bridge()
        result = bridge.open_workspace_dock({"mode": "project"})
        self.assertFalse(result["ok"])

    def test_an_unknown_mode_is_refused(self):
        bridge = make_bridge()
        result = bridge.open_workspace_dock({"mode": "nonsense"})
        self.assertFalse(result["ok"])

    def test_closing_without_a_dock_is_harmless(self):
        bridge = make_bridge()
        self.assertEqual(bridge.close_workspace_dock(), {"ok": True})

    def test_closing_destroys_the_companion_window(self):
        bridge = make_bridge()
        dock = FakeWindow()
        bridge._dock_window = dock
        bridge.close_workspace_dock()
        self.assertTrue(dock.destroyed)
        self.assertIsNone(bridge._dock_window)

    def test_opening_notifies_the_page_of_the_new_state(self):
        bridge = make_bridge()
        bridge._notify_dock_state()
        self.assertTrue(bridge._window.js)
        payload = bridge._window.js[-1]
        self.assertIn("__pinkieWorkspaceDockState", payload)
        self.assertIn('"open": false', payload)


class MaterialDescribeTests(unittest.TestCase):
    def test_text_metadata_includes_size_and_lines(self):
        # A file with a known text suffix; a bare "VERSION" has no kind, so the
        # line count is deliberately not guessed for it.
        handle = Path(windows_desktop.__file__).resolve().parent.parent / "README.md"
        info = _describe_material(handle)
        self.assertTrue(info["ok"])
        self.assertEqual(info["name"], "README.md")
        self.assertGreater(info["size"], 0)
        self.assertIn("lines", info)
        self.assertGreater(info["lines"], 0)

    def test_png_dimensions_come_from_the_header(self):
        asset = Path(windows_desktop.__file__).resolve().parent.parent / "ui/assets/favicon-32.png"
        info = _describe_material(asset)
        self.assertTrue(info["ok"])
        self.assertEqual((info["width"], info["height"]), (32, 32))

    def test_a_missing_file_reports_a_message(self):
        info = _describe_material(Path("no-such-file-anywhere.bin"))
        self.assertFalse(info["ok"])
        self.assertIn("message", info)


class DesktopControlNodeTests(unittest.TestCase):
    """Mac ships a desktop-control service; without it Windows has no computer target."""

    def runtime(self):
        return windows_desktop.BundledRuntime(
            Path(windows_desktop.__file__).resolve().parent.parent / "dist/\u8d85\u7d1a\u78a7\u742a/_internal"
        )

    def test_the_node_is_invoked_through_the_bundled_runtime(self):
        runtime = self.runtime()
        if not runtime.valid():
            self.skipTest("packaged runtime is not present in this checkout")
        node = windows_desktop.DesktopControlNode(runtime)
        arguments = node._arguments()
        self.assertIsNotNone(arguments)
        self.assertIn("node", arguments)
        self.assertIn("run", arguments)
        self.assertIn("--display-name", arguments)
        # The display name is what the gateway lists the machine as.
        self.assertEqual(arguments[arguments.index("--display-name") + 1],
                         windows_desktop.DesktopControlNode.DISPLAY_NAME)

    def test_a_missing_runtime_reports_instead_of_starting(self):
        node = windows_desktop.DesktopControlNode.__new__(windows_desktop.DesktopControlNode)
        node.runtime = type("R", (), {"openclaw": Path("nope/openclaw.mjs"), "node": Path("nope/node.exe")})()
        node.last_error = ""
        self.assertIsNone(node._arguments())

    def test_close_without_a_process_is_harmless(self):
        node = windows_desktop.DesktopControlNode.__new__(windows_desktop.DesktopControlNode)
        node.process = None
        node.closing = threading.Event()
        node.lock = threading.Lock()
        node.generation = 0
        node.close()
        self.assertTrue(node.closing.is_set())

    def test_status_reports_a_stopped_node(self):
        node = windows_desktop.DesktopControlNode.__new__(windows_desktop.DesktopControlNode)
        node.process = None
        node.last_error = "boom"
        self.assertEqual(node.status(), {"running": False, "pid": None, "error": "boom"})


class DockConcurrencyTests(unittest.TestCase):
    """Two quick clicks must not open two companion windows."""

    def test_a_second_click_while_opening_is_pending_not_a_new_window(self):
        bridge = make_bridge()
        spawned = []
        real_thread = threading.Thread

        class BlockingThread:
            def __init__(self, target=None, args=(), name=None, daemon=None):
                spawned.append(name)

            def start(self):
                pass

        threading.Thread = BlockingThread
        try:
            first = bridge.open_workspace_dock({"mode": "learning"})
            second = bridge.open_workspace_dock({"mode": "chat"})
        finally:
            threading.Thread = real_thread
        self.assertEqual(first, {"ok": True})
        self.assertTrue(second.get("pending"))
        self.assertEqual(len(spawned), 1)

    def test_closing_releases_a_pending_open(self):
        bridge = make_bridge()
        bridge._dock_opening = True
        bridge.close_workspace_dock()
        self.assertFalse(bridge._dock_opening)


class WindowStateIsolationTests(unittest.TestCase):
    """The maximize event and the fullscreen action must not reset each other."""

    def script(self):
        source = Path(windows_desktop.__file__).resolve().read_text(encoding="utf-8")
        start = source.index('BRIDGE_SCRIPT = r"""') + len('BRIDGE_SCRIPT = r"""')
        return source[start:source.index('"""', start)]

    def test_each_field_is_optional(self):
        js = self.script()
        self.assertIn("Object.prototype.hasOwnProperty.call(state, key)", js)
        self.assertIn("if (has('maximized'))", js)
        self.assertIn("if (has('fullscreen'))", js)

    def test_fullscreen_has_a_visible_entry_and_a_shortcut(self):
        js = self.script()
        self.assertIn('data-act="full"', js)
        self.assertIn("F11", js)


class DesktopControlRestartTests(unittest.TestCase):
    """A dead node restarts once, with backoff, and stops for good on close."""

    def node(self):
        node = windows_desktop.DesktopControlNode.__new__(windows_desktop.DesktopControlNode)
        node.process = None
        node.closing = threading.Event()
        node.lock = threading.RLock()
        node.generation = 0
        node.last_error = ""
        node.restarts = 0
        node.restart_limit = 5
        node._restarting = False
        return node

    def test_close_is_idempotent(self):
        node = self.node()
        node.close()
        node.close()
        self.assertTrue(node.closing.is_set())

    def test_restarting_is_marked_so_only_one_worker_runs(self):
        node = self.node()
        node._restarting = True
        node._schedule_restart()
        self.assertEqual(node.restarts, 0)

    def test_a_closed_node_never_restarts(self):
        node = self.node()
        node.closing.set()
        node._schedule_restart()
        self.assertEqual(node.restarts, 0)


if __name__ == "__main__":
    unittest.main()
