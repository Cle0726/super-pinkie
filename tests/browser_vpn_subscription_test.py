import base64
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import browser_vpn_subscription as subs  # noqa: E402

VMESS = "vmess://" + base64.b64encode(json.dumps({
    "v": "2", "ps": "香港 01", "add": "hk.example.com", "port": "443", "id": "11111111-2222-3333-4444-555555555555",
    "aid": "0", "scy": "auto", "net": "ws", "type": "none", "host": "cdn.example.com", "path": "/ray", "tls": "tls", "sni": "cdn.example.com",
}, ensure_ascii=False).encode()).decode()
VLESS = ("vless://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@jp.example.com:443?encryption=none&security=reality&sni=www.apple.com"
         "&fp=chrome&pbk=PUBKEY&sid=abcd&type=grpc&serviceName=grpc&flow=xtls-rprx-vision#%E6%97%A5%E6%9C%AC%2002")
TROJAN = "trojan://p%40ss@us.example.com:8443?sni=us.example.com&allowInsecure=1#US%2003"
SS_SIP002 = "ss://" + base64.urlsafe_b64encode(b"aes-256-gcm:secret").decode().rstrip("=") + "@sg.example.com:8388#SG%2004"
SS_LEGACY = "ss://" + base64.b64encode(b"chacha20-ietf-poly1305:pw@tw.example.com:9000").decode() + "#TW"
HY2 = "hysteria2://hypass@hy.example.com:443,20000-30000/?sni=hy.example.com&insecure=1&obfs=salamander&obfs-password=ob#HY2%20%E8%8A%82%E7%82%B9"
HY2_SHORT = "hy2://pw2@hy2.example.com:8443?sni=a.com#short"

CLASH_BLOCK = """\
port: 7890
mixed-port: 7891
# a comment
proxies:
  - name: "🇭🇰 香港 A"
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: aes-128-gcm
    password: "123456"
    udp: true
  - name: 台湾 B # trailing comment
    type: vmess
    server: tw.example.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    alterId: 0
    cipher: auto
    tls: true
    network: ws
    ws-opts:
      path: /path
      headers:
        Host: cdn.example.com
  - {name: 美国 C, type: trojan, server: us.example.com, port: 443, password: 'pa:ss', sni: us.example.com, skip-cert-verify: false}
  - {name: 不支持, type: madeup, server: x.example.com, port: 1}
proxy-groups:
  - name: Proxy
    type: select
    proxies: [香港 A]
rules:
  - MATCH,Proxy
"""


class ParseLinksTest(unittest.TestCase):
    def test_base64_list_with_every_protocol(self):
        body = base64.b64encode("\n".join([VMESS, VLESS, TROJAN, SS_SIP002, SS_LEGACY, HY2, HY2_SHORT, "unknown://x"]).encode()).decode()
        nodes = subs.parse_subscription(body)
        self.assertEqual([n["type"] for n in nodes], ["vmess", "vless", "trojan", "ss", "ss", "hysteria2", "hysteria2"])
        vmess, vless, trojan, ss, legacy, hy2, short = nodes
        self.assertEqual(vmess["name"], "香港 01")
        self.assertEqual((vmess["server"], vmess["port"], vmess["network"], vmess["servername"]), ("hk.example.com", 443, "ws", "cdn.example.com"))
        self.assertEqual(vmess["ws-opts"], {"path": "/ray", "headers": {"Host": "cdn.example.com"}})
        self.assertTrue(vmess["tls"])
        self.assertEqual(vless["name"], "日本 02")
        self.assertEqual(vless["reality-opts"], {"public-key": "PUBKEY", "short-id": "abcd"})
        self.assertEqual((vless["network"], vless["grpc-opts"]["grpc-service-name"], vless["flow"]), ("grpc", "grpc", "xtls-rprx-vision"))
        self.assertEqual((trojan["password"], trojan["sni"], trojan["skip-cert-verify"]), ("p@ss", "us.example.com", True))
        self.assertEqual((ss["cipher"], ss["password"], ss["server"], ss["port"]), ("aes-256-gcm", "secret", "sg.example.com", 8388))
        self.assertEqual((legacy["cipher"], legacy["password"], legacy["server"], legacy["port"]), ("chacha20-ietf-poly1305", "pw", "tw.example.com", 9000))
        self.assertEqual((hy2["port"], hy2["obfs"], hy2["obfs-password"], hy2["name"]), (443, "salamander", "ob", "HY2 节点"))
        self.assertEqual((short["server"], short["port"], short["sni"]), ("hy2.example.com", 8443, "a.com"))

    def test_plain_links_and_urlsafe_base64(self):
        self.assertEqual(len(subs.parse_subscription(TROJAN + "\n" + HY2_SHORT)), 2)
        body = base64.urlsafe_b64encode((VLESS + "\n").encode()).decode().rstrip("=")
        self.assertEqual(subs.parse_subscription(body)[0]["type"], "vless")

    def test_duplicate_names_become_unique(self):
        nodes = subs.parse_subscription("\n".join([TROJAN, TROJAN, TROJAN]))
        self.assertEqual([n["name"] for n in nodes], ["US 03", "US 03 2", "US 03 3"])

    def test_broken_link_is_skipped_and_single_link_reports_clearly(self):
        nodes = subs.parse_subscription("vless://@nohost\n" + TROJAN)
        self.assertEqual(len(nodes), 1)
        with self.assertRaises(subs.SubscriptionError) as caught:
            subs.parse_link("vless://missing-port@host#x")
        self.assertIn("vless", str(caught.exception))

    def test_description_never_leaks_secrets(self):
        node = subs.parse_subscription(TROJAN)[0]
        self.assertEqual(set(subs.describe(node)), {"name", "type", "server", "port"})


