"""app/windows_bridge.py 热点复发测试（B128，续 B103 / L98）。

只锁现有测试抓不住的 NativeBridge 行为：windows_update_ui_test.py、
windows_update_test.py、windows_resize_test.py、windows_stale_gateway_test.py、
fanvpn_bridge_test.py 已锁住的不重复。每个测试类写明它锁的方法。
全部 mock I/O：不起窗口、不碰注册表、不连真网关。
"""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import windows_desktop  # noqa: E402
from app.windows_desktop import NativeBridge  # noqa: E402


def _state_root(case):
    tmp = tempfile.TemporaryDirectory(prefix="pinkie-bridge-hotspot-")
    case.addCleanup(tmp.cleanup)
    patcher = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": tmp.name})
    patcher.start()
    case.addCleanup(patcher.stop)
    return Path(tmp.name)


class FakeUpdater:
    """Minimal stand-in: only the attributes/methods NativeBridge actually calls."""

    def __init__(self, prepare_result=None, prepare_error=None, check_result=None):
        self.prepare_calls = []
        self.check_calls = []
        self._prepare_result = prepare_result if prepare_result is not None else {"ready": True}
        self._prepare_error = prepare_error
        self._check_result = check_result if check_result is not None else {"available": False}

    def prepare(self, progress=None, route=None):
        self.prepare_calls.append(route)
        if self._prepare_error is not None:
            raise self._prepare_error
        return self._prepare_result

    def check(self, force=True, route=None):
        self.check_calls.append(route)
        return self._check_result


class PrepareUpdateFailureTests(unittest.TestCase):
    """NativeBridge.prepare_update: when self._updater.prepare() itself raises
    (not just returns a failure dict — a real exception, e.g. disk full while
    writing the staged download), the page must still get an answer instead of
    the pywebview js_api call dying silently. Reverting the try/except around
    self._updater.prepare(...) makes this raise instead of returning."""

    def test_an_exception_from_prepare_becomes_a_retryable_message(self):
        _state_root(self)
        updater = FakeUpdater(prepare_error=RuntimeError("disk full"))
        bridge = NativeBridge(updater)

        result = bridge.prepare_update()

        self.assertFalse(result["ready"])
        self.assertTrue(result.get("temporaryError"))
        self.assertTrue(result.get("available"))
        self.assertIn("稍后再点一次", result["message"])

    def test_a_normal_result_from_prepare_passes_through_unchanged(self):
        _state_root(self)
        updater = FakeUpdater(prepare_result={"ready": True, "version": "9.9.9"})
        bridge = NativeBridge(updater)

        result = bridge.prepare_update()

        self.assertEqual({"ready": True, "version": "9.9.9"}, result)

    def test_progress_callback_is_forwarded_without_crashing_when_there_is_no_window(self):
        # startup_update calls prepare_update before any window is attached in
        # some of the unit tests that exercise it; the progress callback must
        # tolerate self._window being None rather than raising AttributeError
        # out of the updater's own progress thread.
        _state_root(self)
        captured = {}

        def prepare(progress=None, route=None):
            captured["progress"] = progress
            progress({"downloaded": 1, "total": 2})
            return {"ready": True}

        updater = mock.Mock()
        updater.prepare.side_effect = prepare
        bridge = NativeBridge(updater)
        self.assertIsNone(bridge._window)

        result = bridge.prepare_update()

        self.assertEqual({"ready": True}, result)
        self.assertIsNotNone(captured["progress"])


class CheckForUpdatesRouteTests(unittest.TestCase):
    """NativeBridge.check_for_updates: only the literal string "mirror" may
    select the mirror route; anything else (None, "", a typo) must fall back
    to the normal route, not be passed through verbatim to the updater."""

    def test_the_mirror_route_is_forwarded(self):
        _state_root(self)
        updater = FakeUpdater()
        bridge = NativeBridge(updater)

        bridge.check_for_updates(route="mirror")

        self.assertEqual(["mirror"], updater.check_calls)

    def test_anything_else_becomes_no_route(self):
        _state_root(self)
        updater = FakeUpdater()
        bridge = NativeBridge(updater)

        for value in (None, "", "Mirror", "github"):
            with self.subTest(value=value):
                updater.check_calls.clear()
                bridge.check_for_updates(route=value)
                self.assertEqual([None], updater.check_calls)


class OpenLogsFolderTests(unittest.TestCase):
    """NativeBridge.open_logs: creates <state_root>/logs and tries to show it
    in Explorer; a failure to launch Explorer must be reported back to the
    page, not raised into the js_api dispatcher."""

    def test_the_logs_folder_is_created_even_if_it_never_existed(self):
        root = _state_root(self)
        updater = FakeUpdater()
        bridge = NativeBridge(updater)

        with mock.patch("app.windows_desktop.subprocess.Popen") as popen:
            result = bridge.open_logs()

        self.assertTrue(result["ok"])
        self.assertTrue((root / "logs").is_dir())
        self.assertEqual(str(root / "logs"), result["path"])
        popen.assert_called_once()
        self.assertEqual(["explorer.exe", str(root / "logs")], popen.call_args.args[0])

    def test_explorer_failing_to_launch_is_reported_not_raised(self):
        _state_root(self)
        updater = FakeUpdater()
        bridge = NativeBridge(updater)

        with mock.patch("app.windows_desktop.subprocess.Popen", side_effect=OSError("no shell")):
            result = bridge.open_logs()

        self.assertFalse(result["ok"])
        self.assertIn("no shell", result["message"])


if __name__ == "__main__":
    unittest.main()
