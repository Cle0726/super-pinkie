"""11-05: a root ``proxy`` block in openclaw.json made OpenClaw route the whole
gateway through Clash (NO_PROXY blanked), and every call to the local model
relay on 127.0.0.1:1466 failed with UND_ERR_SOCKET. The shell now turns that
block into HTTP(S)_PROXY for the gateway with loopback exempt."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app import gateway_proxy, windows_desktop

REPORTED = {"enabled": True, "proxyUrl": "http://127.0.0.1:7897", "loopbackMode": "gateway-only"}


class GatewayProxyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = self.root / "openclaw.json"
        self.state = self.root / "state"
        self.messages = []

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, data):
        self.config.write_text(json.dumps(data), encoding="utf-8")

    def read(self):
        return json.loads(self.config.read_text(encoding="utf-8"))

    def repair(self):
        return gateway_proxy.repair(self.config, self.state, log=self.messages.append)

    def test_reported_block_is_disabled_and_carried_as_environment(self):
        self.write({"proxy": dict(REPORTED), "models": {"providers": {"mm": {"baseUrl": "http://127.0.0.1:1466/v1"}}}})
        self.assertEqual(self.repair(), "http://127.0.0.1:7897")
        config = self.read()
        self.assertIs(config["proxy"]["enabled"], False)
        self.assertEqual(config["proxy"]["proxyUrl"], "http://127.0.0.1:7897")
        self.assertEqual(config["models"]["providers"]["mm"]["baseUrl"], "http://127.0.0.1:1466/v1")
        self.assertEqual(gateway_proxy.proxy_url(self.state, config), "http://127.0.0.1:7897")
        env = gateway_proxy.apply_environment({"NO_PROXY": "corp.local"}, "http://127.0.0.1:7897")
        self.assertEqual(env["HTTP_PROXY"], "http://127.0.0.1:7897")
        self.assertEqual(env["HTTPS_PROXY"], "http://127.0.0.1:7897")
        self.assertEqual(env["NO_PROXY"].split(","), ["corp.local", "localhost", "127.0.0.1", "::1"])

    def test_second_check_changes_nothing(self):
        self.write({"proxy": dict(REPORTED)})
        self.repair()
        before = self.config.read_bytes()
        self.assertIsNone(self.repair())
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(gateway_proxy.proxy_url(self.state, self.read()), "http://127.0.0.1:7897")

    def test_removing_the_block_ends_the_takeover(self):
        self.write({"proxy": dict(REPORTED)})
        self.repair()
        self.write({})
        self.assertIsNone(self.repair())
        self.assertIsNone(gateway_proxy.load_record(self.state))
        self.assertIsNone(gateway_proxy.proxy_url(self.state, self.read()))

    def test_user_disabled_proxy_with_another_url_gets_no_environment(self):
        self.write({"proxy": dict(REPORTED)})
        self.repair()
        self.write({"proxy": {"enabled": False, "proxyUrl": "http://10.0.0.2:3128"}})
        self.repair()
        self.assertIsNone(gateway_proxy.proxy_url(self.state, self.read()))

    def test_explicit_loopback_modes_are_respected(self):
        for mode in ("proxy", "block"):
            self.write({"proxy": {**REPORTED, "loopbackMode": mode}})
            self.assertIsNone(self.repair())
            self.assertIs(self.read()["proxy"]["enabled"], True)

    def test_missing_or_broken_file_is_left_alone(self):
        self.assertIsNone(self.repair())
        self.config.write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.repair())
        self.assertEqual(self.config.read_text(encoding="utf-8"), "{not json")

    def test_existing_proxy_variables_win(self):
        env = gateway_proxy.apply_environment({"HTTPS_PROXY": "http://corp:8080"}, "http://127.0.0.1:7897")
        self.assertEqual(env["HTTPS_PROXY"], "http://corp:8080")
        self.assertEqual(env["HTTP_PROXY"], "http://127.0.0.1:7897")


class SupervisorProxyTest(unittest.TestCase):
    def test_gateway_start_gets_the_taken_over_proxy(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
            root = Path(folder)
            config = root / "openclaw.json"
            config.write_text(json.dumps({"proxy": dict(REPORTED)}), encoding="utf-8")
            runtime = windows_desktop.BundledRuntime(root / "install")
            launched = {}

            class Process:
                pid = 4242

                def poll(self):
                    return None

            def popen(command, env=None, **_):
                launched["env"] = env
                return Process()

            with mock.patch.dict(os.environ, {"OPENCLAW_CONFIG_PATH": str(config)}, clear=False), \
                    mock.patch.object(windows_desktop, "state_root", return_value=root / "state"), \
                    mock.patch.object(windows_desktop, "http_ready", return_value=False), \
                    mock.patch.object(windows_desktop.subprocess, "Popen", side_effect=popen):
                (root / "state").mkdir()
                os.environ.pop("HTTP_PROXY", None)
                os.environ.pop("HTTPS_PROXY", None)
                windows_desktop.GatewaySupervisor(runtime).start()
            self.assertIs(json.loads(config.read_text(encoding="utf-8"))["proxy"]["enabled"], False)
            self.assertEqual(launched["env"]["HTTPS_PROXY"], "http://127.0.0.1:7897")
            self.assertIn("127.0.0.1", launched["env"]["NO_PROXY"].split(","))


class LoopbackProbeTest(unittest.TestCase):
    def test_probes_ignore_the_registry_proxy(self):
        source = Path(windows_desktop.__file__).read_text(encoding="utf-8")
        for name in ("http_alive", "http_ready", "http_identity"):
            body = source.split(f"def {name}(", 1)[1].split("\ndef ", 1)[0]
            self.assertIn("loopback_urlopen(", body)
            self.assertNotIn("urllib.request.urlopen(", body)
        # ProxyHandler({}) replaces the default (registry-reading) handler and,
        # having no *_open methods, is not installed at all: no proxy is used.
        handlers = [type(h).__name__ for h in windows_desktop._LOOPBACK_OPENER.handlers]
        self.assertNotIn("ProxyHandler", handlers)
        self.assertIn("HTTPHandler", handlers)


if __name__ == "__main__":
    unittest.main()
