"""app/fanvpn/fanvpn_core.py 的纯逻辑单测。

只测纯逻辑：配置源依次回退、解密异常包装、节点表清洗、5 分钟缓存、TLS 探测结果整形。
网络、解密、socket / ssl 全部打桩：urlopen 换成按 URL 查表的假函数，decrypt_envelope 换成返回固定明文的假函数，
probe_node 的 create_connection / create_default_context 换成假对象；不联网、不起监听，
也不读仓库 background.js 里携带的真实私钥（私钥用一把玩具 RSA 现拼）。
"""

import base64
import contextlib
import dataclasses
import http.client
import ssl
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

FANVPN = Path(__file__).resolve().parents[1] / "app" / "fanvpn"
if str(FANVPN) not in sys.path:
    sys.path.append(str(FANVPN))
import fanvpn_core as fc  # noqa: E402

# 玩具 RSA（p=61, q=53）：只让构造函数里的 PEM 解析走通，真正的解密一律打桩。
N, E, D = 3233, 17, 2753
URLS = ("https://a.invalid/config.json", "https://b.invalid/config.json", "https://c.invalid/config.json")


def _tlv(tag, body):
    if len(body) < 0x80:
        head = bytes([len(body)])
    else:
        size = len(body).to_bytes((len(body).bit_length() + 7) // 8, "big")
        head = bytes([0x80 | len(size)]) + size
    return bytes([tag]) + head + body


def _int(value):
    return _tlv(0x02, value.to_bytes(max(1, (value.bit_length() + 8) // 8), "big"))


def toy_pem():
    der = _tlv(0x30, _int(0) + _int(N) + _int(E) + _int(D))
    # 拼接写出头尾行，避免整段被当成真实私钥扫描
    return ("-----BEGIN " + "RSA PRIVATE KEY-----\n" + base64.b64encode(der).decode()
            + "\n-----END " + "RSA PRIVATE KEY-----\n")


class FakeResponse:
    """urlopen 返回的假响应：可设状态码、正文，或让 read() 抛异常。"""

    def __init__(self, status=200, body=b"{}", error=None):
        self.status, self.body, self.error = status, body, error

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        if self.error is not None:
            raise self.error
        return self.body


class FetchEnvelope(unittest.TestCase):
    """_fetch_envelope：按顺序试镜像源，任一成功即返回，全失败才抛 ConfigError。"""

    def setUp(self):
        self.cfg = fc.FanVpnConfig(toy_pem(), urls=list(URLS), timeout=2.5)
        self.calls = []

    def fetch(self, plan, cfg=None):
        def urlopen(request, timeout=None, context=None):
            self.calls.append({"url": request.full_url, "ua": request.get_header("User-agent"),
                               "cache": request.get_header("Cache-control"), "timeout": timeout, "context": context})
            outcome = plan[request.full_url]
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        with mock.patch.object(fc.urllib.request, "urlopen", urlopen):
            return (cfg or self.cfg)._fetch_envelope()

    def test_first_mirror_wins_and_sends_extension_headers(self):
        self.assertEqual(self.fetch({URLS[0]: FakeResponse(body=b'{"key": "k"}')}), {"key": "k"})
        self.assertEqual(len(self.calls), 1)
        call = self.calls[0]
        self.assertEqual((call["ua"], call["cache"], call["timeout"]), ("FanVpnWebView2/1.0", "no-cache", 2.5))
        self.assertIsInstance(call["context"], ssl.SSLContext)

    def test_falls_back_in_order(self):
        plan = {URLS[0]: urllib.error.URLError("down"), URLS[1]: FakeResponse(status=503),
                URLS[2]: FakeResponse(body='{"节点": 1}'.encode("utf-8"))}
        self.assertEqual(self.fetch(plan), {"节点": 1})
        self.assertEqual([c["url"] for c in self.calls], list(URLS))

    def test_status_boundaries(self):
        for status, ok in ((199, False), (200, True), (299, True), (300, False), (404, False)):
            with self.subTest(status=status):
                cfg = fc.FanVpnConfig(toy_pem(), urls=(URLS[0],))
                plan = {URLS[0]: FakeResponse(status=status, body=b'{"a": 1}')}
                if ok:
                    self.assertEqual(self.fetch(plan, cfg), {"a": 1})
                else:
                    with self.assertRaisesRegex(fc.ConfigError, f"HTTP {status}"):
                        self.fetch(plan, cfg)

    def test_bad_bodies_are_skipped_and_reported_in_order(self):
        plan = {URLS[0]: FakeResponse(body=b"[1, 2]"), URLS[1]: FakeResponse(body=b"not json"),
                URLS[2]: FakeResponse(body=b"\xff\xfe")}
        with self.assertRaises(fc.ConfigError) as ctx:
            self.fetch(plan)
        message = str(ctx.exception)
        self.assertTrue(message.startswith("所有配置源均失败: "))
        self.assertIn(f"{URLS[0]} -> 非 JSON 对象", message)
        self.assertLess(message.index(URLS[0]), message.index(URLS[1]))
        self.assertLess(message.index(URLS[1]), message.index(URLS[2]))

    def test_oserror_family_falls_back(self):
        # RemoteDisconnected 是 ConnectionResetError 的子类，属于 OSError，能被兜住
        plan = {URLS[0]: TimeoutError("timed out"), URLS[1]: FakeResponse(error=http.client.RemoteDisconnected("closed")),
                URLS[2]: FakeResponse(body=b'{"ok": true}')}
        self.assertEqual(self.fetch(plan), {"ok": True})

    def test_no_mirrors(self):
        cfg = fc.FanVpnConfig(toy_pem(), urls=())
        with self.assertRaises(fc.ConfigError) as ctx:
            self.fetch({}, cfg)
        self.assertEqual(str(ctx.exception), "所有配置源均失败: ")

    @unittest.expectedFailure
    def test_http_protocol_error_should_fall_back(self):
        # 真 bug：http.client.HTTPException（IncompleteRead / BadStatusLine / LineTooLong）不是 OSError，
        # urllib 也不会把它包成 URLError，于是不在 except 元组里：一个镜像回了截断/畸形响应，
        # 就直接抛出去，不再试下一个镜像；fanvpn_service._boot 只接 ConfigError，整个服务启动失败。
        plan = {URLS[0]: FakeResponse(error=http.client.IncompleteRead(b'{"k', 10)), URLS[1]: FakeResponse(body=b'{"ok": 1}')}
        self.assertEqual(self.fetch(plan), {"ok": 1})


class Decrypt(unittest.TestCase):
    def test_constructor_parses_key_for_decrypt(self):
        cfg = fc.FanVpnConfig(toy_pem())
        with mock.patch.object(fc, "decrypt_envelope", return_value={"nodes": []}) as decrypt:
            self.assertEqual(cfg._decrypt({"key": "k"}), {"nodes": []})
        decrypt.assert_called_once_with({"key": "k"}, N, E, D)

    def test_decrypt_error_becomes_config_error(self):
        cfg = fc.FanVpnConfig(toy_pem())
        error = fc.DecryptError("坏密文")
        with mock.patch.object(fc, "decrypt_envelope", side_effect=error):
            with self.assertRaisesRegex(fc.ConfigError, "坏密文") as ctx:
                cfg._decrypt({})
        self.assertIs(ctx.exception.__cause__, error)

    def test_bad_pem_raises_decrypt_error_from_constructor(self):
        for pem in ("", "not a pem", "-----BEGIN X-----\n-----END X-----\n"):
            with self.subTest(pem=pem):
                with self.assertRaises(fc.DecryptError) as ctx:
                    fc.FanVpnConfig(pem)
                self.assertNotIsInstance(ctx.exception, fc.ConfigError)


class Load(unittest.TestCase):
    """load：解密结果清洗成 Node 列表，CACHE_TTL 内复用缓存。"""

    def setUp(self):
        self.cfg = fc.FanVpnConfig(toy_pem(), urls=URLS)
        self.fetch = mock.patch.object(self.cfg, "_fetch_envelope", return_value={"envelope": 1}).start()
        self.decrypt = mock.patch.object(fc, "decrypt_envelope").start()
        self.clock = mock.patch.object(fc, "time").start()
        self.addCleanup(mock.patch.stopall)
        self.clock.time.return_value = 1000.0
        self.good = {"nodes": [{"name": "美国", "server": "us.example", "port": 443}], "extra": {"a": 1}}

    def test_normalizes_and_skips_malformed_entries(self):
        self.decrypt.return_value = {"nodes": [
            {"name": "美国", "server": "us.example", "port": 443, "flag": "US"},
            {"server": "jp.example", "port": "8443", "flag": "JP"},  # 缺 name 用 server，端口字符串转 int
            {"name": "", "server": "sg.example", "port": 1, "flag": ""},  # 空 name / 空 flag 走默认
            {"name": "缺服务器", "port": 443},  # KeyError：跳过
            {"name": "坏端口", "server": "x.example", "port": "abc"},  # ValueError：跳过
            {"name": "空端口", "server": "y.example", "port": None},  # TypeError：跳过
            {"name": 7, "server": "hk.example", "port": 443.9, "flag": None},  # 非字符串转 str，浮点端口截断
        ]}
        self.assertEqual(self.cfg.load(), [
            fc.Node("美国", "us.example", 443, "US"), fc.Node("jp.example", "jp.example", 8443, "JP"),
            fc.Node("sg.example", "sg.example", 1, "US"), fc.Node("7", "hk.example", 443, "US"),
        ])
        self.decrypt.assert_called_once_with({"envelope": 1}, N, E, D)

    def test_returns_copies(self):
        self.decrypt.return_value = self.good
        self.cfg.load().clear()
        self.assertEqual(len(self.cfg.load()), 1)
        raw = self.cfg.raw()
        raw["nodes"] = "被改"
        self.assertEqual(self.cfg.raw(), self.good)
        self.assertEqual(self.fetch.call_count, 1)

    def test_no_valid_nodes(self):
        for raw in ({"nodes": []}, {"nodes": None}, {}, {"nodes": [{"port": 1}, {"server": "a", "port": "x"}]}):
            with self.subTest(raw=raw):
                self.decrypt.return_value = raw
                with self.assertRaisesRegex(fc.ConfigError, "没有任何有效节点"):
                    self.cfg.load(force=True)

    def test_failed_refresh_keeps_previous_cache(self):
        self.decrypt.return_value = self.good
        first = self.cfg.load()
        self.decrypt.return_value = {"nodes": []}
        with self.assertRaises(fc.ConfigError):
            self.cfg.load(force=True)
        self.assertEqual(self.cfg.load(), first)
        self.assertEqual(self.cfg.raw(), self.good)

    def test_cache_ttl_boundary_and_force(self):
        self.decrypt.return_value = self.good
        self.cfg.load()
        self.clock.time.return_value = 1000.0 + fc.CACHE_TTL - 0.001
        self.cfg.load()
        self.assertEqual(self.fetch.call_count, 1)
        self.cfg.load(force=True)
        self.assertEqual(self.fetch.call_count, 2)
        # force 刷新会重置时间戳：从新时间戳起再满 TTL（不是严格小于）才重拉
        self.clock.time.return_value = 1000.0 + fc.CACHE_TTL - 0.001 + fc.CACHE_TTL
        self.cfg.load()
        self.assertEqual(self.fetch.call_count, 3)

    def test_empty_cache_always_fetches_and_errors_propagate(self):
        self.fetch.side_effect = fc.ConfigError("所有配置源均失败: x")
        for _ in range(2):
            with self.assertRaisesRegex(fc.ConfigError, "所有配置源均失败"):
                self.cfg.load()
        self.assertEqual(self.fetch.call_count, 2)
        self.decrypt.assert_not_called()

    @unittest.expectedFailure
    def test_non_dict_entry_should_be_skipped(self):
        # 真 bug：注释写着「单条畸形数据跳过，不影响整体」，但非 dict 条目在 item.get 处抛 AttributeError，
        # 不在 except (KeyError, TypeError, ValueError) 里，整次 load 失败而不是跳过这一条。
        self.decrypt.return_value = {"nodes": ["坏条目", {"server": "a.example", "port": 1}]}
        self.assertEqual(self.cfg.load(), [fc.Node("a.example", "a.example", 1)])


class NodeTests(unittest.TestCase):
    def test_label_and_dict(self):
        node = fc.Node("美国", "us.example", 443)
        self.assertEqual(node.label, "美国 (us.example:443)")
        self.assertEqual(node.to_dict(), {"name": "美国", "server": "us.example", "port": 443, "flag": "US"})
        # 边界：IPv6 地址原样拼接，不加方括号
        self.assertEqual(fc.Node("v6", "::1", 443).label, "v6 (::1:443)")

    def test_frozen_and_hashable(self):
        node = fc.Node("a", "a.example", 1)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            node.port = 2
        self.assertEqual(len({node, fc.Node("a", "a.example", 1), fc.Node("a", "a.example", 1, "JP")}), 2)


class FakeContext:
    """假 SSLContext：记录 wrap_socket 当时的校验设置，可让握手抛错。"""

    def __init__(self, error=None):
        self.check_hostname, self.verify_mode, self.error, self.wrapped = True, ssl.CERT_REQUIRED, error, []

    def wrap_socket(self, sock, server_hostname=None):
        self.wrapped.append((sock, server_hostname, self.check_hostname, self.verify_mode))
        if self.error is not None:
            raise self.error
        return contextlib.nullcontext(sock)


class ProbeNode(unittest.TestCase):
    node = fc.Node("美国", "us.example", 443)

    def probe(self, connect_error=None, ctx=None, clock=(10.0, 10.25), **kwargs):
        ctx = ctx or FakeContext()
        connect = mock.Mock(return_value=contextlib.nullcontext("sock"), side_effect=connect_error)
        with mock.patch.object(fc.socket, "create_connection", connect), \
                mock.patch.object(fc.ssl, "create_default_context", return_value=ctx), \
                mock.patch.object(fc, "time") as clock_mock:
            clock_mock.monotonic.side_effect = list(clock)
            return fc.probe_node(self.node, **kwargs), connect, ctx

    def test_ok_reports_milliseconds_without_cert_checks(self):
        result, connect, ctx = self.probe()
        self.assertEqual(result, {"server": "us.example", "status": "ok", "ms": 250})
        connect.assert_called_once_with(("us.example", 443), timeout=5.0)
        self.assertEqual(ctx.wrapped, [("sock", "us.example", False, ssl.CERT_NONE)])

    def test_custom_timeout_and_zero_elapsed(self):
        result, connect, _ = self.probe(clock=(3.0, 3.0), timeout=0.5)
        self.assertEqual(result, {"server": "us.example", "status": "ok", "ms": 0})
        connect.assert_called_once_with(("us.example", 443), timeout=0.5)

    def test_connect_and_tls_failures_become_fail_status(self):
        cases = {"refused": (ConnectionRefusedError(111, "refused"), None), "timeout": (TimeoutError("timed out"), None),
                 "tls": (None, FakeContext(error=ssl.SSLError("handshake failed")))}
        for label, (connect_error, ctx) in cases.items():
            with self.subTest(label):
                result, _, _ = self.probe(connect_error=connect_error, ctx=ctx)
                self.assertEqual((result["server"], result["status"], result["ms"]), ("us.example", "fail", 0))
                self.assertTrue(result["error"])
        result, _, ctx = self.probe(connect_error=ConnectionRefusedError(111, "refused"))
        self.assertEqual(result["error"], "[Errno 111] refused")
        self.assertEqual(ctx.wrapped, [])

    def test_error_text_truncated_to_120(self):
        result, _, _ = self.probe(connect_error=OSError("x" * 500))
        self.assertEqual(result["error"], "x" * 120)

    @unittest.expectedFailure
    def test_bad_hostname_should_fail_softly(self):
        # 真 bug：服务器名来自远端解密的配置；某段标签超过 63 字符时，socket 在 IDNA 编码处抛
        # UnicodeEncodeError（Python 3.13 实测，属于 ValueError 而不是 OSError），probe_node 没兜住，
        # 异常一路抛出，fanvpn_service 里 pool.map(probe_node, ...) 整批测速失败。
        error = UnicodeEncodeError("idna", "a" * 64, 0, 64, "label too long")
        result, _, _ = self.probe(connect_error=error)
        self.assertEqual(result["status"], "fail")


if __name__ == "__main__":
    unittest.main()