class ClashYamlTest(unittest.TestCase):
    def check(self, nodes):
        self.assertEqual([n["name"] for n in nodes], ["🇭🇰 香港 A", "台湾 B", "美国 C"])
        ss, vmess, trojan = nodes
        self.assertEqual((ss["port"], ss["udp"], ss["password"]), (8388, True, "123456"))
        self.assertEqual(vmess["ws-opts"], {"path": "/path", "headers": {"Host": "cdn.example.com"}})
        self.assertEqual((trojan["password"], trojan["skip-cert-verify"]), ("pa:ss", False))

    def test_builtin_reader_handles_block_flow_quotes_and_comments(self):
        with mock.patch.dict(sys.modules, {"yaml": None}):
            self.check(subs.parse_subscription(CLASH_BLOCK))

    def test_pyyaml_when_available(self):
        try:
            import yaml  # noqa: F401
        except ImportError:
            self.skipTest("PyYAML not installed")
        self.check(subs.parse_subscription(CLASH_BLOCK))

    def test_base64_wrapped_clash(self):
        with mock.patch.dict(sys.modules, {"yaml": None}):
            self.check(subs.parse_subscription(base64.b64encode(CLASH_BLOCK.encode()).decode()))


class ErrorMessageTest(unittest.TestCase):
    def assertMessage(self, text, needle):
        with self.assertRaises(subs.SubscriptionError) as caught:
            subs.parse_subscription(text)
        self.assertIn(needle, str(caught.exception))

    def test_bad_bodies_say_what_is_wrong_in_chinese(self):
        self.assertMessage("", "空的")
        self.assertMessage("<!DOCTYPE html><html><body>login</body></html>", "网页")
        self.assertMessage("hello world, not a subscription", "看不懂")
        self.assertMessage("proxies:\n  - {name: x, type: madeup, server: a, port: 1}\n", "没有能用的节点")
        self.assertMessage(base64.b64encode(b"vmess://not-base64-json").decode(), "没有能用的节点")

    def test_fetch_errors(self):
        with self.assertRaises(subs.SubscriptionError) as caught:
            subs.fetch_subscription("ftp://example.com/sub")
        self.assertIn("http", str(caught.exception))

        def fail(code):
            def opener(request, timeout):
                raise urllib.error.HTTPError(request.full_url, code, "x", {}, io.BytesIO(b""))
            return opener

        for code, needle in ((403, "拒绝"), (404, "不存在"), (500, "出错")):
            with self.assertRaises(subs.SubscriptionError) as caught:
                subs.fetch_subscription("https://example.com/sub", opener=fail(code))
            self.assertIn(needle, str(caught.exception))

        def offline(request, timeout):
            raise urllib.error.URLError("getaddrinfo failed")

        with self.assertRaises(subs.SubscriptionError) as caught:
            subs.fetch_subscription("https://example.com/sub", opener=offline)
        self.assertIn("连不上", str(caught.exception))

    def test_fetch_reads_body_and_headers(self):
        class Response(io.BytesIO):
            headers = {"Subscription-Userinfo": "upload=1; download=2; total=1073741824; expire=1893456000",
                       "Content-Disposition": "attachment; filename*=UTF-8''%E6%88%91%E7%9A%84%E6%9C%BA%E5%9C%BA"}

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        text, headers = subs.fetch_subscription("https://example.com/sub", opener=lambda r, timeout: Response(TROJAN.encode()))
        self.assertEqual(text, TROJAN)
        self.assertEqual(subs.subscription_title(headers, "https://example.com/sub"), "我的机场")
        self.assertEqual(subs.parse_userinfo(headers["subscription-userinfo"])["total"], 1073741824)


if __name__ == "__main__":
    unittest.main()
