"""B110: DesktopControlNode.close() must not raise, but when the desktop-control
node survives both terminate() and kill() it is an orphan, and before this the
computer log said nothing about it.
"""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))
if str(ROOT) not in sys.path:
    sys.path.insert(1, str(ROOT))

import windows_desktop as desktop  # noqa: E402


class _Process:
    """A running child whose terminate / kill behave as told."""

    def __init__(self, terminate_error=None, kill_error=None, pid=51515):
        self.pid = pid
        self.terminate_error = terminate_error
        self.kill_error = kill_error
        self.calls = []

    def poll(self):
        return None

    def wait(self, timeout=None):
        self.calls.append("wait")
        return 0

    def terminate(self):
        self.calls.append("terminate")
        if self.terminate_error:
            raise self.terminate_error

    def kill(self):
        self.calls.append("kill")
        if self.kill_error:
            raise self.kill_error


class DesktopControlCloseLogTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="pinkie-b110-rt-")
        self.state = Path(self._tmp.name) / "state"
        self._env = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.state)})
        self._env.start()
        self.control = desktop.DesktopControlNode(desktop.BundledRuntime(Path(self._tmp.name) / "install"))

    def tearDown(self):
        self._env.stop()
        self._tmp.cleanup()

    def log_text(self):
        path = self.state / "logs" / "computer.log"
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def close_with(self, process):
        self.control.process = process
        self.control.close()  # must never raise
        self.assertIsNone(self.control.process)

    def test_a_clean_terminate_logs_nothing(self):
        process = _Process()
        self.close_with(process)
        self.assertEqual(process.calls, ["terminate", "wait"])
        self.assertNotIn("did not stop", self.log_text())

    def test_kill_after_a_failed_terminate_is_quiet_when_kill_works(self):
        process = _Process(terminate_error=OSError("terminate failed"))
        self.close_with(process)
        self.assertEqual(process.calls, ["terminate", "kill"])
        self.assertNotIn("did not stop", self.log_text())

    def test_a_node_that_survives_terminate_and_kill_is_logged(self):
        process = _Process(terminate_error=OSError("terminate failed"),
                           kill_error=PermissionError(5, "Access is denied"))
        self.close_with(process)
        self.assertEqual(process.calls, ["terminate", "kill"])
        log = self.log_text()
        self.assertIn("desktop control node 51515 did not stop", log)
        self.assertIn("terminate failed", log)
        self.assertIn("Access is denied", log)

    def test_a_broken_log_does_not_make_close_raise(self):
        process = _Process(terminate_error=OSError("a"), kill_error=OSError("b"))
        self.control.process = process
        with mock.patch.object(desktop, "state_root", side_effect=OSError("profile gone")):
            self.control.close()  # must not raise


if __name__ == "__main__":
    unittest.main()
