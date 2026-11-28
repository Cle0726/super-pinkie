"""B110: the startup page's update button retries the check over the mirror when
the first route fails. The first failure was logged, the mirror failure was
swallowed, so the updater log never showed that the mirror had been tried.
"""
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app.windows_desktop import NativeBridge

# append_log writes under PINKIE_STATE_ROOT: keep it out of the real profile.
_STATE = tempfile.TemporaryDirectory()
_ENV = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": _STATE.name})


def setUpModule():
    _ENV.start()


def tearDownModule():
    _ENV.stop()
    _STATE.cleanup()


def updater_log():
    path = Path(_STATE.name) / "logs" / "updater.log"
    return path.read_text(encoding="utf-8") if path.is_file() else ""


class StartupUpdateMirrorLogTest(unittest.TestCase):
    def test_a_failed_mirror_retry_is_logged_and_the_page_still_gets_an_answer(self):
        updater = mock.Mock()
        updater.check.side_effect = [
            {"available": False, "temporaryError": True, "message": "GitHub 连不上"},
            TimeoutError("mirror timed out"),
        ]
        result = NativeBridge(updater).startup_update()  # must not raise
        self.assertEqual(updater.check.call_args_list,
                         [mock.call(force=True), mock.call(force=True, route="mirror")])
        self.assertFalse(result["ok"])
        self.assertEqual(result["message"], "GitHub 连不上")
        self.assertIn("startup update check via mirror failed: mirror timed out", updater_log())

    def test_a_mirror_that_answers_is_used_and_not_logged_as_failed(self):
        updater = mock.Mock()
        updater.check.side_effect = [{"available": False, "error": "x"}, {"available": False}]
        before = updater_log()
        result = NativeBridge(updater).startup_update()
        self.assertFalse(result["ok"])
        self.assertIn("最新版", result["message"])
        self.assertNotIn("via mirror failed", updater_log()[len(before):])

    def test_no_mirror_retry_when_the_first_check_is_fine(self):
        updater = mock.Mock()
        updater.check.return_value = {"available": False}
        NativeBridge(updater).startup_update()
        updater.check.assert_called_once_with(force=True)


if __name__ == "__main__":
    unittest.main()
