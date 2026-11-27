"""app/fanvpn/win_sysproxy.py 的纯逻辑单测（补现有测试没覆盖的部分）。

分工：tools/test_sysproxy.py 测快照/还原、apply_pac/apply_direct、PAC 生成与后缀匹配；
#270 的 tests/test_sysproxy_tool_test.py 测环回判断、快照 JSON、disable、平台分支、
存盘路径、PAC 空规则。这里不重复那些，只补：
WinRegBackend（假 winreg 模块）与 Windows 上的后端选择、JsonFileBackend 写盘细节、
is_managed 边界、current 归一、每次修改都刷新、快照字段、存盘建父目录、
LOCALAPPDATA 缺失回退、PAC 与 local_proxy 分流表同源、端口转 int。
全部走临时目录与假对象，不碰真实注册表、系统代理和用户目录。
"""

import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

FANVPN = Path(__file__).resolve().parents[1] / "app" / "fanvpn"
if str(FANVPN) not in sys.path:
    sys.path.append(str(FANVPN))
import win_sysproxy as w  # noqa: E402

KEY = w.INTERNET_SETTINGS


def fake_winreg():
    """最小假 winreg：键不存在或值不存在都抛 OSError，与真实行为一致。"""
    store = {}
    mod = types.ModuleType("winreg")
    mod.HKEY_CURRENT_USER, mod.KEY_READ, mod.KEY_SET_VALUE = "HKCU", 1, 2
    mod.store, mod.calls = store, []

    class Handle:
        def __init__(self, root, path):
            self.bucket = store[(root, path)]

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def open_key(root, path, _reserved, access):
        mod.calls.append(("OpenKey", root, path, access))
        if (root, path) not in store:
            raise FileNotFoundError(path)
        return Handle(root, path)

    def create_key_ex(root, path, _reserved, access):
        mod.calls.append(("CreateKeyEx", root, path, access))
        store.setdefault((root, path), {})
        return Handle(root, path)

    def query_value_ex(handle, name):
        if name not in handle.bucket:
            raise FileNotFoundError(name)
        reg_type, value = handle.bucket[name]
        return value, reg_type

    def set_value_ex(handle, name, _reserved, reg_type, value):
        handle.bucket[name] = (reg_type, value)

    def delete_value(handle, name):
        if name not in handle.bucket:
            raise FileNotFoundError(name)
        del handle.bucket[name]

    mod.OpenKey, mod.CreateKeyEx = open_key, create_key_ex
    mod.QueryValueEx, mod.SetValueEx, mod.DeleteValue = query_value_ex, set_value_ex, delete_value
    return mod


class DictBackend(w.RegistryBackend):
    def __init__(self, **values):
        self.data = {name: list(entry) for name, entry in values.items()}

    def read(self, key_path, name):
        entry = self.data.get(name)
        return None if entry is None else (entry[0], entry[1])

    def write(self, key_path, name, reg_type, value):
        self.data[name] = [reg_type, value]

    def delete(self, key_path, name):
        self.data.pop(name, None)


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_base_backend_is_abstract(self):
        base = w.RegistryBackend()
        for call in (lambda: base.read(KEY, "x"), lambda: base.write(KEY, "x", 1, "v"),
                     lambda: base.delete(KEY, "x")):
            with self.assertRaises(NotImplementedError):
                call()

    def test_make_backend_on_windows_uses_winreg(self):
        reg = fake_winreg()
        with mock.patch.object(w.sys, "platform", "win32"), mock.patch.dict(sys.modules, {"winreg": reg}):
            backend = w.make_backend(self.root)
        self.assertIsInstance(backend, w.WinRegBackend)
        self.assertEqual(backend._root, "HKCU")

    def test_json_backend_write_details(self):
        path = self.root / "reg.json"
        path.write_text("{oops", encoding="utf-8")
        backend = w.JsonFileBackend(path)
        backend.delete(KEY, "ProxyEnable")  # 不存在的值删除不抛、不写盘
        self.assertEqual(path.read_text(encoding="utf-8"), "{oops")
        backend.write(KEY, "ProxyServer", w.REG_SZ, "代理")
        self.assertIn("代理", path.read_text(encoding="utf-8"))  # ensure_ascii=False
        backend.path = self.root / "new" / "sub" / "r.json"
        backend.write(KEY, "X", w.REG_DWORD, 1)  # 父目录不存在时自动建
        self.assertTrue(backend.path.is_file())

    @unittest.expectedFailure
    def test_json_backend_non_object_file_known_bug(self):
        """已知 bug：文件是合法 JSON 但不是对象（如 []）时 reload 原样收下，
        之后 read 抛 AttributeError；应当和损坏文件一样当成空注册表。"""
        path = self.root / "reg.json"
        path.write_text("[]", encoding="utf-8")
        self.assertIsNone(w.JsonFileBackend(path).read(KEY, "ProxyEnable"))

    def test_winreg_backend_roundtrip_with_fake_module(self):
        reg = fake_winreg()
        with mock.patch.dict(sys.modules, {"winreg": reg}):
            backend = w.WinRegBackend()
            self.assertIsNone(backend.read(KEY, "ProxyEnable"))  # 键都不存在
            backend.delete(KEY, "ProxyEnable")  # 键不存在时删除被吞掉
            backend.write(KEY, "ProxyEnable", w.REG_DWORD, 1)
            self.assertEqual(backend.read(KEY, "ProxyEnable"), (4, 1))
            self.assertIsNone(backend.read(KEY, "ProxyServer"))  # 键在、值不在
            backend.delete(KEY, "ProxyServer")
            backend.delete(KEY, "ProxyEnable")
            self.assertIsNone(backend.read(KEY, "ProxyEnable"))
        self.assertIn(("CreateKeyEx", "HKCU", KEY, reg.KEY_SET_VALUE), reg.calls)
        self.assertIn(("OpenKey", "HKCU", KEY, reg.KEY_READ), reg.calls)

    def test_winreg_backend_custom_root(self):
        reg = fake_winreg()
        with mock.patch.dict(sys.modules, {"winreg": reg}):
            backend = w.WinRegBackend(root="HKLM-test")
            backend.write(KEY, "AutoDetect", w.REG_DWORD, 0)
        self.assertIn(("HKLM-test", KEY), reg.store)
        self.assertNotIn(("HKCU", KEY), reg.store)


