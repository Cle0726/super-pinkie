"""app/windows_desktop.py 热点复发测试（HOTSPOTS B7 续）。
每个测试类锁住近 60 天里的修复提交：只回退那个修复，对应测试就会变红。
run_desktop 在 Linux 上用假的 webview / 网关 / 更新器 / 线程跑，不开窗口、不起进程、不联网，后台线程只登记、按名字逐个执行。
跑不了、没锁的部分：WebView2 GUI 线程上同步 evaluate_js 的真实死锁（只能锁「交给工作线程」这一步）；
真实的 PowerShell 替换器、占位端口被老替换器检查的过程（见 windows_portable_update_integration_test）。
"""
import contextlib
import json
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import windows_desktop as desktop

TOKEN = "ab" * 16


class _Rec:
    """记账假对象：调用任何公开方法都记成 "<前缀>.<方法名>"，返回值按名字预设。"""

    def __init__(self, prefix, calls, **returns):
        self.__dict__.update(_prefix=prefix, _calls=calls, _returns=returns)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        def call(*_args, **_kwargs):
            self._calls.append(f"{self._prefix}.{name}")
            return self._returns.get(name)
        return call


class _Slot(list):
    def __iadd__(self, fn):
        self.append(fn)
        return self

    def fire(self, *args):
        for fn in list(self):
            fn(*args)


class _Window:
    """假窗口：记下每一次窗口 API 调用，用来证明「某个线程没碰窗口」。"""

    def __init__(self, url=""):
        self.url, self.calls, self.scripts = url, [], []
        self.events = SimpleNamespace(**{name: _Slot() for name in
                                         ("before_show", "loaded", "maximized", "restored", "closed")})

    def get_current_url(self):
        self.calls.append("get_current_url")
        return self.url

    def evaluate_js(self, script):
        self.calls.append("evaluate_js")
        self.scripts.append(script)

    def load_url(self, _url):
        self.calls.append("load_url")


class _Threads:
    """替换 windows_desktop 的 threading：Thread.start() 只登记，不真的开线程。"""

    def __init__(self):
        self.started = []
        started = self.started

        class Thread:
            def __init__(self, target=None, args=(), kwargs=None, name=None, daemon=None):
                self.target, self.args, self.kwargs, self.name, self.ran = target, args, kwargs or {}, name, False

            def start(self):
                started.append(self)

        self.module = types.ModuleType("threading")
        self.module.__dict__.update(threading.__dict__)
        self.module.Thread = Thread

    def find(self, name):
        for thread in self.started:
            if thread.name == name and not thread.ran:
                return thread
        raise AssertionError(f"没有启动名为 {name} 的线程：{[t.name for t in self.started]}")

    def run(self, name):
        thread = self.find(name)
        thread.ran = True
        thread.target(*thread.args, **thread.kwargs)


def _payload(scripts, function):
    """取出 window.<function>?.(...) 调用里的 JSON 参数。"""
    prefix = f"window.{function}?.("
    return [json.loads(s[len(prefix):-1]) for s in scripts if s.startswith(prefix)]


