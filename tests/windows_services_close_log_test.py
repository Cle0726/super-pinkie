"""B110: LocalServices.close() must not raise, and must still try every server and
the relay, but a server that does not shut down keeps its port, and before this
the launcher log said nothing about it.
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


class _Server:
    def __init__(self, port, error=None):
        self.server_address = ("127.0.0.1", port)
        self.error = error
        self.shut = False

    def shutdown(self):
        if self.error:
            raise self.error
        self.shut = True


class LocalServicesCloseLogTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="pinkie-b110-svc-")
        self.state = Path(self._tmp.name) / "state"
        self._env = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.state)})
        self._env.start()
        self.services = desktop.LocalServices(runtime=mock.Mock(root=Path(self._tmp.name)))

    def tearDown(self):
        self._env.stop()
        self._tmp.cleanup()

    def log_text(self):
        path = self.state / "logs" / "launcher.log"
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def test_clean_shutdowns_log_nothing(self):
        servers = [_Server(18889), _Server(18891)]
        self.services.servers = list(servers)
        self.services.close()
        self.assertTrue(all(s.shut for s in servers))
        self.assertNotIn("did not shut down", self.log_text())

    def test_a_server_that_fails_is_logged_and_the_others_still_shut_down(self):
        party = _Server(18889)
        roundtable = _Server(18891, error=OSError(10038, "not a socket"))
        tts = _Server(18888)
        self.services.servers = [party, roundtable, tts]
        self.services.close()  # must not raise
        self.assertTrue(party.shut)
        self.assertTrue(tts.shut)
        log = self.log_text()
        self.assertIn("local service ('127.0.0.1', 18891) did not shut down", log)
        self.assertIn("not a socket", log)
        self.assertNotIn("18889", log)

    def test_the_relay_is_still_stopped_after_a_failed_server(self):
        relay = mock.Mock()
        relay.poll.return_value = None
        self.services.servers = [_Server(18889, error=RuntimeError("boom"))]
        self.services.relay = relay
        self.services.close()
        relay.terminate.assert_called_once()
        self.assertIsNone(self.services.relay)

    def test_a_broken_log_does_not_make_close_raise(self):
        self.services.servers = [_Server(18889, error=RuntimeError("boom"))]
        with mock.patch.object(desktop, "state_root", side_effect=OSError("profile gone")):
            self.services.close()  # must not raise


if __name__ == "__main__":
    unittest.main()
