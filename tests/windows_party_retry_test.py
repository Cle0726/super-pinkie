import atexit
import importlib.util
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def windows_party():
    """services/party as build-win.ps1 assembles it (the snapshot no longer overlays it)."""
    root = Path(tempfile.mkdtemp(prefix="pinkie-windows-services-"))
    atexit.register(shutil.rmtree, root, True)
    services = root / "services"
    ignore = shutil.ignore_patterns("node_modules")
    shutil.copytree(ROOT / "services", services, ignore=ignore)
    assert not (ROOT / "desktop/windows/mac-runtime/services/party").exists()
    directory = services / "party"
    spec = importlib.util.spec_from_file_location("windows_party", directory / "server.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(directory))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(directory))
    return module


party = windows_party()


class PartyRetryTests(unittest.TestCase):
    def test_a_broken_stream_is_retried_but_not_forever(self):
        self.assertTrue(party.should_retry(RuntimeError("terminated"), 0))
        self.assertTrue(party.should_retry(RuntimeError("terminated"), party.RETRY_LIMIT - 1))
        self.assertFalse(party.should_retry(RuntimeError("terminated"), party.RETRY_LIMIT))

    def test_a_refused_local_connection_gets_two_tries(self):
        error = RuntimeError("connect ECONNREFUSED 127.0.0.1:1466")
        self.assertTrue(party.should_retry(error, 1))
        self.assertFalse(party.should_retry(error, 2))

    def test_permanent_failures_are_never_retried(self):
        self.assertFalse(party.should_retry(RuntimeError("401 invalid api key"), 0))
        self.assertFalse(party.should_retry(ValueError("Codex 尚未安装"), 0))


if __name__ == "__main__":
    unittest.main()
