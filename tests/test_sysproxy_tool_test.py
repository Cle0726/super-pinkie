"""tools/test_sysproxy.py 的接入与补充单测。

tools/test_sysproxy.py 本身就是 app/fanvpn/win_sysproxy.py 的 unittest 手动脚本（在 tools/ 下
`python3 -m unittest test_sysproxy -v`），里面没有可复用的纯函数；但 CI 只发现 tests/*_test.py，
所以它的 19 个用例从没在 CI 里跑过。这里做两件事：

1. 把它原样接进 tests/ 的发现规则（load_tests），用例一个不改；
2. 补它没覆盖到的 win_sysproxy 纯逻辑：环回判断、快照序列化、disable、平台分支、存盘路径。

加载时不让它往 sys.path 里永久塞 app/ 和 app/fanvpn：app/windows_*.py 是「顶层导入优先」，
app/ 留在 sys.path 上会让后面的测试拿到同一模块的第二份副本。注册表一律用 JsonFileBackend +
临时目录，notify 一律关掉或把平台换成假的 —— 不碰真实注册表 / WinINET / 用户目录。
"""
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "test_sysproxy.py"
SOURCE = ROOT / "app" / "fanvpn" / "win_sysproxy.py"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclass 解析注解时要在 sys.modules 里找到自己
    spec.loader.exec_module(module)
    return module


wsp = _load("win_sysproxy_under_test", SOURCE)


def _load_tool():
    """执行 tools/test_sysproxy.py：它的 `from win_sysproxy import ...` 拿到上面那份模块，
    它对 sys.path 的改动执行完就撤掉。"""
    saved_path, saved_mod = list(sys.path), sys.modules.get("win_sysproxy")
    sys.modules["win_sysproxy"] = wsp
    try:
        return _load("tools_test_sysproxy_under_test", TOOL)
    finally:
        sys.path[:] = saved_path
        if saved_mod is None:
            sys.modules.pop("win_sysproxy", None)
        else:
            sys.modules["win_sysproxy"] = saved_mod


# 只比较加载前后，不看全局 sys.path：全量发现时别的测试也可能往里加 app/。
_BEFORE = (list(sys.path), sys.modules.get("win_sysproxy"))
tool = _load_tool()
_AFTER = (list(sys.path), sys.modules.get("win_sysproxy"))


def load_tests(loader, tests, pattern):
    """本文件的用例 + tools/test_sysproxy.py 的全部用例。"""
    tests.addTests(loader.loadTestsFromModule(tool))
    return tests


class ToolBridgeTest(unittest.TestCase):
    def test_tool_uses_this_module_and_leaves_sys_path_alone(self):
        self.assertIs(tool.SystemProxyManager, wsp.SystemProxyManager)
        # 加载 tools/test_sysproxy.py 前后 sys.path 与 sys.modules["win_sysproxy"] 都原样不动
        self.assertEqual(_AFTER[0], _BEFORE[0])
        self.assertIs(_AFTER[1], _BEFORE[1])
        cases = unittest.defaultTestLoader.loadTestsFromModule(tool).countTestCases()
        self.assertEqual(cases, 19)  # 用例数变了说明 tools/test_sysproxy.py 改过，这里跟着核对


class LoopbackTest(unittest.TestCase):
    def test_endpoint_forms(self):
        loopback = wsp._is_loopback_endpoint
        for value in ("127.0.0.1:10809", "localhost:8080", "LOCALHOST:1", "[::1]:10809", "0.0.0.0:1",
                      "127.0.0.1", "localhost", " 127.0.0.1 : 10809 ",
                      "http=127.0.0.1:10809;https=127.0.0.1:10809", "socks=localhost:1080;"):
            self.assertTrue(loopback(value), value)
        for value in ("", ";", "10.0.0.1:8080", "proxy.corp:8080", "http=corp:80;https=corp:443",
                      "127.0.0.1.evil.com:80", "127.0.0.2:10809"):
            self.assertFalse(loopback(value), value)

    def test_any_loopback_part_counts(self):
        # 分协议写法里只要有一段指回本机就算：这是现有语义，记下来免得被悄悄改掉。
        self.assertTrue(wsp._is_loopback_endpoint("http=corp:80;https=127.0.0.1:10809"))

    def test_pac_url_forms(self):
        loopback = wsp._is_loopback_url
        for url in (wsp.pac_url_for(10810), "HTTP://LOCALHOST:1/proxy.pac", "http://[::1]:1/p.pac",
                    "127.0.0.1:10810/proxy.pac"):
            self.assertTrue(loopback(url), url)
        for url in ("http://corp.example/proxy.pac", "http://127.0.0.1.evil.com/proxy.pac",
                    "http://evil.com/127.0.0.1/proxy.pac", "file:///C:/proxy.pac", "", "http://[::1/p.pac"):
            self.assertFalse(loopback(url), url)


class ManagerExtraTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.backend = wsp.JsonFileBackend(Path(self.tmp.name) / "reg.json")
        self.mgr = wsp.SystemProxyManager(backend=self.backend, notify=False)

    def tearDown(self):
        self.tmp.cleanup()

    def test_disable_turns_both_modes_off_and_is_not_managed(self):
        self.mgr.apply_direct(wsp.proxy_server_for(10809))
        self.mgr.disable()
        cur = self.mgr.current()
        self.assertEqual((cur["ProxyEnable"], cur["AutoConfigURL"]), (0, ""))
        self.assertEqual(cur["ProxyServer"], "127.0.0.1:10809")  # 只关不删，还原交给 restore
        self.assertFalse(self.mgr.is_managed())

    def test_apply_pac_writes_dword_and_string_types(self):
        self.mgr.apply_pac(wsp.pac_url_for(10810), override="localhost")
        read = lambda name: self.backend.read(wsp.INTERNET_SETTINGS, name)
        self.assertEqual(read("ProxyEnable"), (wsp.REG_DWORD, 0))
        self.assertEqual(read("AutoDetect"), (wsp.REG_DWORD, 0))
        self.assertEqual(read("ProxyOverride"), (wsp.REG_SZ, "localhost"))
        self.assertEqual(read("AutoConfigURL"), (wsp.REG_SZ, "http://127.0.0.1:10810/proxy.pac"))

    def test_values_outside_the_managed_five_are_untouched(self):
        self.backend.write(wsp.INTERNET_SETTINGS, "MigrateProxy", wsp.REG_DWORD, 1)
        snap = self.mgr.snapshot()
        self.assertNotIn("MigrateProxy", snap.values)
        self.mgr.apply_pac(wsp.pac_url_for(10810))
        self.mgr.restore(snap)
        self.assertEqual(self.backend.read(wsp.INTERNET_SETTINGS, "MigrateProxy"), (wsp.REG_DWORD, 1))

    def test_custom_key_path(self):
        mgr = wsp.SystemProxyManager(backend=self.backend, key_path="Other", notify=False)
        mgr.apply_direct("127.0.0.1:1")
        self.assertIsNone(self.backend.read(wsp.INTERNET_SETTINGS, "ProxyServer"))
        self.assertEqual(self.backend.read("Other", "ProxyServer"), (wsp.REG_SZ, "127.0.0.1:1"))

    def test_notify_only_on_windows(self):
        fake_linux = types.SimpleNamespace(platform="linux")
        with mock.patch.object(wsp, "sys", fake_linux):
            self.assertFalse(wsp.SystemProxyManager(backend=self.backend, notify=True).notify)
            self.assertFalse(wsp.refresh_wininet())  # 非 Windows 直接返回，不碰 ctypes.WinDLL
        with mock.patch.object(wsp, "sys", types.SimpleNamespace(platform="win32")):
            self.assertTrue(wsp.SystemProxyManager(backend=self.backend, notify=True).notify)
            self.assertFalse(wsp.SystemProxyManager(backend=self.backend, notify=False).notify)