class ManagerTest(unittest.TestCase):
    def manager(self, **values):
        return w.SystemProxyManager(backend=DictBackend(**values), notify=False)

    def test_is_managed_edge_cases(self):
        self.assertFalse(self.manager().is_managed())
        # PAC 为空白串时按静态模式看；ProxyEnable 缺省视为 0
        self.assertFalse(self.manager(AutoConfigURL=[1, "  "], ProxyServer=[1, "127.0.0.1:1"]).is_managed())
        self.assertTrue(self.manager(AutoConfigURL=[1, ""], ProxyServer=[1, " 127.0.0.1:1 "],
                                     ProxyEnable=[4, 1]).is_managed())
        # 自家 PAC 优先：即使静态代理指向公司，也算我们接管
        self.assertTrue(self.manager(AutoConfigURL=[1, w.pac_url_for(1)], ProxyServer=[1, "corp:1"],
                                     ProxyEnable=[4, 1]).is_managed())
        self.assertFalse(self.manager(ProxyServer=[1, "corp:8080"], ProxyEnable=[4, 1]).is_managed())

    def test_current_normalises_missing_to_none(self):
        cur = self.manager(ProxyEnable=[4, 0]).current()
        self.assertEqual(list(cur), list(w.MANAGED_VALUES))
        self.assertEqual(cur["ProxyEnable"], 0)
        self.assertIsNone(cur["ProxyServer"])

    def test_disable_keeps_override_and_autodetect(self):
        mgr = self.manager(ProxyEnable=[4, 1], AutoConfigURL=[1, "x"], ProxyOverride=[1, "keep"])
        mgr.disable()
        cur = mgr.current()
        self.assertEqual(cur["ProxyOverride"], "keep")
        self.assertIsNone(cur["AutoDetect"])

    def test_refresh_called_once_per_change(self):
        with mock.patch.object(w.sys, "platform", "win32"):
            mgr = w.SystemProxyManager(backend=DictBackend())
            quiet = w.SystemProxyManager(backend=DictBackend(), notify=False)
        with mock.patch.object(w, "refresh_wininet") as refresh:
            mgr.apply_pac(w.pac_url_for(1))
            mgr.apply_direct(w.proxy_server_for(2))
            mgr.disable()
            mgr.restore(w.ProxySnapshot())
            self.assertEqual(refresh.call_count, 4)
            quiet.disable()
            self.assertEqual(refresh.call_count, 4)

    def test_snapshot_records_platform_and_time(self):
        snap = self.manager(ProxyEnable=[4, 1]).snapshot()
        self.assertEqual(snap.values, {"ProxyEnable": [4, 1]})
        self.assertEqual(snap.platform, sys.platform)
        self.assertGreater(snap.created_at, 0)
        self.assertEqual(len(snap.missing()), 4)


class SnapshotStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_windows_without_localappdata_falls_back_to_home(self):
        with mock.patch.object(w.Path, "home", return_value=self.root), \
                mock.patch.object(w.sys, "platform", "win32"), mock.patch.dict(os.environ, clear=True):
            self.assertEqual(w.default_state_dir(), self.root / "FanVPN")
        self.assertEqual(list(self.root.iterdir()), [])  # 只算路径，不建目录

    def test_save_creates_parents_and_clear_is_idempotent(self):
        store = w.SnapshotStore(self.root / "a" / "b" / "backup.json")
        self.assertIsNone(store.load())
        store.save(w.ProxySnapshot(values={"ProxyEnable": [4, 0]}))
        self.assertEqual(json.loads(store.path.read_text(encoding="utf-8"))["values"], {"ProxyEnable": [4, 0]})
        store.clear()
        store.clear()
        self.assertFalse(store.path.exists())

    @unittest.expectedFailure
    def test_values_not_object_returns_none_known_bug(self):
        """已知 bug：快照里 values 不是对象时，from_json 的 dict() 抛 TypeError，
        load 只接 ValueError/OSError，于是直接崩而不是返回 None。
        （顶层不是对象的 [] 走 AttributeError 分支，#270 已标出，这里不重复。）"""
        path = self.root / "b.json"
        path.write_text('{"values": [1, 2]}', encoding="utf-8")
        self.assertIsNone(w.SnapshotStore(path).load())


class PacExtraTest(unittest.TestCase):
    def test_default_pac_lists_every_suffix_and_matches_proxy_list(self):
        import local_proxy

        self.assertEqual(w.BYPASS_SUFFIXES, local_proxy.DEFAULT_BYPASS)  # 注释写明两处同源
        pac = w.build_pac(w.proxy_server_for(10809))
        for suffix in w.BYPASS_SUFFIXES:
            self.assertIn(suffix, pac)

    def test_endpoint_helpers_coerce_int(self):
        self.assertEqual(w.pac_url_for("10810"), "http://127.0.0.1:10810/proxy.pac")
        self.assertEqual(w.proxy_server_for("10809"), "127.0.0.1:10809")
        with self.assertRaises(ValueError):
            w.proxy_server_for("x")


if __name__ == "__main__":
    unittest.main(verbosity=2)
