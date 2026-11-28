"""app/windows_desktop.py 热点第二批复发测试（顶层小函数）。

只锁原提交自带测试抓不住的修复；windows_desktop_hotspot_test.py、windows_update_ui_test.py、
windows_update_health_test.py、windows_stale_gateway_test.py、windows_close_cleanup_test.py、
windows_unicode_paths_test.py、windows_ps_quote_test.py、windows_gateway_port_test.py 已锁住的不重复。
每个测试类写明它锁的提交：只回退那个修复，对应测试就会变红。
全部在 Linux 上跑：不开窗口、不起进程、不联网（回环探测用假的 urlopen 回答）。
"""
import json
import os
import tempfile
import types
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import windows_desktop as desktop

TOKEN = "ab" * 16


def _temp_dir(case):
    tmp = tempfile.TemporaryDirectory()
    case.addCleanup(tmp.cleanup)
    return Path(tmp.name)


class _Answer:
    """假的回环回答：with 语句里给出 status，read() 给出正文。"""

    def __init__(self, status=200, body=b""):
        self.status, self.body = status, body

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self, size=-1):
        return self.body if size is None or size < 0 else self.body[:size]


def _answers(*replies):
    """依次给出回答；异常对象就当场抛出（模拟 401、拒绝连接）。"""
    queue = list(replies)

    def urlopen(_url, timeout):
        reply = queue.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        return reply
    return urlopen


def _http_error(code):
    return urllib.error.HTTPError("http://127.0.0.1:18789/", code, "refused", None, None)


class UpdaterLogNeverStopsTheUpdateTest(unittest.TestCase):
    """b748c9f8：App 和更新助手同时写 updater.log 时，写日志失败不能打断更新交接；其他日志照常报错。"""

    def test_a_busy_updater_log_is_skipped_but_other_logs_still_raise(self):
        state = _temp_dir(self)
        for name in ("updater", "launcher"):
            (state / "logs" / f"{name}.log").mkdir(parents=True)  # 目录占住文件名：open("a") 必然 OSError
        with mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(state)}):
            desktop.append_log("updater", "swap started")
            with self.assertRaises(OSError):
                desktop.append_log("launcher", "window create")

    def test_a_writable_updater_log_still_gets_the_line(self):
        state = _temp_dir(self)
        with mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(state)}):
            desktop.append_log("updater", "swap started")
        self.assertIn("swap started", (state / "logs/updater.log").read_text(encoding="utf-8"))


class PendingLaunchTokenClockSkewTest(unittest.TestCase):
    """9db905f2：Windows 上刚写的文件 mtime 可能比 time.time() 晚一点，age 是小负数，也要认这个 token。"""

    def setUp(self):
        self.root = _temp_dir(self)
        (self.root / "updates/health").mkdir(parents=True)
        (self.root / f"updates/apply-{TOKEN}.ps1").write_text("x", encoding="utf-8")
        self.file = self.root / "updates/health/pending-launch.json"

    def take(self, seconds_before_mtime):
        self.file.write_text(json.dumps({"token": TOKEN}), encoding="utf-8")
        now = self.file.stat().st_mtime - seconds_before_mtime
        return desktop.take_pending_launch_token(self.root, now=now)

    def test_a_file_a_moment_in_the_future_is_still_accepted(self):
        self.assertEqual(self.take(1.0), TOKEN)
        self.assertFalse(self.file.exists(), "读过就删，下一次普通启动不能再拿到")

    def test_a_file_far_in_the_future_is_still_refused(self):
        self.assertIsNone(self.take(30.0))
        self.assertFalse(self.file.exists(), "拒绝的 token 也要删掉")


class GatewayProbeTest(unittest.TestCase):
    """a264dd20：网关回 401 等认证错误时还不算「就绪」（http_alive 仍算它活着）；
    1552ad4f：/health 回的不是 JSON 对象时，http_identity 给空字典，不让调用方拿列表当字典用。"""

    def ready(self, *replies):
        with mock.patch.object(desktop, "loopback_urlopen", _answers(*replies)):
            return desktop.http_ready(desktop.GATEWAY_URL)

    def test_an_auth_error_is_alive_but_not_ready(self):
        self.assertFalse(self.ready(_http_error(401)))
        with mock.patch.object(desktop, "loopback_urlopen", _answers(_http_error(401))):
            self.assertTrue(desktop.http_alive(desktop.GATEWAY_URL), "端口上有东西在回答")
        with mock.patch.object(desktop, "loopback_urlopen", _answers(_http_error(401))):
            self.assertFalse(desktop.http_alive(desktop.GATEWAY_URL, "pinkie-relay"), "要认身份时，报错不算数")

    def test_only_2xx_and_3xx_answers_are_ready(self):
        self.assertTrue(self.ready(_Answer(200)))
        self.assertTrue(self.ready(_Answer(302)))
        self.assertFalse(self.ready(_Answer(199)))
        self.assertFalse(self.ready(_http_error(503)))
        self.assertFalse(self.ready(ConnectionRefusedError(111, "refused")))

    def identity(self, body):
        with mock.patch.object(desktop, "loopback_urlopen", _answers(_Answer(200, body))):
            return desktop.http_identity("http://127.0.0.1:18790/health")

    def test_identity_is_always_a_dict(self):
        self.assertEqual(self.identity(b'{"service": "pinkie-relay"}'), {"service": "pinkie-relay"})
        self.assertEqual(self.identity(b'["pinkie-relay"]'), {})
        self.assertEqual(self.identity(b"<html>proxy</html>"), {})
        with mock.patch.object(desktop, "loopback_urlopen", _answers(ConnectionRefusedError(111, "refused"))):
            self.assertEqual(desktop.http_identity("http://127.0.0.1:18790/health"), {})


