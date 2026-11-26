"""碧琪的浏览器（Windows）工具栏页面与空白页的纯逻辑契约测试。

inapp_browser_pages 只有两个 HTML 字符串：CHROME_HTML（工具栏 + 节点面板）和
START_HTML（新标签页）。这里不启动任何浏览器/WebView2，只把页面当文本解析，
核对它和宿主 inapp_browser_host.py、管理端 inapp_browser.py 之间的约定：
脚本引用的元素与图标都存在、双向消息类型对得上、读取的字段宿主确实会发、
节点操作管理端都认识、高度常量和 CSS 一致、夜间配色变量齐全、用户可控文本都经过转义。
"""

import ast
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP))
import inapp_browser_pages as pages  # noqa: E402

HOST_SOURCE = (APP / "inapp_browser_host.py").read_text(encoding="utf-8")
MANAGER_SOURCE = (APP / "inapp_browser.py").read_text(encoding="utf-8")
SUBS_SOURCE = (APP / "browser_vpn_subscription.py").read_text(encoding="utf-8")
SCRIPT = re.search(r"<script>(.*?)</script>", pages.CHROME_HTML, re.S).group(1)

VOID_TAGS = {"meta", "input", "br", "img", "link", "hr"}


def between(text, start, end):
    """取 start 与之后第一个 end 之间的源码片段；找不到就让测试直接报错。"""
    head = text.index(start)
    return text[head:text.index(end, head + len(start))]


def js_function(name):
    """按花括号配对取出工具栏脚本里某个具名函数的函数体。"""
    head = SCRIPT.index("function " + name + "(")
    pos = SCRIPT.index("{", head)
    depth = 0
    for index in range(pos, len(SCRIPT)):
        depth += {"{": 1, "}": -1}.get(SCRIPT[index], 0)
        if depth == 0:
            return SCRIPT[pos:index + 1]
    raise AssertionError("函数体没有闭合：" + name)


class Markup(HTMLParser):
    """收集 id 并检查非空元素的开闭配对（script/style 内容按 CDATA 处理）。"""

    def __init__(self):
        super().__init__()
        self.ids, self.stack, self.errors = [], [], []

    def _collect(self, attrs):
        self.ids.extend(value for key, value in attrs if key == "id")

    def handle_starttag(self, tag, attrs):
        self._collect(attrs)
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self._collect(attrs)

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f"多余或错位的 </{tag}>，栈顶为 {self.stack[-1:]}")
            return
        self.stack.pop()


def parse(html):
    parser = Markup()
    parser.feed(html)
    parser.close()
    return parser


def manager_texts():
    """管理端里所有字符串字面量；f-string 的插值统一替换成「节点A」。"""
    tree = ast.parse(MANAGER_SOURCE)
    # f-string 的字面片段本身也是 Constant 节点，单独收集会把半句话当成完整提示。
    pieces = {id(part) for node in ast.walk(tree) if isinstance(node, ast.JoinedStr) for part in node.values}
    texts = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            texts.append("".join(part.value if isinstance(part, ast.Constant) else "节点A" for part in node.values))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in pieces:
            texts.append(node.value)
    return texts


def flash_regexes():
    """工具栏用来判断「刚自动换了节点」的两条 JS 正则（语法与 Python re 兼容）。"""
    body = js_function("renderSheet")
    trigger = re.search(r"/([^/]+)/\.test\(vpn\.message\)", body).group(1)
    name = re.search(r"const m=/(.+?)/\.exec\(vpn\.message\)", body).group(1)
    return re.compile(trigger), re.compile(name)


class ModuleShapeTest(unittest.TestCase):
    def test_module_is_plain_constants_and_imports_without_windows(self):
        # 纯字符串模块：Linux/macOS 上也能直接导入，两种导入路径拿到同样内容。
        from app import inapp_browser_pages as packaged

        self.assertIsInstance(pages.CHROME_HTML, str)
        self.assertIsInstance(pages.START_HTML, str)
        self.assertEqual(packaged.CHROME_HTML, pages.CHROME_HTML)
        self.assertEqual(packaged.START_HTML, pages.START_HTML)

    def test_both_pages_declare_doctype_language_charset_and_color_scheme(self):
        for html in (pages.CHROME_HTML, pages.START_HTML):
            self.assertTrue(html.lstrip().lower().startswith("<!doctype html>"))
            self.assertIn('<html lang="zh-CN">', html)
            self.assertIn('<meta charset="utf-8">', html)
            self.assertIn('<meta name="color-scheme" content="light dark">', html)
            self.assertIn("prefers-color-scheme: dark".replace(": ", ":"), html.replace(": ", ":"))

    def test_markup_is_balanced_and_ids_are_unique(self):
        for label, html in (("CHROME_HTML", pages.CHROME_HTML), ("START_HTML", pages.START_HTML)):
            parser = parse(html)
            self.assertEqual(parser.errors, [], label)
            self.assertEqual(parser.stack, [], f"{label} 有未闭合元素")
            duplicates = sorted({i for i in parser.ids if parser.ids.count(i) > 1})
            self.assertEqual(duplicates, [], f"{label} 有重复 id")


