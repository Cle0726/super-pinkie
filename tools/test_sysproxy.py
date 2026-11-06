"""win_sysproxy 的真实单测：不需要 Windows，也不需要第三方库。

跑：
    python3 -m unittest test_sysproxy -v
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

# 测试要 import app/fanvpn 下的扁平模块（local_proxy / win_sysproxy ...）
_APP = _Path(__file__).resolve().parent.parent / "app"
for _p in (_APP / "fanvpn", _APP):
    if str(_p) not in _sys.path:
        _sys.path.insert(0, str(_p))


import json
import tempfile
import unittest
from pathlib import Path

from win_sysproxy import (
    DEFAULT_OVERRIDE,
    INTERNET_SETTINGS,
    JsonFileBackend,
    ProxySnapshot,
    SnapshotStore,
    SystemProxyManager,
    build_pac,
    pac_suffix_match,
    pac_url_for,
    proxy_server_for,
)


class TestSnapshotRestore(unittest.TestCase):
    """核心契约：改完之后必须能逐字节回到用户原来的状态。"""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.backend = JsonFileBackend(self.root / "reg.json")
        self.mgr = SystemProxyManager(backend=self.backend, notify=False)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_empty_registry_restores_to_empty(self):
        """原本什么都没有 -> 还原后仍然什么都没有（不是写一堆空串）。"""
        snap = self.mgr.snapshot()
        self.assertEqual(snap.values, {})
        self.assertEqual(len(snap.missing()), 5)

        self.mgr.apply_pac(pac_url_for(10810))
        self.assertNotEqual(self.mgr.current()["AutoConfigURL"], None)

        self.mgr.restore(snap)
        for name in ("ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL", "AutoDetect"):
            self.assertIsNone(self.backend.read(INTERNET_SETTINGS, name), name)

    def test_preserves_existing_user_proxy(self):
        """用户本来在跑 Clash：接管后还原必须回到 Clash，不能被吞掉。"""
        self.backend.write(INTERNET_SETTINGS, "ProxyEnable", 4, 1)
        self.backend.write(INTERNET_SETTINGS, "ProxyServer", 1, "127.0.0.1:7890")
        self.backend.write(INTERNET_SETTINGS, "ProxyOverride", 1, "localhost")

        snap = self.mgr.snapshot()
        self.mgr.apply_pac("http://127.0.0.1:10810/proxy.pac")
        cur = self.mgr.current()
        self.assertEqual(cur["ProxyEnable"], 0)
        self.assertTrue(str(cur["AutoConfigURL"]).endswith("/proxy.pac"))

        self.mgr.restore(snap)
        cur = self.mgr.current()
        self.assertEqual(cur["ProxyServer"], "127.0.0.1:7890")
        self.assertEqual(cur["ProxyEnable"], 1)
        self.assertEqual(cur["ProxyOverride"], "localhost")
        # 原本不存在的 AutoConfigURL 必须被删掉
        self.assertIsNone(cur["AutoConfigURL"])

    def test_restore_keeps_registry_types(self):
        """DWORD 还原成 DWORD，不能被写成字符串 —— 否则 WinINET 不认。"""
        self.backend.write(INTERNET_SETTINGS, "ProxyEnable", 4, 0)
        snap = self.mgr.snapshot()
        self.mgr.apply_direct("127.0.0.1:10809")
        self.mgr.restore(snap)
        entry = self.backend.read(INTERNET_SETTINGS, "ProxyEnable")
        assert entry is not None
        self.assertEqual(entry[0], 4)
        self.assertEqual(entry[1], 0)

    def test_apply_direct_sets_static_proxy(self):
        self.mgr.apply_direct(proxy_server_for(10809))
        cur = self.mgr.current()
        self.assertEqual(cur["ProxyEnable"], 1)
        self.assertEqual(cur["ProxyServer"], "127.0.0.1:10809")
        self.assertEqual(cur["AutoConfigURL"], "")
        self.assertIn("<local>", cur["ProxyOverride"])
        self.assertEqual(cur["ProxyOverride"], DEFAULT_OVERRIDE)

    def test_is_managed_detects_own_state(self):
        self.assertFalse(self.mgr.is_managed())
        self.mgr.apply_pac(pac_url_for(10810))
        self.assertTrue(self.mgr.is_managed())
        self.backend.write(INTERNET_SETTINGS, "AutoConfigURL", 1, "http://corp/proxy.pac")
        self.assertFalse(self.mgr.is_managed())

    def test_foreign_pac_after_own_pac_is_not_managed(self):
        """真 Windows CI 上撞到的 bug。

        apply_pac 会把 ProxyServer 写成环回值（作为兜底），如果
        is_managed 只要「任一字段是环回」就返回 True，那么用户把 PAC
        改成公司地址后仍会被误判成自家配置 —— 卸载时吞掉公司代理。

        正确行为：有 PAC 就以 PAC 为准，ProxyServer 只是残留。
        """
        self.mgr.apply_pac(pac_url_for(10810))
        # 此刻 ProxyServer 是环回残留
        self.assertEqual(self.mgr.current()["ProxyServer"], "")
        self.backend.write(INTERNET_SETTINGS, "ProxyServer", 1, "127.0.0.1:10809")
        self.assertTrue(self.mgr.is_managed(), "自家的 PAC 仍应认出来")

        # 公司 PAC 接管后，残留的环回 ProxyServer 不能让它继续算自家
        self.backend.write(INTERNET_SETTINGS, "AutoConfigURL", 1, "http://corp.example/proxy.pac")
        self.assertFalse(self.mgr.is_managed(),
                         "有 PAC 时必须以 PAC 为准，残留 ProxyServer 不参与判断")

    def test_static_mode_requires_proxy_enable(self):
        """静态模式：ProxyEnable=0 时即使 ProxyServer 是环回也不算接管中。"""
        self.backend.write(INTERNET_SETTINGS, "ProxyServer", 1, "127.0.0.1:10809")
        self.backend.write(INTERNET_SETTINGS, "ProxyEnable", 4, 0)
        self.assertFalse(self.mgr.is_managed())
        self.backend.write(INTERNET_SETTINGS, "ProxyEnable", 4, 1)
        self.assertTrue(self.mgr.is_managed())


class TestSnapshotStore(unittest.TestCase):
    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SnapshotStore(Path(tmp) / "backup.json")
            snap = ProxySnapshot(
                values={"ProxyServer": [1, "10.0.0.1:8080"], "ProxyEnable": [4, 1]},
                platform="win32",
                created_at=1700000000.0,
            )
            store.save(snap)
            loaded = store.load()
            assert loaded is not None
            self.assertEqual(loaded.values, snap.values)
            self.assertEqual(loaded.platform, "win32")
            store.clear()
            self.assertIsNone(store.load())

    def test_corrupt_file_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{not json", encoding="utf-8")
            self.assertIsNone(SnapshotStore(path).load())


class TestPacGeneration(unittest.TestCase):
    def test_pac_contains_endpoint_and_fallback(self):
        pac = build_pac("127.0.0.1:10809")
        self.assertIn("PROXY 127.0.0.1:10809; DIRECT", pac)
        self.assertIn("FindProxyForURL", pac)
        self.assertIn(".qq.com", pac)
        # 生成物必须是合法 JS 结构（关键符号成对）
        self.assertEqual(pac.count("{"), pac.count("}"))
        self.assertEqual(pac.count("("), pac.count(")"))

    def test_pac_rules_joined_correctly(self):
        pac = build_pac("127.0.0.1:10809", [".a.com", ".b.cn"])
        line = next(l for l in pac.splitlines() if "var RULES" in l)
        self.assertIn('".a.com|.b.cn"', line)

    def test_endpoint_formats(self):
        self.assertEqual(proxy_server_for(10809), "127.0.0.1:10809")
        self.assertEqual(pac_url_for(10810), "http://127.0.0.1:10810/proxy.pac")
        # WinINET 不接受 scheme 前缀
        self.assertNotIn("http://", proxy_server_for(10809))


class TestSuffixMatch(unittest.TestCase):
    """PAC 里那段判断的 Python 镜像 —— 这里过不了，浏览器端一定错。"""

    RULES = (".qq.com", ".cn", ".google.com")

    def test_subdomain_matches(self):
        self.assertTrue(pac_suffix_match("www.qq.com", self.RULES))
        self.assertTrue(pac_suffix_match("qq.com", self.RULES))
        self.assertTrue(pac_suffix_match("a.b.cn", self.RULES))

    def test_lookalike_domain_does_not_match(self):
        """notqq.com 不能被 .qq.com 吞掉 —— 这是补点的意义。"""
        self.assertFalse(pac_suffix_match("notqq.com", self.RULES))
        self.assertFalse(pac_suffix_match("fakegoogle.com", self.RULES))
        self.assertFalse(pac_suffix_match("cn.example.org", self.RULES))

    def test_bare_hostname_is_local(self):
        self.assertTrue(pac_suffix_match("intranet", self.RULES))

    def test_foreign_domain_passes_through(self):
        self.assertFalse(pac_suffix_match("example.org", self.RULES))
        self.assertFalse(pac_suffix_match("openai.com", self.RULES))

    def test_case_and_trailing_dot(self):
        self.assertTrue(pac_suffix_match("WWW.QQ.COM.", self.RULES))


class TestBackendContract(unittest.TestCase):
    def test_missing_key_reads_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            be = JsonFileBackend(Path(tmp) / "r.json")
            self.assertIsNone(be.read(INTERNET_SETTINGS, "Nope"))
            be.write(INTERNET_SETTINGS, "X", 1, "v")
            self.assertEqual(be.read(INTERNET_SETTINGS, "X"), (1, "v"))
            be.delete(INTERNET_SETTINGS, "X")
            self.assertIsNone(be.read(INTERNET_SETTINGS, "X"))

    def test_persists_across_instances(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "r.json"
            JsonFileBackend(path).write(INTERNET_SETTINGS, "ProxyEnable", 4, 1)
            fresh = JsonFileBackend(path)
            self.assertEqual(fresh.read(INTERNET_SETTINGS, "ProxyEnable"), (4, 1))
            self.assertTrue(json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
