"""B110: the exit hook that puts FanVPN's system proxy back must never raise, but
it must not fail silently either. A failed restore leaves a PAC that points at a
dead port, so the machine has no network after the next boot, and before this
the launcher log said nothing about it.
"""
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app import windows_desktop
from app.windows_desktop import restore_fanvpn_on_exit

# append_log writes under PINKIE_STATE_ROOT: keep it out of the real profile.
_STATE = tempfile.TemporaryDirectory()
_ENV = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": _STATE.name})


def setUpModule():
    _ENV.start()


def tearDownModule():
    _ENV.stop()
    _STATE.cleanup()


class RestoreFanvpnOnExitTest(unittest.TestCase):
    def test_a_successful_restore_logs_nothing(self):
        calls, logged = [], []
        restore_fanvpn_on_exit(shutdown=lambda: calls.append("shutdown"),
                               log=lambda *args: logged.append(args))
        self.assertEqual(calls, ["shutdown"])
        self.assertEqual(logged, [])

    def test_a_failed_restore_is_logged_and_does_not_raise(self):
        logged = []

        def broken():
            raise OSError(5, "Access is denied")

        restore_fanvpn_on_exit(shutdown=broken, log=lambda *args: logged.append(args))
        self.assertEqual(len(logged), 1)
        name, message = logged[0]
        self.assertEqual(name, "launcher")
        self.assertIn("FanVPN system proxy restore on exit failed", message)
        self.assertIn("Access is denied", message)

    def test_a_failing_logger_does_not_raise_either(self):
        def broken():
            raise RuntimeError("restore failed")

        def broken_log(*_):
            raise OSError("log locked")

        restore_fanvpn_on_exit(shutdown=broken, log=broken_log)  # must not raise

    def test_the_failure_lands_in_the_launcher_log_file(self):
        def broken():
            raise RuntimeError("registry write failed")

        restore_fanvpn_on_exit(shutdown=broken)
        log = Path(_STATE.name) / "logs" / "launcher.log"
        self.assertIn("registry write failed", log.read_text(encoding="utf-8"))

    def test_run_desktop_registers_this_hook_at_exit(self):
        source = Path(windows_desktop.__file__).read_text(encoding="utf-8")
        self.assertIn("atexit.register(restore_fanvpn_on_exit)", source)
        self.assertNotIn("_restore_fanvpn_on_exit", source)


if __name__ == "__main__":
    unittest.main()
