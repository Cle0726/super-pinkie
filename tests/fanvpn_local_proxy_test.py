"""app/fanvpn/local_proxy.py 的纯逻辑单测。

覆盖：分流判断 should_bypass、上游热切换与模式、路由决策、请求头解析、
host:port 拆分、HTTP/CONNECT 两条转发路径的 fail-open / 502 / 400 分支。
上游与目标连接一律用假对象替换（不联网、不碰系统代理）；只有最后一个
端到端用例在 127.0.0.1 的随机端口上起一对本机服务，绝不使用固定端口。
"""

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

FANVPN = Path(__file__).resolve().parents[1] / "app" / "fanvpn"
if str(FANVPN) not in sys.path:
    sys.path.append(str(FANVPN))
import local_proxy as lp  # noqa: E402
from local_proxy import LocalProxy, Upstream, should_bypass  # noqa: E402


class FakeWriter:
    """记录写入内容的假 StreamWriter。"""

    def __init__(self):
        self.buf = bytearray()
        self.closed = False
        self.eof = False

    def write(self, data):
        self.buf.extend(data)

    async def drain(self):
        return None

    def close(self):
        self.closed = True

    def can_write_eof(self):
        return True

    def write_eof(self):
        self.eof = True


class FakeReader:
    """按顺序吐出预置数据块，吐完返回 b\"\"（等价 EOF）。"""

    def __init__(self, *chunks):
        self.chunks = list(chunks)

    async def read(self, _n=-1):
        return self.chunks.pop(0) if self.chunks else b""


def _stream(data, eof=True):
    reader = asyncio.StreamReader()
    reader.feed_data(data)
    if eof:
        reader.feed_eof()
    return reader


class ShouldBypassTest(unittest.TestCase):
    RULES = (".qq.com", "exact.example.org", "<local>", "", "  .Cn  ")

    def test_empty_bare_and_private_hosts_go_direct(self):
        for host in ("", "   ", None, "intranet", "LOCALHOST", "127.0.0.1", "10.1.2.3",
                     "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.0.9",
                     "::1", "fd00::1", "fe80::1"):
            with self.subTest(host=host):
                self.assertTrue(should_bypass(host, ()))

    def test_public_ip_is_proxied_even_if_rules_match_text(self):
        for host in ("8.8.8.8", "172.32.0.1", "172.15.255.255", "2001:4860::8888"):
            with self.subTest(host=host):
                self.assertFalse(should_bypass(host, (".8", ".1")))

    def test_suffix_rule_matches_apex_and_subdomains_only(self):
        self.assertTrue(should_bypass("qq.com", self.RULES))
        self.assertTrue(should_bypass("a.b.qq.com", self.RULES))
        self.assertFalse(should_bypass("notqq.com", self.RULES))
        self.assertFalse(should_bypass("qq.com.evil.io", self.RULES))

    def test_exact_rule_case_trailing_dot_and_padded_rule(self):
        self.assertTrue(should_bypass("Exact.Example.Org.", self.RULES))
        self.assertFalse(should_bypass("sub.exact.example.org", self.RULES))
        self.assertTrue(should_bypass("www.gov.CN", self.RULES))  # 规则带空格与大写
        self.assertFalse(should_bypass("openai.com", self.RULES))

    def test_default_list_is_all_suffix_form(self):
        self.assertTrue(all(rule.startswith(".") for rule in lp.DEFAULT_BYPASS))
        self.assertTrue(should_bypass("www.bilibili.com"))
        self.assertFalse(should_bypass("www.google.com"))