class SnapshotFormatTest(unittest.TestCase):
    def test_json_roundtrip_and_missing(self):
        snap = wsp.ProxySnapshot(values={"ProxyServer": [1, "代理:1"]}, platform="win32", created_at=1.5)
        text = snap.to_json()
        self.assertIn("代理", text)  # ensure_ascii=False
        back = wsp.ProxySnapshot.from_json(text)
        self.assertEqual((back.values, back.platform, back.created_at), (snap.values, "win32", 1.5))
        self.assertEqual(back.missing(), ["ProxyEnable", "ProxyOverride", "AutoConfigURL", "AutoDetect"])

    def test_from_json_fills_defaults(self):
        back = wsp.ProxySnapshot.from_json('{"values": null, "platform": null}')
        self.assertEqual((back.values, back.platform, back.created_at), ({}, "", 0.0))

    def test_bad_created_at_is_treated_as_corrupt(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "backup.json"
            path.write_text(json.dumps({"values": {}, "created_at": "yesterday"}), encoding="utf-8")
            with self.assertLogs("win_sysproxy", "WARNING"):
                self.assertIsNone(wsp.SnapshotStore(path).load())

    @unittest.expectedFailure
    def test_valid_json_that_is_not_an_object_is_treated_as_corrupt(self):
        """源码 bug：备份文件是合法 JSON 但不是对象（如 `[]`）时，from_json 里 raw.get 抛
        AttributeError，SnapshotStore.load 只接 ValueError / OSError，于是直接崩，而不是像别的
        坏文件那样返回 None。"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "backup.json"
            path.write_text("[]", encoding="utf-8")
            self.assertIsNone(wsp.SnapshotStore(path).load())

    def test_clear_without_file_is_quiet(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = wsp.SnapshotStore(Path(tmp) / "none.json")
            store.clear()
            self.assertIsNone(store.load())


class PlatformPathTest(unittest.TestCase):
    def test_state_dir_per_platform(self):
        with mock.patch.object(wsp, "sys", types.SimpleNamespace(platform="win32")), \
                mock.patch.dict(wsp.os.environ, {"LOCALAPPDATA": "/fake/local"}):
            self.assertEqual(wsp.default_state_dir(), Path("/fake/local") / "FanVPN")
            self.assertEqual(wsp.SnapshotStore().path, Path("/fake/local") / "FanVPN" / "sysproxy_backup.json")
        with mock.patch.object(wsp, "sys", types.SimpleNamespace(platform="darwin")), \
                mock.patch.object(wsp.Path, "home", return_value=Path("/fake/home")):
            self.assertEqual(wsp.default_state_dir(), Path("/fake/home") / ".fanvpn-bridge")

    def test_make_backend_off_windows_is_a_file_in_the_state_dir(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(wsp, "sys", types.SimpleNamespace(platform="linux")):
            backend = wsp.make_backend(Path(tmp))
            self.assertIsInstance(backend, wsp.JsonFileBackend)
            self.assertEqual(backend.path, Path(tmp) / "fake_registry.json")
            self.assertFalse(backend.path.exists())  # 只建对象，不落盘

    def test_corrupt_fake_registry_reads_as_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reg.json"
            path.write_text("{oops", encoding="utf-8")
            self.assertIsNone(wsp.JsonFileBackend(path).read(wsp.INTERNET_SETTINGS, "ProxyEnable"))


class PacExtraTest(unittest.TestCase):
    def test_default_rules_are_dotted_and_lowercase(self):
        for rule in wsp.BYPASS_SUFFIXES:
            self.assertTrue(rule.startswith(".") and rule == rule.lower(), rule)

    def test_blank_rules_are_dropped(self):
        pac = wsp.build_pac("127.0.0.1:1", [" .A.com ", "", "  ", ".b.cn"])
        self.assertIn('var RULES = ".a.com|.b.cn".split("|");', pac)
        self.assertIn('var PROXY = "PROXY 127.0.0.1:1; DIRECT";', pac)
        self.assertNotIn("__", pac)

    def test_suffix_match_edge_cases(self):
        match = wsp.pac_suffix_match
        self.assertTrue(match("", [".a.com"]))
        self.assertTrue(match(None, [".a.com"]))
        self.assertTrue(match("x.A.COM", [" .a.com "]))
        self.assertFalse(match("x.a.com", ["", "  "]))


if __name__ == "__main__":
    unittest.main()
