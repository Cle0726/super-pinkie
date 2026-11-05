import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import browser_proxy  # noqa: E402

CLASH = {"ProxyEnable": 1, "ProxyServer": "127.0.0.1:7890", "ProxyOverride": "localhost;127.*;<local>"}


class BrowserProxyTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.config = self.root / "openclaw.json"
        self.config.write_text(json.dumps({"browser": {"extraArgs": ["--force-dark-mode"]}, "gateway": {"port": 18789}}), encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def read(self):
        return json.loads(self.config.read_text(encoding="utf-8"))

    def apply(self, setting=None, registry=None):
        return browser_proxy.apply(self.config, self.root, setting, reader=lambda: dict(registry or {}))

    def test_follow_system_proxy_by_default_and_unlock_navigation(self):
        result = self.apply(registry=CLASH)
        browser = self.read()["browser"]
        self.assertEqual(browser["extraArgs"], ["--force-dark-mode", "--proxy-server=127.0.0.1:7890", "--proxy-bypass-list=localhost;127.*;<local>"])
        # OpenClaw refuses every navigation of a proxied browser under its default policy.
        self.assertIs(browser["ssrfPolicy"]["allowPrivateNetwork"], True)
        self.assertEqual(result["mode"], "system")
        self.assertIn("127.0.0.1:7890", result["effective"])
        self.assertEqual(self.read()["gateway"], {"port": 18789})

    def test_system_proxy_turned_off_later_removes_only_our_args(self):
        self.apply(registry=CLASH)
        result = self.apply(registry={"ProxyEnable": 0, "ProxyServer": "127.0.0.1:7890"})
        self.assertEqual(self.read()["browser"], {"extraArgs": ["--force-dark-mode"]})
        self.assertIn("直接连接", result["effective"])

    def test_pac_script(self):
        self.apply(registry={"AutoConfigURL": "http://127.0.0.1:7890/pac"})
        self.assertIn("--proxy-pac-url=http://127.0.0.1:7890/pac", self.read()["browser"]["extraArgs"])

    def test_custom_proxy_validation_and_switching(self):
        result = self.apply({"mode": "custom", "server": "socks5://127.0.0.1:7891"}, registry=CLASH)
        self.assertEqual(result["server"], "socks5://127.0.0.1:7891")
        self.assertIn("--proxy-server=socks5://127.0.0.1:7891", self.read()["browser"]["extraArgs"])
        self.assertEqual(self.apply({"mode": "custom", "server": "10.0.0.2:8080"})["server"], "http://10.0.0.2:8080")
        for bad in ["", "user:pw@1.2.3.4:80", "127.0.0.1", "127.0.0.1:99999", "a b:80", "1.1.1.1:80;--x"]:
            with self.assertRaises(ValueError, msg=bad):
                self.apply({"mode": "custom", "server": bad})
        # A rejected value leaves the last good setting in place.
        self.assertIn("--proxy-server=http://10.0.0.2:8080", self.read()["browser"]["extraArgs"])
        self.apply({"mode": "off"}, registry=CLASH)
        self.assertEqual(self.read()["browser"], {"extraArgs": ["--force-dark-mode"]})

    def test_hand_written_proxy_and_policy_are_left_alone(self):
        self.config.write_text(json.dumps({"browser": {"extraArgs": ["--proxy-server=1.2.3.4:1"],
                                                        "ssrfPolicy": {"dangerouslyAllowPrivateNetwork": False}}}), encoding="utf-8")
        result = self.apply(registry=CLASH)
        self.assertEqual(self.read()["browser"]["extraArgs"], ["--proxy-server=1.2.3.4:1"])
        self.assertIn("手动", result["effective"])
        self.config.write_text(json.dumps({"browser": {"ssrfPolicy": {"dangerouslyAllowPrivateNetwork": True}}}), encoding="utf-8")
        self.apply(registry=CLASH)
        self.apply({"mode": "off"})
        self.assertEqual(self.read()["browser"], {"ssrfPolicy": {"dangerouslyAllowPrivateNetwork": True}})

    def test_missing_registry_or_config_is_harmless(self):
        self.config.unlink()
        result = browser_proxy.apply(self.config, self.root, reader=lambda: (_ for _ in ()).throw(OSError("no key")))
        self.assertEqual(result["system"], "没有开代理")
        self.assertFalse(self.config.exists())


if __name__ == "__main__":
    unittest.main()