class ChromeDomContractTest(unittest.TestCase):
    def test_every_element_the_script_looks_up_exists(self):
        # $('x') 拿到 null 后再 .onclick= 会让整段脚本中断，工具栏全部失灵。
        ids = set(parse(pages.CHROME_HTML).ids)
        wanted = set(re.findall(r"\$\('([\w-]+)'\)", SCRIPT))
        wanted |= set(re.findall(r"#([\w-]+)", ",".join(re.findall(r"closest\('([^']*)'\)", SCRIPT))))
        self.assertGreater(len(wanted), 20)
        self.assertEqual(sorted(wanted - ids), [])

    def test_every_icon_used_has_a_symbol(self):
        symbols = set(re.findall(r'<symbol id="i-([\w-]+)"', pages.CHROME_HTML))
        used = set(re.findall(r'href="#i-([\w-]+)"', pages.CHROME_HTML))
        for args in re.findall(r"\bicon\(([^)]*)\)", SCRIPT):
            used |= set(re.findall(r"'([\w-]+)'", args))
        # 动态切换的图标：锁/地球、停止/刷新、关闭标签页。
        self.assertTrue({"lock", "globe", "stop", "reload", "x"} <= used)
        self.assertEqual(sorted(used - symbols), [])

    def test_toolbar_height_constants_match_css_and_host_clamp(self):
        bar = int(re.search(r"#bar\{[^}]*?height:(\d+)px", pages.CHROME_HTML).group(1))
        tabs = int(re.search(r"#tabs\{[^}]*?height:(\d+)px", pages.CHROME_HTML).group(1))
        base, extra = map(int, re.search(r"const h=(\d+)\+\(body\.classList\.contains\('multi'\)\?(\d+):0\)", SCRIPT).groups())
        self.assertEqual((base, extra), (bar, tabs))
        # 节点面板和菜单背景图要从工具栏下沿开始，多标签时再让出标签行。
        self.assertEqual(int(re.search(r"#sheet\{[^}]*?inset:(\d+)px", pages.CHROME_HTML).group(1)), bar)
        self.assertEqual(int(re.search(r"body\.multi #sheet\{top:(\d+)px", pages.CHROME_HTML).group(1)), bar + tabs)
        self.assertEqual(int(re.search(r"#backdrop\{[^}]*?top:(\d+)px", pages.CHROME_HTML).group(1)), bar)
        self.assertEqual(int(re.search(r"body\.multi #backdrop\{top:(\d+)px", pages.CHROME_HTML).group(1)), bar + tabs)
        # 宿主把上报的设备像素高度夹在 [low, high]；常见缩放比下两种高度都不该被截断。
        low, high = map(int, re.search(r"max\((\d+), min\((\d+), int\(message\.get\(\"px\"\)", HOST_SOURCE).groups())
        for ratio in (1, 1.25, 1.5, 2, 2.5, 3):
            for css in (bar, bar + tabs):
                self.assertTrue(low <= round(css * ratio) <= high, (ratio, css))

    def test_dark_palette_overrides_every_light_variable(self):
        light = re.search(r":root\{(.*?)\}", pages.CHROME_HTML, re.S).group(1)
        dark = re.search(r"@media \(prefers-color-scheme: dark\)\{:root\{(.*?)\}\}", pages.CHROME_HTML, re.S).group(1)
        light_names = set(re.findall(r"(--[\w-]+):", light))
        self.assertGreater(len(light_names), 10)
        self.assertEqual(light_names, set(re.findall(r"(--[\w-]+):", dark)))
        used = set(re.findall(r"var\((--[\w-]+)", pages.CHROME_HTML))
        self.assertEqual(sorted(used - light_names), [])

    def test_present_menu_modes_are_the_host_window_modes(self):
        modes = ast.literal_eval(re.search(r"WINDOW_MODES = (\{[^}]*\})", HOST_SOURCE).group(1))
        self.assertEqual(set(re.findall(r'data-mode="(\w+)"', pages.CHROME_HTML)), modes)
        # 双击拖动条在 full / float 之间切换；renderBar 的默认值也要是宿主的初始模式。
        self.assertIn("mode:state.mode==='full'?'float':'full'", SCRIPT)
        self.assertIn("(state.mode||'float')", SCRIPT)
        self.assertIn('self.mode = "float"', HOST_SOURCE)


