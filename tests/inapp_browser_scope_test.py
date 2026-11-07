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

    def delays(self, **_kwargs):
        return {"US": 120}

    def delay(self, name):
        return self.delays().get(name)


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



THREE = chr(10).join([
    "trojan://pw@hk.example.com:443#%F0%9F%87%AD%F0%9F%87%B0%20HK%2001",
    "trojan://pw@jp.example.com:443#Tokyo%2002",
    "trojan://pw@us.example.com:443#US%20Plus%2003",
])


class AgentNodeControlTest(unittest.TestCase):
    """碧琪 reads and steers her browser's node herself, and a dead node is
    replaced automatically."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        patcher = mock.patch.object(inapp_browser, "MihomoCore", FakeCore)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.manager = inapp_browser.BrowserManager(Path(self.dir.name), None)
        self.addCleanup(self.manager.shutdown)
        self.vpn = self.manager.vpn
        self.vpn.restart_browser = lambda _port: None
        self.vpn._start_health = lambda: None
        self.assertTrue(self.vpn.handle("add", {"url": THREE})["ok"])
        self.names = [p["name"] for p in self.vpn.store.all_proxies()]
        self.hk, self.jp, self.us = self.names

    def delays(self, values):
        self.vpn.core.delays = lambda **_k: dict(values)

    def test_regions_come_from_flags_names_and_whole_word_codes(self):
        self.assertEqual(inapp_browser.node_region(self.hk), "香港")
        self.assertEqual(inapp_browser.node_region(self.jp), "日本")
        self.assertEqual(inapp_browser.node_region(self.us), "美国")
        self.assertEqual(inapp_browser.node_region("Plus 03"), "")  # "us" inside a word is not the US

    def test_failover_switches_only_when_proxied_and_the_node_is_dead(self):
        self.delays({self.jp: 80, self.us: 150})
        # Direct browsing: nothing to switch.
        self.assertFalse(self.vpn.handle("failover", {})["switched"])
        self.assertTrue(self.vpn.handle("enable", {"on": True})["ok"])
        self.assertEqual(self.vpn.store.data["selected"], self.hk)
        reply = self.vpn.handle("failover", {"reason": "网页打不开"})
        self.assertTrue(reply["switched"])
        self.assertEqual((reply["from"], reply["node"]), (self.hk, self.jp))
        self.assertEqual(self.vpn.core.selected[-1], self.jp)
        # Rate limited, and a live node is never swapped for "the site is down".
        self.assertFalse(self.vpn.handle("failover", {})["switched"])
        self.vpn.last_failover = 0
        reply = self.vpn.handle("failover", {})
        self.assertFalse(reply["switched"])
        self.assertIn("网站本身", reply["message"])

    def test_auto_switch_can_be_turned_off(self):
        self.delays({self.jp: 80})
        self.vpn.handle("enable", {"on": True})
        self.vpn.handle("auto", {"on": False})
        self.assertFalse(self.vpn.handle("failover", {})["switched"])
        self.assertTrue(self.vpn.handle("test", {})["ok"])
        self.assertEqual(self.vpn.store.data["selected"], self.hk)
        self.vpn.handle("auto", {"on": True})
        self.assertIn("自动换到", self.vpn.handle("test", {})["message"])
        self.assertEqual(self.vpn.store.data["selected"], self.jp)

    def test_best_picks_the_fastest_in_a_region_and_can_turn_the_node_on(self):
        self.delays({self.hk: 60, self.jp: 90, self.us: 200})
        reply = self.vpn.handle("best", {"region": "美国", "on": True})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["node"], self.us)
        self.assertTrue(self.vpn.store.data["enabled"])
        self.assertFalse(self.vpn.handle("best", {"region": "火星"})["ok"])

    def test_select_accepts_a_unique_part_of_the_name(self):
        self.assertEqual(self.vpn.handle("select", {"node": "tokyo"})["node"], self.jp)
        reply = self.vpn.handle("select", {"node": "0"})
        self.assertFalse(reply["ok"])
        self.assertIn("个节点名字里含", reply["message"])

    def test_agent_view_is_compact_sorted_and_secret_free(self):
        self.delays({self.hk: 300, self.jp: 80})
        self.vpn.handle("test", {})
        view = self.vpn.agent_view()
        self.assertEqual([n["name"] for n in view["fastest"]], [self.jp, self.hk])
        self.assertEqual(view["alive"], 2)
        self.assertEqual(view["aliveByRegion"], {"日本": 1, "香港": 1})
        self.assertEqual(view["current"]["region"], "香港")
        text = json.dumps(view, ensure_ascii=False)
        for secret in ("pw", "example.com"):
            self.assertNotIn(secret, text)

    def test_tool_requests_are_limited_and_always_carry_the_network_view(self):
        reply = self.manager.request({"id": "1", "action": "vpn", "op": "remove", "id_": "x"})
        self.assertFalse(reply["ok"])
        self.assertIn("节点」面板", reply["reason"])
        reply = self.manager.request({"id": "2", "action": "vpn", "op": "status"})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["result"]["network"]["nodeCount"], 3)
        reply = self.manager.request({"id": "3", "action": "vpn", "op": "enable"})
        self.assertTrue(reply["ok"], reply)
        self.assertTrue(reply["result"]["network"]["enabled"])
        self.vpn.ip_lookup = lambda port: {"ip": "203.0.113.9", "country": "日本", "city": "东京", "port": port}
        reply = self.manager.request({"id": "4", "action": "vpn", "op": "ip"})
        self.assertEqual(reply["result"]["exit"]["ip"], "203.0.113.9")
        self.assertEqual(reply["result"]["exit"]["port"], 54321)  # looked up through the node
        status = self.manager.request({"id": "5", "action": "status"}, launch=False)
        self.assertIn("network", status["result"])


if __name__ == "__main__":
    unittest.main()
