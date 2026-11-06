"""The browser-only VPN must stay inside 碧琪的浏览器.

Checks that only the in-app browser's own WebView2 launch gets a proxy, that
the core listens on loopback only, and that enabling a node changes neither
the process environment the gateway/model relay inherit nor system settings.
"""

import json
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

APP = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP))
import browser_vpn_core as core  # noqa: E402
import inapp_browser  # noqa: E402

TROJAN = "trojan://pw@us.example.com:443#US"
PROXY_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY")


class FakeCore:
    def __init__(self, *_args, **_kwargs):
        self.binary = Path("mihomo.exe")
        self.mixed_port = 0
        self.started = []
        self.selected = []
        self.alive = False

    def running(self):
        return self.alive

    def start(self, proxies, selected=None):
        self.alive = True
        self.mixed_port = self.mixed_port or 54321
        self.started.append(([p["name"] for p in proxies], selected))

    def stop(self):
        self.alive = False

    def select(self, name):
        self.selected.append(name)

    def delays(self):
        return {"US": 120}


class CoreConfigTest(unittest.TestCase):
    def test_browser_arguments_only_point_at_loopback_core(self):
        self.assertEqual(core.browser_proxy_arguments(0), [])
        args = core.browser_proxy_arguments(40123)
        self.assertIn("--proxy-server=http://127.0.0.1:40123", args)
        self.assertTrue(any(a.startswith("--force-webrtc-ip-handling-policy=disable_non_proxied_udp") for a in args))
        # Never remove Chromium's implicit loopback bypass: local previews must stay direct.
        self.assertFalse(any("<-loopback>" in a for a in args))

    def test_core_config_is_loopback_only_with_no_tun_or_lan(self):
        proxies = [{"name": "A", "type": "trojan", "server": "a.example.com", "port": 443, "password": "x"},
                   {"name": "B", "type": "trojan", "server": "b.example.com", "port": 443, "password": "y"}]
        config = core.build_config(proxies, 41000, 41001, "secret", selected="B")
        self.assertEqual(config["bind-address"], "127.0.0.1")
        self.assertFalse(config["allow-lan"])
        self.assertEqual(config["external-controller"], "127.0.0.1:41001")
        self.assertEqual(config["tun"], {"enable": False})
        self.assertNotIn("dns", config)  # no DNS hijack
        self.assertEqual(config["rules"], ["MATCH,PINKIE"])
        self.assertEqual(config["proxy-groups"][0]["proxies"], ["B", "A"])
        # JSON is the format written to disk; mihomo reads it as YAML.
        json.dumps(config)

    def test_no_module_touches_system_proxy_or_registry(self):
        for name in ("browser_vpn_core.py", "browser_vpn_subscription.py", "inapp_browser.py", "inapp_browser_host.py"):
            source = (APP / name).read_text(encoding="utf-8")
            for forbidden in ("winreg", "win_sysproxy", "InternetSetOption", "ProxyEnable", "fanvpn_bridge"):
                self.assertNotIn(forbidden, source, f"{name} mentions {forbidden}")


class ManagerScopeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        patcher = mock.patch.object(inapp_browser, "MihomoCore", FakeCore)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        for key in PROXY_KEYS:
            os.environ.pop(key, None)
        self.manager = inapp_browser.BrowserManager(self.root, None)
        self.addCleanup(self.manager.shutdown)
        self.addCleanup(self.dir.cleanup)

    def test_endpoint_is_a_loopback_file_named_in_the_environment(self):
        self.manager.start()
        value = json.loads(os.environ[inapp_browser.ENDPOINT_ENV])
        self.assertEqual(value, {"v": 1, "endpointFile": str(self.manager.endpoint_file)})
        data = json.loads(self.manager.endpoint_file.read_text(encoding="utf-8"))
        self.assertEqual(data["host"], "127.0.0.1")
        self.assertGreaterEqual(len(data["token"]), 32)
        # Unauthenticated clients are refused without launching anything.
        with socket.create_connection(("127.0.0.1", data["port"]), timeout=5) as client:
            client.sendall(b'{"id":"x","action":"open","url":"https://example.com","token":"wrong"}\n')
            reply = json.loads(client.makefile().readline())
        self.assertFalse(reply["ok"])
        self.assertIsNone(self.manager.host_process)

    def test_enabling_a_node_only_relaunches_the_browser_with_a_proxy(self):
        launches = []
        self.manager._spawn_host = lambda port, hidden, restore: launches.append(port)
        vpn = self.manager.vpn
        vpn.restart_browser = lambda port: launches.append(("restart", port))
        before = {k: os.environ.get(k) for k in PROXY_KEYS}
        self.assertTrue(vpn.handle("add", {"url": TROJAN})["ok"])
        self.assertTrue(vpn.handle("enable", {"on": True})["ok"])
        self.assertEqual(launches, [("restart", 54321)])
        self.assertEqual({k: os.environ.get(k) for k in PROXY_KEYS}, before)
        state = vpn.state()
        self.assertTrue(state["enabled"] and state["applied"])
        self.assertNotIn("password", json.dumps(state))
        # A fresh browser launch picks the proxy up; turning it off goes back to direct.
        self.assertEqual(vpn.startup_port(), 54321)
        self.assertTrue(vpn.handle("enable", {"on": False})["ok"])
        self.assertEqual(launches[-1], ("restart", 0))
        self.assertEqual(vpn.startup_port(), 0)
        self.assertFalse(vpn.core.running())

    def test_browser_process_does_not_inherit_the_gateway_endpoint(self):
        self.manager.start()
        captured = {}

        class Process:
            pid = 4242

            def poll(self):
                return None

        def popen(command, **kwargs):
            captured["command"] = command
            captured["env"] = kwargs["env"]
            captured["startupinfo"] = kwargs.get("startupinfo")
            return Process()

        with mock.patch.object(inapp_browser.subprocess, "Popen", popen), mock.patch.object(inapp_browser, "assign_to_kill_job"):
            self.manager._spawn_host(0, hidden=True, restore=False)
            self.assertNotIn("--proxy-port", captured["command"])
            self.assertNotIn(inapp_browser.ENDPOINT_ENV, captured["env"])
            # The browser is a window: an SW_HIDE STARTUPINFO would swallow its first Show().
            self.assertIsNone(captured["startupinfo"])
            self.manager._spawn_host(50000, hidden=True, restore=True)
            command = captured["command"]
            self.assertEqual(command[command.index("--proxy-port") + 1], "50000")
            self.assertIn("--restore", command)
            self.assertEqual(command[command.index("--profile") + 1], str(self.root / "inapp-browser" / "profile"))
        self.manager.host_process = None

    def test_bad_subscription_message_and_store_untouched(self):
        reply = self.manager.vpn.handle("add", {"url": "这不是链接"})
        self.assertFalse(reply["ok"])
        self.assertIn("看不懂", reply["message"])
        self.assertEqual(self.manager.vpn.state()["subscriptions"], [])

    def test_offline_node_selection_warns(self):
        vpn = self.manager.vpn
        vpn.handle("add", {"url": TROJAN + "\ntrojan://pw@down.example.com:443#DOWN"})
        vpn.core.delays = lambda: {"US": 99}
        self.assertTrue(vpn.handle("test", {})["ok"])
        reply = vpn.handle("select", {"name": "DOWN"})
        self.assertIn("连不上", reply["message"])
        nodes = {n["name"]: n for n in vpn.state()["nodes"]}
        self.assertEqual(nodes["US"]["delay"], 99)
        self.assertIsNone(nodes["DOWN"]["delay"])
        self.assertTrue(nodes["DOWN"]["tested"])


if __name__ == "__main__":
    unittest.main()
