"""11-04: a gateway started with HTTP(S)_PROXY but no NO_PROXY exemption sent
every call for the local model relay (127.0.0.1:1467) through the proxy, and
each one failed with "network connection error". Both launchers now exempt
loopback from any proxy the environment carries."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app import windows_desktop
from app.windows_desktop import BundledRuntime

ROOT = Path(__file__).resolve().parents[1]


class WindowsLoopbackNoProxyTest(unittest.TestCase):
    def environment(self, **env):
        with tempfile.TemporaryDirectory() as root, \
                mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(windows_desktop, "state_root", return_value=Path(root)):
            return BundledRuntime(root).environment()

    def test_proxy_without_exemption_gets_loopback(self):
        env = self.environment(HTTPS_PROXY="http://127.0.0.1:7897", HTTP_PROXY="http://127.0.0.1:7897")
        self.assertEqual(env["NO_PROXY"].split(","), ["localhost", "127.0.0.1", "::1"])

    def test_existing_entries_are_kept_and_not_duplicated(self):
        env = self.environment(HTTPS_PROXY="http://proxy:8080", NO_PROXY="corp.local, 127.0.0.1")
        self.assertEqual(env["NO_PROXY"].split(","), ["corp.local", "127.0.0.1", "localhost", "::1"])


class MacLauncherLoopbackNoProxyTest(unittest.TestCase):
    def test_launcher_exempts_loopback_in_both_spellings(self):
        source = (ROOT / "desktop/macos/pinkie/Sources/Launcher.swift").read_text(encoding="utf-8")
        body = source.split("static func environment()", 1)[1].split("static func pythonExecutable()", 1)[0]
        self.assertIn('for key in ["NO_PROXY", "no_proxy"]', body)
        self.assertIn('["localhost", "127.0.0.1", "::1"]', body)
        self.assertLess(body.index('for key in ["NO_PROXY", "no_proxy"]'), body.rindex("return environment"))


if __name__ == "__main__":
    unittest.main()