class UpstreamAndModeTest(unittest.TestCase):
    def test_label(self):
        self.assertEqual(Upstream("n.example", 443).label, "https://n.example:443")
        self.assertEqual(Upstream("n.example", 80, tls=False).label, "http://n.example:80")

    def test_set_upstream_coerces_and_inherits_tls(self):
        p = LocalProxy(port=0)
        p.set_upstream("a.example", "443")
        self.assertEqual(p.upstream, Upstream("a.example", 443, True))
        p.set_upstream("b.example", 80, tls=False)
        p.set_upstream("c.example", 81)  # 未指定 tls：沿用上一个上游的 False
        self.assertEqual(p.upstream, Upstream("c.example", 81, False))
        p.set_upstream("d.example", 82, tls=1)
        self.assertIs(p.upstream.tls, True)

    def test_clear_upstream_and_stats(self):
        p = LocalProxy(port=0, mode="global")
        p.set_upstream("a.example", 443)
        self.assertEqual(p.stats, {"direct": 0, "proxied": 0, "failed": 0, "connections": 0,
                                   "mode": "global", "upstream": "https://a.example:443"})
        p.clear_upstream()
        self.assertIsNone(p.stats["upstream"])
        # stats 是拷贝，改它不影响内部计数
        p.stats["direct"] = 99
        self.assertEqual(p.stats["direct"], 0)

    def test_set_mode_validates(self):
        p = LocalProxy(port=0)
        p.set_mode("global")
        with self.assertRaises(ValueError):
            p.set_mode("GLOBAL")
        self.assertEqual(p.mode, "global")

    def test_route_decision(self):
        p = LocalProxy(port=0, bypass=(".cn",))
        self.assertEqual(p._route("www.google.com"), "direct")  # 没上游一律直连
        p.set_upstream("up.example", 443)
        self.assertEqual(p._route("www.google.com"), "proxy")
        self.assertEqual(p._route("www.gov.cn"), "direct")
        p.set_mode("global")
        self.assertEqual(p._route("www.gov.cn"), "proxy")
        self.assertEqual(p._route("127.0.0.1"), "proxy")  # 全局模式不看分流表


class SplitHostPortTest(unittest.TestCase):
    def test_valid_forms(self):
        split = LocalProxy._split_hostport
        self.assertEqual(split("example.com:8443", 443), ("example.com", 8443))
        self.assertEqual(split("example.com", 443), ("example.com", 443))
        self.assertEqual(split("[::1]:8080", 80), ("::1", 8080))

    def test_bad_port(self):
        self.assertIsNone(LocalProxy._split_hostport("example.com:abc", 443))
        self.assertIsNone(LocalProxy._split_hostport("example.com:", 443))


class ReadHeadTest(unittest.IsolatedAsyncioTestCase):
    async def test_splits_first_line_from_headers(self):
        reader = _stream(b"GET http://h/ HTTP/1.1\r\nHost: h\r\nX: 1\r\n\r\nBODY", eof=False)
        first, headers, rest = await LocalProxy._read_head(reader)
        self.assertEqual(first, "GET http://h/ HTTP/1.1")
        self.assertEqual(headers, b"Host: h\r\nX: 1")  # 不含起始行（早期 400 回归）
        self.assertEqual(rest, b"")
        self.assertEqual(await reader.read(4), b"BODY")  # 请求体留在流里给 _pump

    async def test_no_headers_and_degenerate_input(self):
        first, headers, _ = await LocalProxy._read_head(_stream(b"CONNECT a:443 HTTP/1.1\r\n\r\n"))
        self.assertEqual((first, headers), ("CONNECT a:443 HTTP/1.1", b""))
        self.assertIsNone(await LocalProxy._read_head(_stream(b"\r\n\r\n")))
        self.assertIsNone(await LocalProxy._read_head(_stream(b"GET / HTTP/1.1\r\n")))


