"""app/fanvpn/fanvpn_service.py 的纯逻辑单测。

覆盖：私钥来源解析、节点热切换、系统代理接管/还原（快照只拍一次）、
WebView2 参数与环境变量、面板 HTTP 路由的各分支与错误码、面板请求解析、
启动流程与后台线程生命周期。
系统代理一律走临时目录里的 JsonFileBackend，快照也存临时目录；
不联网（FanVpnConfig / probe_node 用假对象），监听只用 127.0.0.1 的 0 号端口。
"""

import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

FANVPN = Path(__file__).resolve().parents[1] / "app" / "fanvpn"
if str(FANVPN) not in sys.path:
    sys.path.append(str(FANVPN))
import fanvpn_service as fs  # noqa: E402
import win_sysproxy as w  # noqa: E402
from fanvpn_core import ConfigError, Node  # noqa: E402
from local_proxy import Upstream  # noqa: E402

FAKE_PEM_HEAD = "-----BEGIN " + "PRIVATE KEY-----\n"  # 拼接写，避免被当成真实私钥扫描


def make_service(root, **settings):
    backend = w.JsonFileBackend(root / "reg.json")
    with mock.patch.object(fs, "SystemProxyManager",
                           lambda: w.SystemProxyManager(backend=backend, notify=False)), \
            mock.patch.object(fs, "SnapshotStore", lambda: w.SnapshotStore(root / "backup.json")):
        return fs.FanVpnService(fs.FanVpnSettings(**settings))


class FakeWriter:
    def __init__(self):
        self.buf, self.closed = bytearray(), False

    def write(self, data):
        self.buf.extend(data)

    async def drain(self):
        return None

    def close(self):
        self.closed = True


def _stream(data):
    reader = asyncio.StreamReader()
    reader.feed_data(data)
    reader.feed_eof()
    return reader


class ServiceMixin:
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.svc = make_service(self.root)


class LoadKeyTest(ServiceMixin, unittest.TestCase):
    def key(self, value):
        self.svc.settings.key_path = value
        return self.svc._load_key()

    def test_missing_source(self):
        with self.assertRaisesRegex(ConfigError, "缺少"):
            self.key(None)

    def test_pem_text_returned_as_is(self):
        pem = "  \n" + FAKE_PEM_HEAD + "AAAA\n"
        self.assertEqual(self.key(pem), pem)

    def test_path_object_and_string_path(self):
        f = self.root / "k.pem"
        f.write_text("内容", encoding="utf-8")
        self.assertEqual(self.key(f), "内容")
        self.assertEqual(self.key(str(f)), "内容")

    def test_missing_file_and_directory(self):
        with self.assertRaisesRegex(ConfigError, "不存在"):
            self.key(self.root / "nope.pem")
        with self.assertRaisesRegex(ConfigError, "不存在"):
            self.key(self.root)  # 目录不是文件
        with self.assertRaisesRegex(ConfigError, "既不是"):
            self.key(str(self.root / "nope.pem"))


