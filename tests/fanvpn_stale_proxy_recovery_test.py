"""B109: FanVPN 系统代理被强杀 / 崩溃 / 删文件夹后不还原。

正常退出时 atexit -> fanvpn_bridge.shutdown() 会按快照还原 WinINET 代理；
但更新器 taskkill /F、任务管理器结束、崩溃都跳过 atexit，注册表里留着指向
127.0.0.1 死端口的 PAC / 代理，全机浏览器断网。快照
%LOCALAPPDATA%/FanVPN/sysproxy_backup.json 还在，可下次启动没有任何地方读它
（只有用户再开 FanVPN 才会碰）。

recover_stale_system_proxy() 在启动时跑一次：
* 快照在、当前设置仍是我们写的（环回 + 我们写的 ProxyOverride）、端口没人听 -> 按快照还原、删快照；
* 当前设置已不是我们的（用户 / 公司后来改了）-> 不动注册表，只删过期快照；
* 端口还有人听（另一个碧琪实例在用）-> 什么都不动。

全部走 JsonFileBackend + 临时目录，不碰真注册表、不起监听。
"""

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for sub in ("app", "app/fanvpn"):
    if str(ROOT / sub) not in sys.path:
        sys.path.append(str(ROOT / sub))
import fanvpn_bridge as fb  # noqa: E402
import win_sysproxy as ws  # noqa: E402

CORP_PAC = "http://wpad.corp.example/proxy.pac"