class _Run:
    """跑一次 run_desktop；外部依赖全部换成记账的假对象，补丁一直保持到测试结束。"""

    def __init__(self, case, token=None, gateway_up=False, installing=None, config_changed=False,
                 prepare_error=None, wait_ready=True, port_free=True, env=None):
        self.calls, self.logs, self.threads = [], [], _Threads()
        calls = self.calls
        tmp = tempfile.TemporaryDirectory()
        case.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        resources = root / "resources"
        (resources / "ui").mkdir(parents=True)
        (resources / "VERSION").write_text("2.6.1\n", encoding="utf-8")
        (resources / "ui/launcher-loading.html").write_text("<p>splash</p>", encoding="utf-8")
        self.runtime = SimpleNamespace(valid=lambda: True, environment=lambda: {}, node=root / "runtime/bin/node.exe")

        def keep(name, value):
            setattr(self, name, value)
            return value

        def reporter(token_, node):
            calls.append("reporter.create")
            made = keep("reporter", _Rec("reporter", calls, wait_for_gateway_port=port_free))
            made.__dict__.update(token=token_, node=node)
            return made

        def create_window(_title, url=None, **kwargs):
            calls.append("create_window")
            self.window_url, self.window_kwargs = url, kwargs
            self.background_at_create = os.environ.get("WEBVIEW2_DEFAULT_BACKGROUND_COLOR")
            return keep("window", _Window())

        def prepare(_log):
            calls.append("prepare")
            if prepare_error:
                raise prepare_error
            return config_changed

        bridge = SimpleNamespace(attach=lambda _w: None, _native_bridge=None, stop_dictation=lambda: None,
                                 close_workspace_dock=lambda: None, _native_window_handle=lambda: None,
                                 _pinkie_native=lambda: SimpleNamespace(start=lambda: None))
        self.webview = types.ModuleType("webview")
        self.webview.settings = {}
        self.webview.create_window = create_window
        self.webview.start = lambda **_kwargs: calls.append("webview.start")
        inapp = SimpleNamespace(install=lambda *_a: None, manager=lambda: None)

        stack = contextlib.ExitStack()
        case.addCleanup(stack.close)
        stack.enter_context(mock.patch.dict(sys.modules, {"webview": self.webview, "inapp_browser": inapp}))
        stack.enter_context(mock.patch.dict(os.environ, {
            "PINKIE_STATE_ROOT": str(root / "state"), "OPENCLAW_CONFIG_PATH": str(root / "missing.json"),
            "PINKIE_KEEP_GATEWAY": "0"}))
        for key in ("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "PINKIE_SMOKE_WEBVIEW_CDP"):
            os.environ.pop(key, None)
        os.environ.update(env or {})
        patches = {
            "threading": self.threads.module,
            "atexit": SimpleNamespace(register=lambda _fn: None),
            "BundledRuntime": lambda _root: self.runtime,
            "WindowsUpdater": lambda _root: keep("updater", SimpleNamespace(current_version="2.6.1", health_reporter=None)),
            "NativeBridge": lambda _updater: bridge,
            "GatewaySupervisor": lambda _runtime: _Rec("gateway", calls, wait_ready=wait_ready),
            "UpdateHealthReporter": reporter,
            "LocalServices": lambda _runtime: _Rec("services", calls),
            "DesktopControlNode": lambda _runtime: _Rec("computer", calls),
            "append_log": lambda name, message: self.logs.append((name, message)),
            "update_in_progress": lambda: (calls.append("update_in_progress"), installing)[1],
            "show_update_in_progress": lambda version: calls.append(("show_update_in_progress", version)),
            "http_ready": lambda _url: (calls.append("http_ready"), gateway_up)[1],
            "cleanup_orphan_webview": lambda _path: None,
            "process_guard_alerts": lambda *_a, **_k: (False, False),
            "guard_release_build": lambda _root: False,
            "finish_exit": lambda *_a, **_k: calls.append("finish_exit"),
        }
        for name, value in patches.items():
            stack.enter_context(mock.patch.object(desktop, name, value))
        desktop.run_desktop(resources, prepare, token)


class UpdateInProgressGateTest(unittest.TestCase):
    """8b7385bb：替换器还在换文件时再开 App，只提示后退出，不能开出旧版本的窗口。"""

    def test_a_start_during_an_update_only_explains_and_leaves(self):
        run = _Run(self, installing="2.6.1")
        self.assertIn(("show_update_in_progress", "2.6.1"), run.calls)
        self.assertNotIn("create_window", run.calls)
        self.assertNotIn("gateway.retire_stale", run.calls)

    def test_the_start_made_by_the_replacer_is_never_refused(self):
        run = _Run(self, token=TOKEN, installing="2.6.1")
        self.assertNotIn("update_in_progress", run.calls)
        self.assertIn("create_window", run.calls)


class WindowCreationTest(unittest.TestCase):
    """60bf391e：先退旧网关再判断热不热（否则新版显示旧版页面）；c092fc4b：透明背景在首帧前设好（否则闪白）；
    3dad11aa：冒烟测试的 DevTools 端口走 pywebview 自己的设置（WebView2 环境变量会被它盖掉）。"""

    def test_stale_gateway_is_retired_before_the_warm_probe(self):
        run = _Run(self, gateway_up=True)
        self.assertEqual(run.calls.count("gateway.retire_stale"), 1)
        self.assertLess(run.calls.index("gateway.retire_stale"), run.calls.index("http_ready"))

    def test_background_is_set_before_the_window_is_created(self):
        run = _Run(self)
        self.assertEqual(run.background_at_create, "00000000")
        kwargs = run.window_kwargs
        self.assertEqual((kwargs["transparent"], kwargs["shadow"], kwargs["background_color"]), (True, False, "#000000"))

    def test_the_port_goes_through_pywebview_settings_only_for_smoke_runs(self):
        smoke = _Run(self, env={"PINKIE_SMOKE_WEBVIEW_CDP": "http://127.0.0.1:63938"})
        self.assertEqual(smoke.webview.settings.get("REMOTE_DEBUGGING_PORT"), 63938)
        self.assertNotIn("REMOTE_DEBUGGING_PORT", _Run(self).webview.settings)


class WebViewThreadingTest(unittest.TestCase):
    """441a5b27 / a45431c6：GUI 线程和启动线程都不能同步调用窗口 API（WebView2 会卡死）。"""

    def test_a_warm_gateway_opens_on_the_chat_and_a_cold_one_on_the_splash(self):
        self.assertEqual(_Run(self, gateway_up=True).window_url, desktop.GATEWAY_CHAT_URL)
        cold = _Run(self).window_url
        self.assertTrue(cold.startswith("file:") and cold.endswith("ui/launcher-loading.html"), cold)

    def test_loaded_hands_the_window_to_a_worker(self):
        run = _Run(self, gateway_up=True)
        run.window.events.loaded.fire()
        self.assertEqual(run.window.calls, [], "loaded 在 GUI 线程上，不能直接碰窗口")
        worker = run.threads.find("pinkie-native-bridge")
        self.assertIs(worker.target, desktop.install_native_bridge)
        self.assertIs(worker.args[0], run.window)

    def test_bootstrap_never_touches_the_window(self):
        run = _Run(self)
        run.threads.run("pinkie-bootstrap")
        run.threads.run("pinkie-computer-start")
        self.assertIn("gateway.start", run.calls)
        self.assertEqual(run.window.calls, [], "启动页自己轮询网关，启动线程不能 load_url / evaluate_js")


class HealthReporterTimingTest(unittest.TestCase):
    """fbbb0659 / 3d223002：更新后首启的健康上报对象带本版 node；.started 只在窗口建好后才写。"""

    def test_reporter_starts_only_once_the_window_exists(self):
        run = _Run(self, token=TOKEN)
        self.assertIs(run.updater.health_reporter, run.reporter)
        self.assertEqual((run.reporter.token, run.reporter.node), (TOKEN, run.runtime.node))
        self.assertEqual(run.calls.count("reporter.start"), 1)
        self.assertLess(run.calls.index("create_window"), run.calls.index("reporter.start"))

    def test_a_normal_start_has_no_reporter(self):
        run = _Run(self)
        self.assertNotIn("reporter.create", run.calls)
        self.assertIsNone(run.updater.health_reporter)


class BootstrapGatewayTest(unittest.TestCase):
    """3d223002：启动准备出错也照常启动网关；b171f21d：真网关等占位端口放手，等不到就先释放占位再启动。"""

    def test_a_failed_setup_still_starts_the_gateway(self):
        run = _Run(self, prepare_error=RuntimeError("boom"))
        run.threads.run("pinkie-bootstrap")
        self.assertIn(("launcher", "startup setup failed: boom"), run.logs)
        self.assertIn("gateway.start", run.calls)

    def order(self, **options):
        run = _Run(self, token=TOKEN, **options)
        run.threads.run("pinkie-bootstrap")
        return [c for c in run.calls if c.startswith(("reporter.wait", "reporter.release", "gateway.start"))]

    def test_gateway_waits_for_the_placeholder_port(self):
        self.assertEqual(self.order(), ["reporter.wait_for_gateway_port", "gateway.start"])

    def test_a_port_held_too_long_is_released_before_the_gateway_starts(self):
        self.assertEqual(self.order(port_free=False),
                         ["reporter.wait_for_gateway_port", "reporter.release_port", "gateway.start"])


class ConfigReloadAndDesktopControlTest(unittest.TestCase):
    """b8b3e001：准备改了配置而网关已在跑就重载；桌面控制节点等网关就绪再配对，关窗时一起关。"""

    def test_changed_config_reloads_a_running_gateway(self):
        run = _Run(self, gateway_up=True, config_changed=True)
        run.threads.run("pinkie-bootstrap")
        self.assertEqual(run.calls.count("gateway.reload_for_config"), 1)
        self.assertLess(run.calls.index("prepare"), run.calls.index("gateway.reload_for_config"))

    def test_unchanged_config_or_a_cold_gateway_reloads_nothing(self):
        for options in ({"gateway_up": True}, {"config_changed": True}):
            with self.subTest(**options):
                run = _Run(self, **options)
                run.threads.run("pinkie-bootstrap")
                self.assertNotIn("gateway.reload_for_config", run.calls)

    def test_desktop_control_waits_for_a_ready_gateway(self):
        run = _Run(self)
        run.threads.run("pinkie-bootstrap")
        self.assertNotIn("computer.start", run.calls, "start() 只是拉起进程，不能马上配对")
        run.threads.run("pinkie-computer-start")
        self.assertLess(run.calls.index("gateway.wait_ready"), run.calls.index("computer.start"))

    def test_desktop_control_is_skipped_when_the_gateway_never_answers(self):
        run = _Run(self, wait_ready=False)
        run.threads.run("pinkie-bootstrap")
        run.threads.run("pinkie-computer-start")
        self.assertNotIn("computer.start", run.calls)
        self.assertIn(("computer", "desktop control skipped: gateway did not become ready"), run.logs)

    def test_closing_the_window_closes_desktop_control(self):
        run = _Run(self)
        run.window.events.closed.fire()
        self.assertIn("computer.close", run.calls)


class BeforeShowNativeSetupTest(unittest.TestCase):
    """2928e40a：显示前依次装玻璃、圆角（及失败导航兜底）；其中一项出错不能拦住其余几项。"""

    def test_each_native_setup_runs_and_one_failure_does_not_stop_the_rest(self):
        run, seen = _Run(self), []

        def broken(window):
            seen.append(("glass", window))
            raise OSError("no dwm")

        with mock.patch.object(desktop, "configure_native_glass", broken), \
                mock.patch.object(desktop, "configure_native_corners", lambda w: seen.append(("corners", w))), \
                mock.patch.object(desktop, "watch_failed_file_navigation", lambda w: seen.append(("guard", w))):
            run.window.events.before_show.fire()
        self.assertEqual(seen, [("glass", run.window), ("corners", run.window), ("guard", run.window)])
        self.assertIn(("launcher", "native glass setup failed: no dwm"), run.logs)
        self.assertEqual(run.window.calls, [], "before_show 在 WinForms GUI 线程上，不能调 evaluate_js")


class InstallNativeBridgeNoticesTest(unittest.TestCase):
    """60bf391e / fbbb0659 / bd71077d：install_native_bridge 的失败提示、健康上报和「这次更新了什么」。"""

    def bridge(self, token=None, failure=None, reporter=None, notes=None):
        threads, checked = _Threads(), []
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        state = Path(tmp.name)
        updater = SimpleNamespace(
            current_version="2.6.1", health_reporter=reporter,
            take_last_failure=lambda: (checked.append("take_last_failure"), failure)[1],
            check=lambda force=False: (checked.append("check"), {"available": True, "version": "2.7.0"})[1])
        window = _Window(desktop.GATEWAY_URL + "chat")
        with mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(state)}), \
                mock.patch.object(desktop, "threading", threads.module), \
                mock.patch.object(desktop, "append_log"):
            desktop.install_native_bridge(window, updater, token, notes)
            for thread in list(threads.started):
                thread.target(*thread.args, **thread.kwargs)
        return window.scripts, checked, state / "updates/health" / f"{token}.ready"

    def test_a_failed_update_is_shown_and_the_update_offer_held_back(self):
        scripts, checked, _ = self.bridge(failure={"version": "2.6.0", "message": "坏" * 400})
        shown = _payload(scripts, "__pinkieShowUpdateFailed")
        self.assertEqual(len(shown), 1)
        self.assertEqual((shown[0]["version"], shown[0]["current"], len(shown[0]["message"])), ("2.6.0", "2.6.1", 300))
        self.assertEqual(_payload(scripts, "__pinkiePresentUpdate"), [], "刚失败就别马上又劝用户更新")
        self.assertNotIn("check", checked)

    def test_without_a_failure_the_update_offer_still_appears(self):
        scripts, _, _ = self.bridge()
        self.assertEqual(_payload(scripts, "__pinkieShowUpdateFailed"), [])
        self.assertEqual([p["version"] for p in _payload(scripts, "__pinkiePresentUpdate")], ["2.7.0"])

    def test_the_first_start_after_an_update_does_not_take_the_old_failure(self):
        _, checked, _ = self.bridge(token=TOKEN, failure={"version": "2.6.0", "message": "x"})
        self.assertNotIn("take_last_failure", checked)

    def test_the_running_reporter_confirms_the_update(self):
        readied = []
        _, _, marker = self.bridge(token=TOKEN, reporter=SimpleNamespace(token=TOKEN, ready=lambda: readied.append(1)))
        self.assertEqual(readied, [1])
        self.assertFalse(marker.exists(), "上报对象自己写 .ready，不能绕过它")

    def test_a_reporter_for_another_token_falls_back_to_the_marker(self):
        reporter = SimpleNamespace(token="cd" * 16, ready=lambda: self.fail("不是这次更新的上报对象"))
        _, _, marker = self.bridge(token=TOKEN, reporter=reporter)
        self.assertEqual(marker.read_text(encoding="ascii"), "ready\n")

    def test_installed_notes_are_shown_only_after_an_update(self):
        notes = {"summary": "碧琪换新衣服啦", "details": ["启动更快", "更新更稳"]}
        shown = _payload(self.bridge(token=TOKEN, notes=notes)[0], "__pinkieShowInstalledNotes")
        self.assertEqual(len(shown), 1)
        self.assertEqual((shown[0]["version"], shown[0]["details"]), ("2.6.1", ["启动更快", "更新更稳"]))
        self.assertEqual(shown[0]["notes"], "碧琪换新衣服啦\n启动更快\n更新更稳")
        self.assertEqual(_payload(self.bridge(notes=notes)[0], "__pinkieShowInstalledNotes"), [])
        empty = self.bridge(token=TOKEN, notes={"summary": "", "details": []})[0]
        self.assertEqual(_payload(empty, "__pinkieShowInstalledNotes"), [])


if __name__ == "__main__":
    unittest.main()