class MessageProtocolTest(unittest.TestCase):
    def setUp(self):
        self.handler = between(HOST_SOURCE, "def _chrome_message", "def _send_backdrop")
        self.host_kinds = set(re.findall(r'kind == "(\w+)"', self.handler))

    def test_every_message_the_chrome_sends_is_handled_by_the_host(self):
        sent = set(re.findall(r"post\(\{type:'(\w+)'", SCRIPT))
        # 刷新按钮按加载状态发 stop 或 reload。
        self.assertIn("post({type:t?.loading?'stop':'reload'})", SCRIPT)
        sent |= {"stop", "reload"}
        self.assertTrue({"hello", "navigate", "vpn", "height", "panel"} <= sent)
        self.assertEqual(sorted(sent - self.host_kinds), [])

    def test_message_fields_the_chrome_sends_are_the_ones_the_host_reads(self):
        checked = 0
        for kind, rest in re.findall(r"post\(\{type:'(\w+)',([^}]*)\}\)", SCRIPT):
            for key in re.findall(r"(?:^|,)\s*(\w+)\s*(?=[:,]|$)", rest):
                checked += 1
                self.assertIn(f'message.get("{key}"', self.handler, f"{kind}.{key}")
        self.assertGreaterEqual(checked, 8)

    def test_every_message_the_host_posts_is_handled_by_the_chrome(self):
        posted = set(re.findall(r'_post_chrome\(\{\s*"type":\s*"(\w+)"', HOST_SOURCE))
        self.assertTrue({"state", "vpn", "vpnReply", "backdrop"} <= posted)
        handled = set(re.findall(r"m\.type==='(\w+)'", SCRIPT))
        self.assertEqual(sorted(posted - handled), [])
        # vpnReply 靠 rid 找回等待中的 Promise：宿主原样带回 rid 和 reply。
        self.assertIn('{"type": "vpnReply", "rid": rid, "reply": reply}', HOST_SOURCE)
        self.assertIn("pending[m.rid]", SCRIPT)
        self.assertIn("m.reply", SCRIPT)

    def test_toolbar_state_fields_are_sent_by_the_host(self):
        sync = between(HOST_SOURCE, "def _sync_chrome", "def _chrome_message")
        sent = set(re.findall(r'"(\w+)":', sync))
        read = set(re.findall(r"\bstate\.(\w+)", SCRIPT))
        self.assertTrue({"tabs", "active", "canGoBack", "canGoForward", "mode"} <= read)
        self.assertEqual(sorted(read - sent), [])
        # 标签对象字段：只看 renderTabs / renderBar，那里的 t 才是标签。
        tab_fields = set(re.findall(r"\bt\??\.(\w+)", js_function("renderTabs") + js_function("renderBar")))
        self.assertTrue({"id", "title", "url", "loading"} <= tab_fields)
        self.assertEqual(sorted(tab_fields - sent), [])

    def test_node_sheet_fields_are_in_the_manager_state(self):
        state = between(MANAGER_SOURCE, "def state(self)", "def _note")
        keys = set(re.findall(r'"(\w+)":', state))
        # describe 可能是文件里最后一个函数，取到它的 return 语句为止。
        keys |= set(re.findall(r'"(\w+)":', between(SUBS_SOURCE, "def describe(", "}\n")))
        sheet = js_function("renderSheet")
        read = {
            "vpn": set(re.findall(r"\bvpn\.(\w+)", SCRIPT)),
            "订阅": set(re.findall(r"\bs\.(\w+)", sheet)),
            "节点": set(re.findall(r"\bn\.(\w+)", sheet + js_function("lat"))),
        }
        self.assertTrue({"enabled", "applied", "nodes", "subscriptions", "message"} <= read["vpn"])
        for label, fields in read.items():
            self.assertTrue(fields, label)
            self.assertEqual(sorted(fields - keys), [], label)

    def test_node_operations_from_the_sheet_are_known_to_the_manager(self):
        handler = between(MANAGER_SOURCE, "handler = {", "}.get(op)")
        known = set(re.findall(r'"(\w+)":', handler))
        used = set(re.findall(r"\bact\('(\w+)'", SCRIPT))
        self.assertTrue({"status", "add", "refresh", "remove", "select", "enable", "auto", "test", "open_ip_check"} <= used)
        self.assertEqual(sorted(used - known), [])
        # 面板的请求经宿主加上 vpn. 前缀转给管理端，管理端再去掉前缀。
        self.assertIn('self.upcall("vpn." + op', HOST_SOURCE)
        self.assertIn('if op.startswith("vpn."):', MANAGER_SOURCE)