class StaleProxyRecovery(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.backend = ws.JsonFileBackend(root / "fake_registry.json")
        self.manager = ws.SystemProxyManager(backend=self.backend, notify=False)
        self.store = ws.SnapshotStore(root / "FanVPN" / "sysproxy_backup.json")
        # 用户原本：开着公司静态代理
        key = ws.INTERNET_SETTINGS
        self.backend.write(key, "ProxyEnable", ws.REG_DWORD, 1)
        self.backend.write(key, "ProxyServer", ws.REG_SZ, "corp-proxy:8080")
        self.original = self.manager.current()

    def take_over(self, method="pac", port=None):
        """照 FanVpnService.apply_system_proxy：先拍快照再接管、记下写了什么，然后进程被强杀（不还原）。"""
        self.store.save(self.manager.snapshot())
        if method == "pac":
            port = port or fb.DEFAULT_PANEL_PORT
            self.manager.apply_pac(ws.pac_url_for(port))
        else:
            port = port or fb.DEFAULT_PROXY_PORT
            self.manager.apply_direct(ws.proxy_server_for(port))
        self.store.save_applied(self.manager.current(), port)

    def recover(self, listening=False):
        self.probed = []

        def probe(port):
            self.probed.append(port)
            return listening

        return fb.recover_stale_system_proxy(manager=self.manager, store=self.store, port_listening=probe)

    def assert_left_alone(self, setup, expect="not-ours"):
        """另一套代理接手后：注册表一个字节都不能动。"""
        setup()
        before = self.manager.current()
        raw = self.backend.path.read_bytes() if hasattr(self.backend, "path") else None
        self.assertEqual(self.recover(), expect)
        self.assertEqual(self.manager.current(), before)
        if raw is not None:
            self.assertEqual(self.backend.path.read_bytes(), raw, "不能写注册表")
        self.assertEqual(self.probed, [], "不是我们的就不用去探端口")

    def test_killed_with_pac_on_next_start_restores_user_proxy(self):
        self.take_over("pac")
        self.assertTrue(self.manager.is_managed())
        result = self.recover()
        self.assertEqual(result, "restored")
        self.assertEqual(self.manager.current(), self.original)
        self.assertIsNone(self.store.load(), "快照还原后要删掉，免得下次又还原一遍")

    def test_killed_with_direct_proxy_on_next_start_restores_user_proxy(self):
        self.take_over("direct")
        self.assertEqual(self.recover(), "restored")
        self.assertEqual(self.manager.current(), self.original)
        self.assertIsNone(self.store.load())

    def test_user_changed_proxy_since_is_left_alone(self):
        self.take_over("pac")
        # 之后用户 / 公司把 PAC 换成了自己的：不是我们的了，不能拿旧快照盖掉
        self.backend.write(ws.INTERNET_SETTINGS, "AutoConfigURL", ws.REG_SZ, CORP_PAC)
        before = self.manager.current()
        self.assertEqual(self.recover(), "not-ours")
        self.assertEqual(self.manager.current(), before)
        self.assertIsNone(self.store.load(), "过期快照要删，否则以后再开 FanVPN 会还原到很久以前的状态")

    def test_loopback_proxy_of_someone_else_is_left_alone(self):
        # 用户自己的本机代理（如 Clash 7890）也是环回，但 ProxyOverride 不是我们写的那份
        self.take_over("direct")
        key = ws.INTERNET_SETTINGS
        self.backend.write(key, "ProxyServer", ws.REG_SZ, "127.0.0.1:7890")
        self.backend.write(key, "ProxyOverride", ws.REG_SZ, "<local>")
        before = self.manager.current()
        self.assertEqual(self.recover(), "not-ours")
        self.assertEqual(self.manager.current(), before)

    # win-coord on #584: the same bypass list as ours does not prove the proxy is ours.
    # Another local proxy (different port, or a different PAC path) may have kept it.
    def test_other_loopback_proxy_on_another_port_with_our_bypass_list_is_left_alone(self):
        def setup():
            self.take_over("direct")
            self.backend.write(ws.INTERNET_SETTINGS, "ProxyServer", ws.REG_SZ, "127.0.0.1:7890")
            self.assertEqual(self.manager.current()["ProxyOverride"], ws.DEFAULT_OVERRIDE)
            self.assertTrue(self.manager.is_managed(), "looks like ours by the old rule")

        self.assert_left_alone(setup)

    def test_other_loopback_pac_path_with_our_bypass_list_is_left_alone(self):
        def setup():
            self.take_over("pac")
            self.backend.write(ws.INTERNET_SETTINGS, "AutoConfigURL", ws.REG_SZ,
                               f"http://127.0.0.1:{fb.DEFAULT_PANEL_PORT}/clash.pac")
            self.assertTrue(self.manager.is_managed())

        self.assert_left_alone(setup)

    def test_other_loopback_pac_on_another_port_with_our_bypass_list_is_left_alone(self):
        def setup():
            self.take_over("pac")
            self.backend.write(ws.INTERNET_SETTINGS, "AutoConfigURL", ws.REG_SZ, "http://127.0.0.1:7890/proxy.pac")
            self.assertTrue(self.manager.is_managed())

        self.assert_left_alone(setup)

    def test_switched_from_our_pac_to_static_loopback_is_left_alone(self):
        def setup():
            self.take_over("pac")
            key = ws.INTERNET_SETTINGS
            self.backend.write(key, "AutoConfigURL", ws.REG_SZ, "")
            self.backend.write(key, "ProxyServer", ws.REG_SZ, "127.0.0.1:7890")
            self.backend.write(key, "ProxyEnable", ws.REG_DWORD, 1)

        self.assert_left_alone(setup)

    def test_fanvpn_on_a_non_default_port_is_still_recognised(self):
        # The default port was taken, so FanVPN bound another one: the record has the real one.
        self.take_over("pac", port=10877)
        self.assertEqual(self.recover(), "restored")
        self.assertEqual(self.probed, [10877])
        self.assertEqual(self.manager.current(), self.original)

    def test_probes_the_recorded_port(self):
        self.take_over("direct")
        self.assertEqual(self.recover(listening=True), "in-use")
        self.assertEqual(self.probed, [fb.DEFAULT_PROXY_PORT])

    def test_snapshot_without_applied_record_is_left_alone(self):
        # A snapshot from a build that did not keep the record: cannot confirm, touch nothing.
        def setup():
            self.take_over("pac")
            self.store.applied_path.unlink()

        self.assert_left_alone(setup, expect="unconfirmed")
        self.assertIsNotNone(self.store.load(), "keep it for FanVPN's own restore")

    def test_clear_removes_the_applied_record_too(self):
        self.take_over("pac")
        self.assertEqual(self.recover(), "restored")
        self.assertFalse(self.store.applied_path.exists())

    def test_port_still_answering_means_another_instance_owns_it(self):
        self.take_over("pac")
        before = self.manager.current()
        self.assertEqual(self.recover(listening=True), "in-use")
        self.assertEqual(self.manager.current(), before)
        self.assertIsNotNone(self.store.load(), "别的实例还在用，快照得留给它退出时还原")

    def test_no_snapshot_does_nothing(self):
        before = self.manager.current()
        self.assertEqual(self.recover(), "none")
        self.assertEqual(self.manager.current(), before)

    def test_never_raises(self):
        class Broken:
            def load(self):
                raise OSError("disk gone")

        self.assertEqual(
            fb.recover_stale_system_proxy(manager=self.manager, store=Broken(), port_listening=lambda p: False),
            "error",
        )


class StartupHook(unittest.TestCase):
    """windows_desktop 启动时真的会跑一次，而且失败只记日志。"""

    def test_bootstrap_starts_the_recovery(self):
        src = (ROOT / "app" / "windows_desktop.py").read_text(encoding="utf-8")
        body = src.split("    def bootstrap():", 1)[1].split("\n    def ", 1)[0]
        self.assertIn("target=recover_stale_fanvpn_proxy", body)

    def test_hook_logs_and_never_raises(self):
        import os
        from unittest import mock

        with tempfile.TemporaryDirectory() as state, mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": state}):
            from app.windows_desktop import recover_stale_fanvpn_proxy

            lines = []

            def boom():
                raise RuntimeError("registry locked")

            self.assertEqual(recover_stale_fanvpn_proxy(recover=boom, log=lambda *a: lines.append(a)), "error")
            self.assertEqual(recover_stale_fanvpn_proxy(recover=lambda: "restored", log=lambda *a: lines.append(a)), "restored")
            self.assertEqual(recover_stale_fanvpn_proxy(recover=lambda: "none", log=lambda *a: lines.append(a)), "none")
        self.assertEqual(len(lines), 2, lines)  # 「none」是常态，不刷日志
        self.assertIn("registry locked", lines[0][1])


if __name__ == "__main__":
    unittest.main()