class DoHttpTest(unittest.IsolatedAsyncioTestCase):
    HEADERS = b"Host: example.com\r\nX-A: 1"

    def setUp(self):
        self.proxy = LocalProxy(port=0)
        self.client = FakeWriter()
        self.target_writer = FakeWriter()
        self.proxy._open = mock.AsyncMock(return_value=(FakeReader(), self.target_writer))
        self.proxy._open_upstream = mock.AsyncMock(side_effect=AssertionError("不该走上游"))
        self.proxy._pump = mock.AsyncMock()

    async def _get(self, target, headers=HEADERS, method="GET"):
        await self.proxy._do_http(method, target, "HTTP/1.1", headers, b"", self.client, object())

    async def test_direct_rewrites_to_origin_form(self):
        await self._get("http://example.com:8080/a/b?c=1")
        self.proxy._open.assert_awaited_once_with("example.com", 8080)
        self.assertEqual(bytes(self.target_writer.buf),
                         b"GET /a/b?c=1 HTTP/1.1\r\nHost: example.com\r\nX-A: 1\r\n\r\n")
        self.assertEqual(self.proxy.stats["direct"], 1)
        self.proxy._pump.assert_awaited_once()
        self.assertEqual(self.client.buf, b"")

    async def test_default_port_root_path_and_uppercase_scheme(self):
        await self._get("HTTP://example.com", headers=b"", method="HEAD")
        self.proxy._open.assert_awaited_once_with("example.com", 80)
        self.assertEqual(bytes(self.target_writer.buf), b"HEAD / HTTP/1.1\r\n\r\n")

    async def test_bracketed_ipv6_with_port(self):
        await self._get("http://[::1]:8080/x")
        self.proxy._open.assert_awaited_once_with("::1", 8080)

    @unittest.expectedFailure
    async def test_bracketed_ipv6_without_port_known_bug(self):
        """已知 bug：http://[::1]/ 不带端口时，_split_hostport 按最后一个冒号拆成
        host='[:'、port='1]'，int() 失败后返回 400；应当按默认端口 80 直连。"""
        await self._get("http://[::1]/x")
        self.proxy._open.assert_awaited_once_with("::1", 80)

    async def test_rejects_non_absolute_or_bad_port(self):
        for target in ("/relative", "https://example.com/", "http://example.com:abc/"):
            with self.subTest(target=target):
                self.client.buf.clear()
                await self._get(target)
                self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 400 Bad Request\r\n\r\n")
        self.proxy._open.assert_not_awaited()
        self.proxy._pump.assert_not_awaited()

    async def test_proxy_keeps_absolute_uri(self):
        up_writer = FakeWriter()
        self.proxy._open_upstream = mock.AsyncMock(return_value=(FakeReader(), up_writer))
        self.proxy.set_upstream("up.example", 443)
        await self._get("http://www.google.com/q")
        self.assertEqual(bytes(up_writer.buf),
                         b"GET http://www.google.com/q HTTP/1.1\r\nHost: example.com\r\nX-A: 1\r\n\r\n")
        self.proxy._open.assert_not_awaited()
        self.assertEqual((self.proxy.stats["proxied"], self.proxy.stats["direct"]), (1, 0))

    async def test_bypassed_host_goes_direct_even_with_upstream(self):
        self.proxy.set_upstream("up.example", 443)
        await self._get("http://www.baidu.com/")
        self.proxy._open.assert_awaited_once_with("www.baidu.com", 80)

    async def test_upstream_failure_falls_back_to_direct(self):
        self.proxy._open_upstream = mock.AsyncMock(side_effect=OSError("node down"))
        self.proxy.set_upstream("up.example", 443)
        await self._get("http://www.google.com/q")
        self.proxy._open.assert_awaited_once_with("www.google.com", 80)
        self.assertTrue(bytes(self.target_writer.buf).startswith(b"GET /q HTTP/1.1\r\n"))
        stats = self.proxy.stats
        self.assertEqual((stats["failed"], stats["direct"], stats["proxied"]), (1, 1, 0))

    async def test_upstream_failure_without_fail_open_is_502(self):
        self.proxy.fail_open = False
        self.proxy._open_upstream = mock.AsyncMock(side_effect=OSError("node down"))
        self.proxy.set_upstream("up.example", 443)
        await self._get("http://www.google.com/q")
        self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        self.proxy._open.assert_not_awaited()
        self.proxy._pump.assert_not_awaited()

    async def test_direct_failure_is_502(self):
        self.proxy._open = mock.AsyncMock(side_effect=OSError("refused"))
        await self._get("http://example.com/")
        self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        self.proxy._pump.assert_not_awaited()


class TunnelTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.proxy = LocalProxy(port=0)
        self.proxy.set_upstream("up.example", 443)
        self.client = FakeWriter()
        self.direct_writer = FakeWriter()
        self.proxy._open = mock.AsyncMock(return_value=(FakeReader(), self.direct_writer))
        self.proxy._pump = mock.AsyncMock()

    def _upstream_replies(self, status_line):
        self.up_writer = FakeWriter()
        self.proxy._open_upstream = mock.AsyncMock(
            return_value=(_stream(status_line + b"\r\nVia: x\r\n\r\n"), self.up_writer))

    async def _connect(self, target="www.google.com:443"):
        await self.proxy._do_connect(target, self.client, object(), b"hello")

    async def test_proxied_connect(self):
        self._upstream_replies(b"HTTP/1.1 200 Connection established")
        await self._connect()
        self.assertEqual(bytes(self.up_writer.buf),
                         b"CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\n\r\n")
        self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 200 Connection Established\r\n\r\n")
        self.assertEqual(self.proxy.stats["proxied"], 1)
        self.proxy._open.assert_not_awaited()
        args = self.proxy._pump.await_args.args
        self.assertIs(args[3], self.up_writer)
        self.assertEqual(args[4], b"hello")

    async def test_refused_upstream_falls_back_and_closes_it(self):
        self._upstream_replies(b"HTTP/1.1 403 Forbidden")
        await self._connect()
        self.assertTrue(self.up_writer.closed)
        self.proxy._open.assert_awaited_once_with("www.google.com", 443)
        self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 200 Connection Established\r\n\r\n")
        self.assertIs(self.proxy._pump.await_args.args[3], self.direct_writer)
        stats = self.proxy.stats
        self.assertEqual((stats["failed"], stats["direct"], stats["proxied"]), (1, 1, 0))

    async def test_refused_without_fail_open_is_502(self):
        self.proxy.fail_open = False
        self._upstream_replies(b"HTTP/1.1 407 Proxy Authentication Required")
        await self._connect()
        self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        self.proxy._open.assert_not_awaited()
        self.proxy._pump.assert_not_awaited()

    async def test_both_paths_fail_is_502(self):
        self.proxy._open_upstream = mock.AsyncMock(side_effect=OSError("node down"))
        self.proxy._open = mock.AsyncMock(side_effect=OSError("refused"))
        await self._connect()
        self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        self.proxy._pump.assert_not_awaited()

    async def test_bypassed_and_bad_targets(self):
        self.proxy._open_upstream = mock.AsyncMock(side_effect=AssertionError("不该走上游"))
        await self._connect("www.qq.com:443")
        self.proxy._open.assert_awaited_once_with("www.qq.com", 443)
        self.client.buf.clear()
        await self._connect("www.qq.com:https")
        self.assertEqual(bytes(self.client.buf), b"HTTP/1.1 400 Bad Request\r\n\r\n")