class SafetyTest(unittest.TestCase):
    def test_escape_helper_covers_all_html_special_characters(self):
        esc = re.search(r"const esc=(.*?);\n", SCRIPT).group(1)
        self.assertIn("[&<>\"']", esc)
        for entity in ("'&amp;'", "'&lt;'", "'&gt;'", "'&quot;'", "'&#39;'"):
            self.assertIn(entity, esc)

    def test_user_controlled_text_goes_through_escape_in_inner_html(self):
        # 标签标题/网址来自网页，订阅名和节点名来自机场：拼进 innerHTML 前必须 esc()。
        # 拼接后紧跟 === / !== 的是比较（如 t.id===state.active），紧跟 ? 的是三元条件
        # （如 s.error?'…'+esc(s.error):''），都不是把值写进页面；?. 可选链照样算。
        risky = re.compile(r"\+\s*\(?\s*[tsn]\??\.(?:title|url|id|host|usage|error|name|type)\b(?!\s*(?:[=!]==|\?(?!\.)))")
        for name in ("renderTabs", "renderSheet"):
            body = js_function(name)
            self.assertIn("innerHTML", body)
            self.assertEqual(risky.findall(body), [], name)
        # 防止断言因为写法变了而变成空转。
        self.assertIn("esc(t.title", js_function("renderTabs"))
        self.assertIn("esc(n.name)", js_function("renderSheet"))
        self.assertIn("esc(s.title)", js_function("renderSheet"))

    def test_chrome_never_mentions_node_secrets(self):
        lowered = pages.CHROME_HTML.lower()
        for secret in ("password", "uuid", "secret", "token"):
            self.assertNotIn(secret, lowered)

    def test_start_page_is_static_and_matches_the_host_tab_title(self):
        self.assertNotIn("<script", pages.START_HTML.lower())
        title = re.search(r"<title>(.*?)</title>", pages.START_HTML).group(1)
        # 宿主给空白页标签起的名字、工具栏的兜底名都要和页面标题一致，否则标签名会跳。
        self.assertIn(f'tab.title = "{title}"', HOST_SOURCE)
        self.assertIn(f"esc(t.title||'{title}')", SCRIPT)
        self.assertIn("NavigateToString(self.pages.START_HTML)", HOST_SOURCE)
        self.assertIn("NavigateToString(self.pages.CHROME_HTML)", HOST_SOURCE)


class NodeSwitchFlashTest(unittest.TestCase):
    """管理端自动换节点后，工具栏节点按钮会闪 4.5 秒「已换到 X」。"""

    def test_flash_reads_the_node_name_from_real_switch_messages(self):
        trigger, name = flash_regexes()
        templates = [t for t in manager_texts() if "自动换到" in t and "「" in t]
        # 测速发现不通后自动换（test）和网页打不开后的切换（failover）两处。
        self.assertGreaterEqual(len(templates), 2)
        for text in templates:
            self.assertTrue(trigger.search(text), text)
            match = name.search(text)
            self.assertIsNotNone(match, text)
            self.assertEqual(match.group(1), "节点A", text)

    @unittest.expectedFailure
    def test_turning_auto_switch_on_does_not_flash_a_fake_switch(self):
        # 已知缺陷（未修）：set_auto(True) 的提示「已开启自动切换：当前节点不通时会自动换到最快的可用节点。」
        # 经 VpnService.handle -> _note 写进 vpn.message 推给工具栏；renderSheet 只用 /自动换到/ 判断，
        # 于是用户刚打开开关、什么都没换，节点按钮就闪「已换到 新节点」。修好后这里会变成 unexpected success，
        # 届时去掉 expectedFailure 即可。
        trigger, _ = flash_regexes()
        notices = [t for t in manager_texts() if "自动换到" in t and "「" not in t]
        self.assertTrue(notices)
        for text in notices:
            self.assertIsNone(trigger.search(text), text)


if __name__ == "__main__":
    unittest.main()