class GatewayUiUrlTest(unittest.TestCase):
    """3fe07310：老配置还用 token 认证时，聊天页地址要带上转义后的 token；配置坏了也照常打开聊天页。"""

    def url(self, config):
        path = _temp_dir(self) / "openclaw.json"
        if config is not None:
            path.write_text(config if isinstance(config, str) else json.dumps(config), encoding="utf-8")
        with mock.patch.dict(os.environ, {"OPENCLAW_CONFIG_PATH": str(path)}):
            return desktop.gateway_ui_url()

    def test_a_legacy_token_is_carried_and_escaped(self):
        url = self.url({"gateway": {"auth": {"mode": "token", "token": "a b/c#d"}}})
        base, _, fragment = url.partition("#")
        self.assertEqual(base, desktop.GATEWAY_CHAT_URL)
        self.assertEqual(fragment.split("=", 1), ["token", "a%20b%2Fc%23d"])

    def test_no_token_mode_or_a_broken_config_opens_the_plain_chat(self):
        for config in ({"gateway": {"auth": {"mode": "none", "token": "secret"}}},
                       {"gateway": {"auth": {"mode": "token", "token": ""}}},
                       {"gateway": "not-a-dict"}, "{broken", None):
            with self.subTest(config=config):
                self.assertEqual(self.url(config), desktop.GATEWAY_CHAT_URL)


class AppVersionTest(unittest.TestCase):
    """d0e52d72：记事本存的 VERSION 带 BOM，BOM 不能留在版本号前面（否则永远像另一个版本）；读不到给 0.0.0。"""

    def test_a_bom_and_trailing_newline_are_stripped(self):
        root = _temp_dir(self)
        (root / "VERSION").write_text("﻿2.6.1\r\n", encoding="utf-8")
        self.assertEqual(desktop.app_version(root), "2.6.1")

    def test_a_missing_file_reads_as_unknown(self):
        self.assertEqual(desktop.app_version(_temp_dir(self)), "0.0.0")


class BindToAppLifetimeTest(unittest.TestCase):
    """3643782c：子进程放进关窗即杀的作业对象；放不进去只记日志，绝不拦住启动。"""

    def bind(self, assign, process):
        logs = []
        core = types.ModuleType("browser_vpn_core")
        core.assign_to_kill_job = assign
        with mock.patch.object(desktop, "os", SimpleNamespace(name="nt")), \
                mock.patch.dict("sys.modules", {"browser_vpn_core": core}), \
                mock.patch.object(desktop, "append_log", lambda name, message: logs.append((name, message))):
            desktop.bind_to_app_lifetime(process, "gateway")
        return logs

    def test_the_child_is_put_in_the_job(self):
        assigned = []
        self.assertEqual(self.bind(assigned.append, SimpleNamespace(pid=4242)), [])
        self.assertEqual(assigned, [4242])

    def test_a_failure_is_logged_and_the_start_goes_on(self):
        def refuse(_pid):
            raise OSError("access denied")
        logs = self.bind(refuse, SimpleNamespace(pid=4242))
        self.assertEqual(logs, [("launcher", "gateway not bound to the app lifetime: access denied")])

    def test_no_process_means_nothing_to_bind(self):
        self.assertEqual(self.bind(lambda _pid: self.fail("没有进程不能去碰作业对象"), None), [])


class GatewayAnswerTimingTest(unittest.TestCase):
    """30f2f4b4：后台计时线程记下网关第一次回答的时刻；探测抛错也接着等，不能让线程死掉。"""

    def run_probe(self, replies, timeout=5.0):
        logs = []
        with mock.patch.object(desktop, "http_ready", mock.Mock(side_effect=replies)) as ready, \
                mock.patch.object(desktop, "append_log", lambda name, message: logs.append((name, message))):
            answered = desktop.log_gateway_answer(timeout=timeout, interval=0)
        return answered, logs, ready

    def test_a_probe_error_does_not_end_the_wait(self):
        answered, logs, ready = self.run_probe([RuntimeError("socket gone"), False, True])
        self.assertTrue(answered)
        self.assertEqual(ready.call_count, 3)
        self.assertEqual(len(logs), 1)
        self.assertTrue(logs[0][1].startswith("startup timing: gateway answered at +"), logs)

    def test_a_gateway_that_never_answers_logs_nothing(self):
        answered, logs, _ = self.run_probe(lambda _url: False, timeout=0.05)
        self.assertFalse(answered)
        self.assertEqual(logs, [])