class HandleAndPumpTest(unittest.IsolatedAsyncioTestCase):
    async def _handle(self, proxy, raw):
        writer = FakeWriter()
        reader = _stream(raw)
        await proxy._handle(reader, writer)
        self.assertTrue(writer.closed)
        self.assertEqual(proxy._connections, 0)
        return reader, writer

    async def test_dispatches_by_method(self):
        proxy = LocalProxy(port=0)
        proxy._do_connect = mock.AsyncMock()
        proxy._do_http = mock.AsyncMock()
        reader, writer = await self._handle(proxy, b"CONNECT a.example:443 HTTP/1.1\r\nHost: a\r\n\r\n")
        proxy._do_connect.assert_awaited_once_with("a.example:443", writer, reader, b"")
        await self._handle(proxy, b"get http://a.example/ HTTP/1.0\r\nHost: a\r\n\r\n")
        self.assertEqual(proxy._do_http.await_args.args[:4],
                         ("GET", "http://a.example/", "HTTP/1.0", b"Host: a"))

    async def test_malformed_or_crashing_requests_are_contained(self):
        proxy = LocalProxy(port=0)
        proxy._do_connect = mock.AsyncMock()
        proxy._do_http = mock.AsyncMock(side_effect=RuntimeError("boom"))
        await self._handle(proxy, b"GARBAGE\r\n\r\n")
        await self._handle(proxy, b"")
        proxy._do_connect.assert_not_awaited()
        await self._handle(proxy, b"GET http://a/ HTTP/1.1\r\n\r\n")  # 异常不外抛

    async def test_pump_forwards_initial_and_closes_both(self):
        client_w, server_w = FakeWriter(), FakeWriter()
        await LocalProxy._pump(FakeReader(b"abc", b"def"), client_w, FakeReader(b"xyz"), server_w, b"INIT")
        self.assertEqual(bytes(server_w.buf), b"INITabcdef")
        self.assertTrue(server_w.closed and client_w.closed)
        self.assertTrue(server_w.eof)


class LoopbackEndToEndTest(unittest.IsolatedAsyncioTestCase):
    """真起监听，但只在 127.0.0.1 随机端口上，没有上游 -> 直连本机回显服务。"""

    async def test_connect_tunnel_echo(self):
        async def echo(reader, writer):
            writer.write(await reader.read(4))
            await writer.drain()
            writer.close()

        target = await asyncio.start_server(echo, "127.0.0.1", 0)
        target_port = target.sockets[0].getsockname()[1]
        proxy = LocalProxy(port=0)
        await proxy.start()
        self.assertNotEqual(proxy.port, 0)
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", proxy.port)
            writer.write(f"CONNECT 127.0.0.1:{target_port} HTTP/1.1\r\n\r\n".encode())
            await writer.drain()
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
            self.assertTrue(head.startswith(b"HTTP/1.1 200"))
            writer.write(b"ping")
            await writer.drain()
            self.assertEqual(await asyncio.wait_for(reader.readexactly(4), 5), b"ping")
            writer.close()
            self.assertEqual(proxy.stats["direct"], 1)
        finally:
            await proxy.stop()
            target.close()
            await target.wait_closed()
        self.assertIsNone(proxy._server)
        await proxy.stop()  # 重复 stop 不应抛


if __name__ == "__main__":
    unittest.main(verbosity=2)