class PropertiesTest(ServiceMixin, unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(fs.FanVpnSettings(), fs.FanVpnSettings(10810, 10809, None, "smart"))
        self.assertEqual((self.svc.proxy.port, self.svc.proxy.mode), (10809, "smart"))
        self.assertIsNone(self.svc.proxy.upstream)
        self.assertIsNone(self.svc.active)
        self.assertEqual(make_service(self.root, mode="global").proxy.mode, "global")

    def test_webview2_args_and_panel_url(self):
        self.assertEqual(self.svc.webview2_args,
                         '--proxy-server="http://127.0.0.1:10809" --proxy-bypass-list="<-loopback>"')
        self.assertEqual(self.svc.panel_url, "http://127.0.0.1:10810/")
        self.svc.settings.proxy_port = 0
        self.assertEqual(self.svc.webview2_args, "")

    def test_apply_to_webview2_env(self):
        name = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
        args = self.svc.webview2_args
        with mock.patch.dict(os.environ, {}, clear=True):
            fs.apply_to_webview2_env(self.svc)
            self.assertEqual(os.environ[name], args)
        with mock.patch.dict(os.environ, {name: " --foo "}, clear=True):
            fs.apply_to_webview2_env(self.svc)
            self.assertEqual(os.environ[name], "--foo " + args)
        self.svc.settings.proxy_port = 0
        with mock.patch.dict(os.environ, {}, clear=True):
            fs.apply_to_webview2_env(self.svc)
            self.assertNotIn(name, os.environ)

    def test_select_before_start_and_stop_without_loop(self):
        with self.assertRaises(RuntimeError):
            self.svc.select_node("a.example", 443)
        self.svc.stop()  # 没起循环时是空操作

    def test_state_payload_shape(self):
        self.svc.nodes = [Node("美国", "us.example", 443, "US")]
        p = self.svc._state_payload()
        self.assertEqual(p["nodes"], [{"name": "美国", "server": "us.example", "port": 443,
                                       "flag": "US", "status": None, "ms": 0}])
        self.assertEqual((p["active"], p["connected"], p["mode"], p["proxyPort"]), (None, False, "smart", 10809))
        self.assertEqual(p["system"]["current"], {name: "" for name in w.MANAGED_VALUES})
        self.assertEqual((p["system"]["applied"], p["system"]["platform"]), (False, sys.platform))

    def test_reload_and_probe_helpers(self):
        node = Node("A", "a.example", 443)
        self.svc.config = mock.Mock()
        self.svc.config.load.return_value = [node]
        self.assertEqual(self.svc._reload_sync(True), [node])
        self.svc.config.load.assert_called_once_with(force=True)
        self.assertEqual(self.svc.nodes, [node])
        with mock.patch.object(fs, "probe_node", side_effect=lambda n: {"server": n.server}):
            self.assertEqual(self.svc._probe_all(), [{"server": "a.example"}])


class SystemProxyTest(ServiceMixin, unittest.TestCase):
    def test_rejects_unknown_method_before_snapshot(self):
        with self.assertRaises(ValueError):
            self.svc.apply_system_proxy("socks")
        self.assertFalse(self.svc.snapshot_store.path.exists())

    def test_apply_twice_keeps_first_snapshot_then_restore(self):
        be = self.svc.sysproxy.backend
        be.write(w.INTERNET_SETTINGS, "ProxyServer", w.REG_SZ, "corp:8080")
        be.write(w.INTERNET_SETTINGS, "ProxyEnable", w.REG_DWORD, 1)
        system = self.svc.apply_system_proxy(None)
        self.assertEqual((system["applied"], system["method"]), (True, "pac"))
        self.assertEqual(self.svc.sysproxy.current()["AutoConfigURL"], "http://127.0.0.1:10810/proxy.pac")

        self.svc.apply_system_proxy("DIRECT")
        cur = self.svc.sysproxy.current()
        self.assertEqual((cur["ProxyServer"], cur["ProxyEnable"]), ("127.0.0.1:10809", 1))
        self.assertEqual(self.svc._state_payload()["system"]["method"], "direct")
        # 第二次接管不能把快照覆盖成「我们自己改过的状态」
        self.assertEqual(self.svc.snapshot_store.load().values["ProxyServer"], [w.REG_SZ, "corp:8080"])

        self.svc.restore_system_proxy()
        cur = self.svc.sysproxy.current()
        self.assertEqual((cur["ProxyServer"], cur["ProxyEnable"]), ("corp:8080", 1))
        self.assertIsNone(cur["AutoConfigURL"])
        self.assertIsNone(self.svc.snapshot_store.load())

    def test_apply_records_what_it_wrote_for_stale_recovery(self):
        # B109：被强杀后下次启动只认这份记录，所以要记实际写进去的值和实际端口。
        self.svc.settings.panel_port = 10877
        self.svc.apply_system_proxy("pac")
        applied = self.svc.snapshot_store.load_applied()
        self.assertEqual(applied["values"], self.svc.sysproxy.current())
        self.assertEqual(applied["values"]["AutoConfigURL"], "http://127.0.0.1:10877/proxy.pac")
        self.assertEqual(applied["port"], 10877)
        self.svc.apply_system_proxy("direct")
        applied = self.svc.snapshot_store.load_applied()
        self.assertEqual((applied["values"]["ProxyServer"], applied["port"]), ("127.0.0.1:10809", 10809))
        self.svc.restore_system_proxy()
        self.assertIsNone(self.svc.snapshot_store.load_applied())

    def test_restore_without_snapshot_only_disables(self):
        self.svc.sysproxy.apply_direct("127.0.0.1:1")
        with self.assertLogs("fanvpn_service", "WARNING"):
            self.svc.restore_system_proxy()
        cur = self.svc.sysproxy.current()
        self.assertEqual((cur["ProxyEnable"], cur["AutoConfigURL"], cur["ProxyServer"]), (0, "", "127.0.0.1:1"))


class RouteTest(ServiceMixin, unittest.IsolatedAsyncioTestCase):
    async def call(self, method, path, body=b"", query=""):
        return await self.svc._route(method, path, query, body)

    @staticmethod
    def js(payload):
        return json.loads(payload.decode("utf-8"))

    async def test_static_and_unknown_routes(self):
        status, ctype, payload = await self.call("GET", "/")
        self.assertEqual((status, ctype), ("200 OK", "text/html; charset=utf-8"))
        self.assertIn("FanVPN 节点", payload.decode("utf-8"))
        _, ctype, payload = await self.call("GET", "/proxy.pac")
        self.assertEqual(ctype, "application/x-ns-proxy-autoconfig")
        self.assertIn(b"PROXY 127.0.0.1:10809; DIRECT", payload)
        for method, path in (("POST", "/"), ("GET", "/nope"), ("GET", "/api/select"), ("GET", "/api/mode")):
            with self.subTest(path=path):
                self.assertEqual((await self.call(method, path))[:2], ("404 Not Found", "text/plain; charset=utf-8"))
        self.assertEqual(self.js((await self.call("POST", "/api/state"))[2])["mode"], "smart")  # 不限方法
        self.assertIs(self.js((await self.call("GET", "/api/system"))[2])["applied"], False)

    async def test_select_known_and_unknown_node(self):
        self.svc.nodes = [Node("东京", "jp.example", 443, "JP")]
        status, _, payload = await self.call("POST", "/api/select", b'{"server": "jp.example", "port": "443"}')
        body = self.js(payload)
        self.assertEqual((status, body["active"], body["connected"]), ("200 OK", "jp.example", True))
        self.assertEqual(self.svc.active.name, "东京")
        self.assertEqual(self.svc.proxy.upstream, Upstream("jp.example", 443, True))
        await self.svc._select("x.example", "8443")
        self.assertEqual(self.svc.active, Node("x.example", "x.example", 8443))
        self.assertEqual(self.svc.proxy.upstream.port, 8443)

    async def test_select_bad_input_is_400(self):
        for body in (b"", b"{}", b'{"server": "a"}', b'{"server": "a", "port": "x"}', b"not json", b"[1]"):
            with self.subTest(body=body):
                status, _, payload = await self.call("POST", "/api/select", body)
                self.assertEqual(status, "400 Bad Request")
                self.assertIn("error", self.js(payload))
        self.assertIsNone(self.svc.active)

    async def test_mode_route(self):
        self.assertEqual(self.js((await self.call("POST", "/api/mode", b'{"mode": "global"}'))[2])["mode"], "global")
        self.assertEqual(self.js((await self.call("POST", "/api/mode", b"{}"))[2])["mode"], "smart")
        self.assertEqual((await self.call("POST", "/api/mode", b'{"mode": "turbo"}'))[0], "400 Bad Request")
        self.assertEqual(self.svc.proxy.mode, "smart")

    async def test_system_apply_and_restore_routes(self):
        body = self.js((await self.call("POST", "/api/system/apply", b""))[2])
        self.assertEqual((body["ok"], body["applied"], body["method"]), (True, True, "pac"))
        for bad in (b'{"method": "socks"}', b"{bad"):
            with self.subTest(body=bad):
                self.assertEqual((await self.call("POST", "/api/system/apply", bad))[0], "400 Bad Request")
        body = self.js((await self.call("POST", "/api/system/restore"))[2])
        self.assertEqual((body["ok"], body["applied"]), (True, False))

    @unittest.expectedFailure
    async def test_non_object_json_body_known_bug(self):
        """已知 bug：/api/system/apply 与 /api/mode 收到合法但非对象的 JSON（如 []）时
        data.get 抛 AttributeError，不在 except ValueError 里；_handle_panel 吞掉异常后
        直接断开连接，客户端收不到任何响应。应当和其它坏输入一样回 400。"""
        for path in ("/api/system/apply", "/api/mode"):
            self.assertEqual((await self.call("POST", path, b"[]"))[0], "400 Bad Request")

    async def test_nodes_reload_only_when_empty_or_forced(self):
        node = Node("A", "a.example", 443)
        self.svc._reload_sync = mock.Mock(side_effect=lambda force: setattr(self.svc, "nodes", [node]))
        self.svc._probe_all = mock.Mock(return_value=[{"server": "a.example", "status": "ok", "ms": 12}])
        item = self.js((await self.call("GET", "/api/nodes"))[2])["nodes"][0]
        self.assertEqual((item["status"], item["ms"]), ("ok", 12))
        self.svc._reload_sync.assert_called_once_with(False)
        await self.call("GET", "/api/nodes")
        self.assertEqual(self.svc._reload_sync.call_count, 1)
        await self.call("GET", "/api/nodes", query="force=1")
        self.svc._reload_sync.assert_called_with(True)

    async def test_nodes_reload_failure_still_answers(self):
        self.svc.nodes = [Node("A", "a.example", 443), Node("B", "b.example", 443)]
        self.svc._reload_sync = mock.Mock(side_effect=ConfigError("down"))
        self.svc._probe_all = mock.Mock(return_value=[{"server": "b.example", "status": "fail", "ms": 0}])
        with self.assertLogs("fanvpn_service", "WARNING"):
            status, _, payload = await self.call("GET", "/api/nodes", query="force=1")
        self.assertEqual(status, "200 OK")
        self.assertEqual([n["status"] for n in self.js(payload)["nodes"]], [None, "fail"])

    async def test_handle_panel_writes_full_response(self):
        body = b'{"mode": "global"}'
        raw = b"POST /api/mode?x=1 HTTP/1.1\r\nHost: a\r\ncontent-LENGTH: %d\r\n\r\n" % len(body) + body
        writer = FakeWriter()
        await self.svc._handle_panel(_stream(raw), writer)
        head, _, payload = bytes(writer.buf).partition(b"\r\n\r\n")
        self.assertTrue(head.startswith(b"HTTP/1.1 200 OK\r\n"))
        for line in (b"Content-Length: %d" % len(payload), b"Cache-Control: no-store", b"Connection: close"):
            self.assertIn(line, head)
        self.assertEqual(json.loads(payload)["mode"], "global")
        self.assertTrue(writer.closed)

    async def test_handle_panel_garbage_closes_silently(self):
        for raw in (b"", b"NOSPACE\r\n\r\n", b"POST / HTTP/1.1\r\nContent-Length: 50\r\n\r\nshort"):
            with self.subTest(raw=raw):
                writer = FakeWriter()
                await self.svc._handle_panel(_stream(raw), writer)
                self.assertEqual((bytes(writer.buf), writer.closed), (b"", True))

    async def test_boot_binds_ephemeral_ports_and_survives_config_error(self):
        self.svc.settings.panel_port = self.svc.settings.proxy_port = self.svc.proxy.port = 0
        self.svc.settings.key_path = FAKE_PEM_HEAD
        fake_config = mock.Mock()
        fake_config.return_value.load.side_effect = ConfigError("offline")
        with mock.patch.object(fs, "FanVpnConfig", fake_config), self.assertLogs("fanvpn_service", "WARNING"):
            await self.svc._boot()
        try:
            fake_config.assert_called_once_with(FAKE_PEM_HEAD)
            self.assertEqual(self.svc.nodes, [])
            self.assertNotEqual(self.svc.settings.panel_port, 0)
            self.assertNotEqual(self.svc.settings.proxy_port, 0)
            self.assertEqual(self.svc.proxy.port, self.svc.settings.proxy_port)
            self.assertIsNone(self.svc.proxy.upstream)  # 默认不挂上游，等用户自己选
        finally:
            self.svc._panel_server.close()
            await self.svc._panel_server.wait_closed()
            await self.svc.proxy.stop()


class LifecycleTest(ServiceMixin, unittest.TestCase):
    def tearDown(self):
        # 源码 _run 退出后不关闭自己的事件循环，测试收尾替它关掉，免得 ResourceWarning
        thread, loop = self.svc._thread, self.svc._loop
        if thread is not None:
            thread.join(5)
        if loop is not None and not loop.is_running() and not loop.is_closed():
            loop.close()

    def test_start_select_stop_on_background_loop(self):
        self.svc._boot = mock.AsyncMock()
        self.assertTrue(self.svc.start(timeout=5))
        try:
            self.svc.select_node("a.example", 443)
            for _ in range(500):
                if self.svc.active:
                    break
                time.sleep(0.01)
            self.assertEqual(self.svc.active.server, "a.example")
        finally:
            self.svc.stop()
            self.svc._thread.join(5)
        self.assertFalse(self.svc._thread.is_alive())

    @unittest.expectedFailure
    def test_boot_failure_reported_as_success_known_bug(self):
        """已知 bug：_boot 抛异常（端口被占、私钥坏）时 _run 照样 set 了 _ready，
        start() 于是返回 True；FanVpnBridge 据此把服务记成 running，面板/代理其实没在监听。"""
        self.svc._boot = mock.AsyncMock(side_effect=OSError("port in use"))
        with self.assertLogs("fanvpn_service", "ERROR"):
            ok = self.svc.start(timeout=5)
            self.svc._thread.join(5)
        self.assertFalse(ok)

    def test_start_fanvpn_key_source_forms(self):
        created = []

        class FakeService:
            def __init__(self, settings):
                self.settings, self.started = settings, False
                created.append(self)

            def start(self):
                self.started = True

        with mock.patch.object(fs, "FanVpnService", FakeService), mock.patch.object(fs, "_service", None):
            pem = "\n" + FAKE_PEM_HEAD
            fs.start_fanvpn(pem, panel_port=1, proxy_port=2)
            self.assertEqual(created[-1].settings, fs.FanVpnSettings(1, 2, pem))
            fs.start_fanvpn("keys/k.pem")
            self.assertEqual(created[-1].settings.key_path, Path("keys/k.pem"))
            key = Path("k.pem")
            self.assertIs(fs.start_fanvpn(key), created[-1])
            self.assertIs(created[-1].settings.key_path, key)
            self.assertIs(fs._service, created[-1])
            self.assertTrue(all(s.started for s in created))


if __name__ == "__main__":
    unittest.main(verbosity=2)