class LoadDesktopPartTest(unittest.TestCase):
    """446d67e7：拆出去的模块执行进 windows_desktop 同一个命名空间；
    冻结包里只走 find_spec().loader.get_code()，不读散落的 .py；源码带 BOM 也能编译；
    执行完恢复主模块 __doc__、去掉 _PINKIE_DESKTOP_PART 标记。"""

    PROBE = "_L98_PROBE = (_PINKIE_DESKTOP_PART, 'from {source}')\n__doc__ = 'clobbered'\n"

    def setUp(self):
        self.doc = desktop.__doc__
        restore = mock.patch.dict(vars(desktop))  # 退出时把命名空间原样还回去
        restore.start()
        self.addCleanup(restore.stop)

    def assert_loaded(self, source):
        self.assertEqual(desktop._L98_PROBE, (True, f"from {source}"))
        self.assertEqual(desktop.__doc__, self.doc)
        self.assertFalse("_PINKIE_DESKTOP_PART" in vars(desktop), "_PINKIE_DESKTOP_PART 标记执行完没去掉")

    def test_frozen_builds_load_through_the_spec_loader_only(self):
        asked = []
        code = compile(self.PROBE.format(source="loader"), "<frozen windows_ps_templates>", "exec")

        def find_spec(name):
            asked.append(name)
            return SimpleNamespace(name=name, loader=SimpleNamespace(get_code=lambda _name: code))

        with mock.patch.object(desktop.sys, "frozen", True, create=True), \
                mock.patch.object(desktop.importlib.util, "find_spec", find_spec):
            desktop._load_desktop_part("windows_ps_templates")  # 旁边确有 windows_ps_templates.py
        self.assert_loaded("loader")
        self.assertEqual(asked, ["windows_ps_templates"])

    def test_a_frozen_build_without_the_module_fails_loudly(self):
        with mock.patch.object(desktop.sys, "frozen", True, create=True), \
                mock.patch.object(desktop.importlib.util, "find_spec", lambda _name: None):
            with self.assertRaises(ModuleNotFoundError) as raised:
                desktop._load_desktop_part("windows_l98_missing")
        self.assertEqual(raised.exception.name, "windows_l98_missing")

    def test_a_source_checkout_reads_the_sibling_file_even_with_a_bom(self):
        if getattr(desktop.sys, "frozen", False):
            self.skipTest("跑在冻结解释器里")
        folder = _temp_dir(self)
        (folder / "windows_l98_probe.py").write_text("﻿" + self.PROBE.format(source="sibling"), encoding="utf-8")
        vars(desktop)["__file__"] = str(folder / "windows_desktop.py")
        with mock.patch.object(desktop.importlib.util, "find_spec", lambda _name: self.fail("源码目录不该去找 spec")):
            desktop._load_desktop_part("windows_l98_probe")
        self.assert_loaded("sibling")


class HealthMarkerFailureTest(unittest.TestCase):
    """59a6b0fa：健康标记写不进去只记日志，原生桥脚本照样注入（反过来的情况由 windows_desktop_test 锁住）。"""

    def test_an_unwritable_marker_still_dresses_the_page(self):
        state = _temp_dir(self)
        (state / "updates").write_text("a file where the folder should be", encoding="utf-8")
        logs, scripts = [], []
        window = SimpleNamespace(get_current_url=lambda: desktop.GATEWAY_URL + "chat", evaluate_js=scripts.append)
        updater = SimpleNamespace(current_version="2.6.1", health_reporter=None, check=lambda: {},
                                  take_last_failure=lambda: self.fail("更新后首启不取旧失败"))
        quiet = SimpleNamespace(Thread=lambda **_kwargs: SimpleNamespace(start=lambda: None))
        with mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(state)}), \
                mock.patch.object(desktop, "threading", quiet), \
                mock.patch.object(desktop, "append_log", lambda name, message: logs.append((name, message))):
            desktop.install_native_bridge(window, updater, TOKEN)
        self.assertEqual(scripts, [desktop.NATIVE_READING_SCRIPT + desktop.BRIDGE_SCRIPT])
        self.assertEqual([name for name, _ in logs], ["launcher"])
        self.assertTrue(logs[0][1].startswith("update health marker not written: "), logs)


if __name__ == "__main__":
    unittest.main()
