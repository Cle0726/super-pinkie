"""app/fanvpn_bridge.py 的纯逻辑单测。

FanVpnBridge 是给 pywebview js_api 调的薄壳：任何失败都要变成结构化状态，不能抛给前端。
这里把 fanvpn_service / win_bootstrap_keys 换成注入 sys.modules 的假模块，
不起监听、不碰系统代理与注册表；私钥查找的兜底路径全部重定向到临时目录，
不读 ~/.openclaw，也不读仓库里 background.js 携带的真实私钥。
"""

import contextlib
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

APP = Path(__file__).resolve().parents[1] / "app"
if str(APP) not in sys.path:
    sys.path.append(str(APP))
import fanvpn_bridge as fb  # noqa: E402

# 拼接写出头尾行，避免整段被当成真实私钥扫描
PEM = "-----BEGIN " + "PRIVATE KEY-----\nAAAA\n-----END " + "PRIVATE KEY-----\n"


class FakeService:
    """记录调用的假 FanVpnService；行为由类属性 plan 控制（每个用例在 setUp 里重置）。"""

    plan = {}
    instances = []

    def __init__(self, settings):
        if self.plan.get("init_error"):
            raise self.plan["init_error"]
        self.settings = settings
        self.initial = dict(vars(settings))
        self.calls = []
        self.applied = False
        self.nodes = [SimpleNamespace(name="美国", server="us.example", port=443, flag="US")]
        self.active = None
        self.proxy = SimpleNamespace(mode="smart")
        self.config = mock.Mock()
        FakeService.instances.append(self)

    @property
    def panel_url(self):
        return f"http://127.0.0.1:{self.settings.panel_port}/"

    def start(self, timeout):
        self.calls.append(("start", timeout))
        if not self.plan.get("start_ok", True):
            return False
        self.settings.panel_port, self.settings.proxy_port = 50001, 50002  # 模拟绑到实际端口
        return True

    def _call(self, name, *args):
        self.calls.append((name,) + args)
        if self.plan.get(name + "_error"):
            raise self.plan[name + "_error"]

    def _state_payload(self):
        self._call("_state_payload")
        return {"system": {"applied": self.applied, "method": "pac"}}

    def apply_system_proxy(self, method):
        self._call("apply_system_proxy", method)
        self.applied = True

    def restore_system_proxy(self):
        self._call("restore_system_proxy")
        self.applied = False

    def stop(self):
        self._call("stop")

    def select_node(self, server, port):
        self._call("select_node", server, port)


class BridgeCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        FakeService.plan, FakeService.instances = {}, []
        service_mod = types.ModuleType("fanvpn_service")
        service_mod.FanVpnService = FakeService
        service_mod.FanVpnSettings = lambda **kw: SimpleNamespace(**kw)
        self.keys = types.ModuleType("win_bootstrap_keys")
        self.keys.extract_from_js = mock.Mock(return_value=None)
        for patcher in (
            mock.patch.dict(sys.modules, {"fanvpn_service": service_mod, "win_bootstrap_keys": self.keys}),
            # 兜底候选 Path(__file__)/fanvpn/_key.pem 与 ~/.openclaw/... 都落到临时目录
            mock.patch.object(fb, "__file__", str(self.root / "app" / "fanvpn_bridge.py")),
            mock.patch.object(fb.Path, "home", return_value=self.root / "home"),
            # _ensure_path 会改 sys.path，给它一份拷贝，用例结束自动还原
            mock.patch.object(fb.sys, "path", list(sys.path)),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def started(self, **kwargs):
        bridge = fb.FanVpnBridge(key_source=PEM, **kwargs)
        bridge.start()
        return bridge, FakeService.instances[-1]

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path


class StatusTest(BridgeCase):
    def test_idle_status(self):
        bridge = fb.FanVpnBridge()
        self.assertFalse(bridge.running)
        self.assertEqual(bridge.status(), {"ok": True, "running": False, "enabled": False, "proxyPort": 10809,
                                           "panelUrl": None, "nodes": [], "active": None, "error": None})
        self.assertEqual((fb.DEFAULT_PROXY_PORT, fb.DEFAULT_PANEL_PORT), (10809, 10810))

    def test_running_status_and_payload_failure(self):
        bridge, svc = self.started()
        svc.active, svc.proxy.mode = svc.nodes[0], "global"
        st = bridge.status()
        self.assertEqual(st["nodes"], [{"name": "美国", "server": "us.example", "port": 443, "flag": "US"}])
        self.assertEqual((st["running"], st["enabled"], st["active"], st["mode"], st["panelUrl"], st["proxyPort"]),
                         (True, False, "us.example", "global", "http://127.0.0.1:50001/", 50002))
        FakeService.plan = {"_state_payload_error": RuntimeError("boom")}
        st = bridge.status()  # 状态查询永远不抛
        self.assertEqual((st["ok"], st["system"], st["enabled"]), (True, {}, False))

    def test_webview_proxy_note(self):
        note = fb.webview_proxy_note()
        self.assertIn("127.0.0.1", note)
        self.assertIn("webview.settings", note)


class StartTest(BridgeCase):
    def test_start_passes_settings_and_is_idempotent(self):
        bridge = fb.FanVpnBridge(key_source=PEM, proxy_port=1234)
        st = bridge.start()
        svc = FakeService.instances[0]
        self.assertEqual(svc.initial, {"panel_port": 10810, "proxy_port": 1234, "key_path": PEM})
        self.assertEqual(svc.calls[0], ("start", 20.0))
        self.assertEqual((st["running"], bridge.panel_port, bridge.proxy_port, bridge.last_error),
                         (True, 50001, 50002, None))
        # 已在运行：直接回状态，不新建服务，也不顺手接管系统代理
        bridge.start(enable_system_proxy=True)
        self.assertEqual(len(FakeService.instances), 1)
        self.assertNotIn("apply_system_proxy", [c[0] for c in svc.calls])

    def test_concurrent_start_creates_one_service(self):
        bridge = fb.FanVpnBridge(key_source=PEM)
        threads = [threading.Thread(target=bridge.start) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(5)
        self.assertEqual(len(FakeService.instances), 1)

    def test_start_with_system_proxy(self):
        st = fb.FanVpnBridge(key_source=PEM).start(enable_system_proxy=True)
        self.assertIn(("apply_system_proxy", "pac"), FakeService.instances[0].calls)
        self.assertTrue(st["enabled"])

    def test_start_failures_become_last_error(self):
        cases = (({"start_ok": False}, "FanVPN 服务启动超时", False),
                 ({"init_error": RuntimeError("端口被占")}, "FanVPN 启动失败: 端口被占", True))
        for plan, message, logs in cases:
            with self.subTest(message=message):
                FakeService.plan = plan
                bridge = fb.FanVpnBridge(key_source=PEM)
                with self.assertLogs("pinkie.fanvpn", "ERROR") if logs else contextlib.nullcontext():
                    st = bridge.start()
                self.assertEqual((st["running"], st["error"]), (False, message))
                self.assertFalse(bridge.running)

    def test_missing_service_module(self):
        sys.modules["fanvpn_service"] = None  # import 时抛 ImportError
        bridge = fb.FanVpnBridge(key_source=PEM)
        with self.assertLogs("pinkie.fanvpn", "ERROR"):
            st = bridge.start()
        self.assertIn("缺少 FanVPN 服务模块", st["error"])
        self.assertFalse(bridge.running)

    def test_missing_key(self):
        st = fb.FanVpnBridge().start()
        self.assertTrue(st["error"].startswith("找不到节点配置密钥"))
        self.assertEqual(FakeService.instances, [])


class StopTest(BridgeCase):
    def test_stop_restores_before_stopping(self):
        bridge, svc = self.started()
        bridge.enable_browser_proxy()
        st = bridge.stop()
        names = [c[0] for c in svc.calls if c[0] != "_state_payload"]
        self.assertEqual(names[-2:], ["restore_system_proxy", "stop"])
        self.assertEqual((st["running"], bridge.running), (False, False))
        bridge.stop()  # 再停一次是空操作
        self.assertEqual(svc.calls.count(("stop",)), 1)

    def test_stop_keeps_going_when_restore_or_stop_fails(self):
        bridge, svc = self.started()
        FakeService.plan = {"restore_system_proxy_error": OSError("注册表只读"), "stop_error": RuntimeError("x")}
        with self.assertLogs("pinkie.fanvpn", "ERROR"):
            st = bridge.stop()
        self.assertIn(("stop",), svc.calls)
        self.assertEqual((st["running"], st["error"]), (False, "还原系统代理失败: 注册表只读"))


class BrowserProxyTest(BridgeCase):
    def test_enable_starts_service_first(self):
        st = fb.FanVpnBridge(key_source=PEM).enable_browser_proxy("direct")
        self.assertEqual((st["running"], st["enabled"]), (True, True))
        self.assertIn(("apply_system_proxy", "direct"), FakeService.instances[0].calls)

    def test_enable_returns_start_failure_without_applying(self):
        FakeService.plan = {"start_ok": False}
        st = fb.FanVpnBridge(key_source=PEM).enable_browser_proxy()
        self.assertFalse(st["running"])
        self.assertNotIn("apply_system_proxy", [c[0] for c in FakeService.instances[0].calls])

    def test_enable_and_disable_errors(self):
        bridge, _ = self.started()
        FakeService.plan = {"apply_system_proxy_error": PermissionError("拒绝"),
                            "restore_system_proxy_error": OSError("坏了")}
        with self.assertLogs("pinkie.fanvpn", "ERROR"):
            self.assertEqual(bridge.enable_browser_proxy()["error"], "设置系统代理失败: 拒绝")
        with self.assertLogs("pinkie.fanvpn", "ERROR"):
            self.assertEqual(bridge.disable_browser_proxy()["error"], "还原系统代理失败: 坏了")
        FakeService.plan = {}
        self.assertTrue(bridge.enable_browser_proxy()["enabled"])
        self.assertIsNone(bridge.last_error)  # 接管成功后清掉旧错误
        self.assertFalse(bridge.disable_browser_proxy()["enabled"])

    def test_disable_when_idle_does_not_start(self):
        st = fb.FanVpnBridge(key_source=PEM).disable_browser_proxy()
        self.assertFalse(st["running"])
        self.assertEqual(FakeService.instances, [])


class NodesTest(BridgeCase):
    def test_select_node(self):
        bridge = fb.FanVpnBridge(key_source=PEM)
        self.assertFalse(bridge.select_node("a", 1)["running"])  # 没在跑：不报错，回状态
        bridge.start()
        svc = FakeService.instances[0]
        bridge.select_node(123, "443")
        self.assertIn(("select_node", "123", 443), svc.calls)
        FakeService.plan = {"select_node_error": RuntimeError("service not started")}
        self.assertEqual(bridge.select_node("a", 1)["error"], "切换节点失败: service not started")
        FakeService.plan = {}
        self.assertIn("切换节点失败", bridge.select_node("a", "x")["error"])  # int() 失败也被收住

    def test_refresh_nodes(self):
        bridge = fb.FanVpnBridge(key_source=PEM)
        self.assertTrue(bridge.refresh_nodes()["running"])  # 没在跑：等价于 start
        svc = FakeService.instances[0]
        svc.config.load.return_value = [SimpleNamespace(name="日本", server="jp.example", port=8443, flag="JP")]
        self.assertEqual(bridge.refresh_nodes()["nodes"][0]["server"], "jp.example")
        svc.config.load.assert_called_with(force=True)
        svc.config.load.side_effect = OSError("offline")
        st = bridge.refresh_nodes()
        self.assertEqual(st["error"], "刷新节点失败: offline")
        self.assertEqual(st["nodes"][0]["server"], "jp.example")  # 失败时保留旧节点表


class ResolveKeyTest(BridgeCase):
    def test_explicit_pem_text_and_file(self):
        key_file = self.write("k.pem", PEM)
        for source in (PEM, key_file, str(key_file)):
            with self.subTest(source=type(source).__name__):
                self.assertEqual(fb.FanVpnBridge(key_source=source)._resolve_key(), PEM)
        self.keys.extract_from_js.assert_not_called()

    def test_explicit_source_without_pem_falls_back_to_extension(self):
        self.keys.extract_from_js.return_value = "from-js"
        for source in (self.write("note.txt", "not a key"), self.root / "missing.pem", self.root, "", None):
            with self.subTest(source=source):
                self.assertEqual(fb.FanVpnBridge(key_source=source)._resolve_key(), "from-js")

    def test_fallback_candidates_in_order(self):
        sys.modules["win_bootstrap_keys"] = None  # 提取模块缺失也要继续往下找
        home_pem = PEM.replace("AAAA", "HOME")
        self.write("home/.openclaw/fanvpn/_key.pem", home_pem)
        bridge = fb.FanVpnBridge()
        self.assertEqual(bridge._resolve_key(), home_pem)
        self.write("app/fanvpn/_key.pem", PEM)
        self.assertEqual(bridge._resolve_key(), PEM)  # 程序目录旁的 pem 优先
        self.write("app/fanvpn/_key.pem", "garbage")
        self.assertEqual(bridge._resolve_key(), home_pem)  # 不是 PEM 的文件跳过

    def test_nothing_found_sets_last_error(self):
        self.write("home/.openclaw/fanvpn/_key.pem", "not pem")
        bridge = fb.FanVpnBridge()
        self.assertIsNone(bridge._resolve_key())
        self.assertIn("~/.openclaw/fanvpn/_key.pem", bridge.last_error)

    @unittest.expectedFailure
    def test_explicit_pkcs1_pem_text_known_bug(self):
        """疑似 bug：显式传入 PKCS#1 文本（BEGIN RSA PRIVATE KEY）时只认 "BEGIN PRIVATE KEY"，
        被当成路径后静默落到兜底来源；而 purecrypto 与 FanVpnService._load_key 都接受 PKCS#1。"""
        pkcs1 = "-----BEGIN RSA " + "PRIVATE KEY-----\nAAAA\n-----END RSA " + "PRIVATE KEY-----\n"
        self.assertEqual(fb.FanVpnBridge(key_source=pkcs1)._resolve_key(), pkcs1)


class EnsurePathTest(BridgeCase):
    def test_idempotent(self):
        fb._ensure_path()
        before = list(sys.path)
        fb._ensure_path()
        self.assertEqual(sys.path, before)

    @unittest.expectedFailure
    def test_adds_fanvpn_dir_known_bug(self):
        """已知 bug：docstring 说把 app/fanvpn 放进 sys.path，实际插入的是 app/ 本身。
        从源码树运行时 start() 里的 `from fanvpn_service import ...` 因此 ImportError。"""
        sys.path[:] = []
        fb._ensure_path()
        self.assertIn(str(Path(fb.__file__).resolve().parent / "fanvpn"), sys.path)


class SingletonTest(BridgeCase):
    def test_get_bridge_and_shutdown(self):
        with mock.patch.object(fb, "_bridge", None):
            first = fb.get_bridge()
            self.assertIs(fb.get_bridge(), first)
            with mock.patch.object(first, "stop") as stop:
                fb.shutdown()
            stop.assert_called_once_with()
            self.assertIsNone(fb._bridge)
            fb.shutdown()  # 没有实例时是空操作
            self.assertIsNot(fb.get_bridge(), first)


if __name__ == "__main__":
    unittest.main(verbosity=2)
