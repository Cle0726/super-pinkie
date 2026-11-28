"""B10：Windows 原生作品窗口的导航拦截（跟 macOS AppWindow.swift decidePolicyFor、网关 #188 页面守卫同一条规矩）。

不起真窗口：规矩本身是纯函数；接到 WebView2 上那段用假的事件对象；run() 用假的 webview 模块。
反例：去掉 OPEN_EXTERNAL_LINKS_IN_BROWSER=False 或 before_show 那一行，test_run_* 会红；
把 file: 判断改成只看前缀（不加 /），test_sibling_folder_* 会红。
"""
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path, PureWindowsPath
from unittest import mock

from app import windows_app_window as appwin

APP = "w0123456789abcde"


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def fire(self, *args):
        for handler in list(self.handlers):
            handler(*args)


class Args:
    def __init__(self, uri):
        self.Uri = uri
        self.Cancel = False


class FakeCore:
    def __init__(self):
        self.FrameNavigationStarting = Event()


class FakeControl:
    def __init__(self, core=None):
        self.NavigationStarting = Event()
        self.CoreWebView2InitializationCompleted = Event()
        self.CoreWebView2 = core


def window_with(control):
    return types.SimpleNamespace(native=types.SimpleNamespace(browser=types.SimpleNamespace(webview=control)))


class AppCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.dir = self.root / APP
        self.dir.mkdir()
        (self.dir / "index.html").write_text("<h1>x</h1>", encoding="utf-8")
        self.app = {"id": APP, "name": "单词小游戏", "dir": self.dir, "network": ["https://api.dictionary.example"]}

    def tearDown(self):
        self.tmp.cleanup()

    def ok(self, url):
        return appwin.navigation_allowed(url, self.app)


class NavigationRuleTest(AppCase):
    def test_own_folder_is_allowed(self):
        self.assertTrue(self.ok((self.dir / "index.html").as_uri()))
        self.assertTrue(self.ok((self.dir / "sub" / "page.html").as_uri()))
        self.assertTrue(self.ok(self.dir.as_uri()))

    def test_sibling_folder_sharing_the_prefix_is_blocked(self):
        self.assertFalse(self.ok((self.root / (APP + "x") / "index.html").as_uri()))

    def test_other_files_and_traversal_are_blocked(self):
        self.assertFalse(self.ok((self.root / "index.json").as_uri()))
        self.assertFalse(self.ok(self.dir.as_uri() + "/../index.json"))
        self.assertFalse(self.ok(self.dir.as_uri() + "/..%2Findex.json"))
        self.assertFalse(self.ok("file://server/share/index.html"))

    def test_only_ticked_origins_on_the_network(self):
        self.assertTrue(self.ok("https://api.dictionary.example/words?q=1"))
        self.assertTrue(self.ok("https://API.dictionary.example:443/"))
        self.assertFalse(self.ok("https://api.dictionary.example:8443/"))
        self.assertFalse(self.ok("http://api.dictionary.example/"))
        self.assertFalse(self.ok("https://evil.example/"))
        self.assertFalse(self.ok("https://api.dictionary.example.evil.example/"))

    def test_nothing_ticked_means_no_network(self):
        self.app["network"] = []
        self.assertFalse(self.ok("https://api.dictionary.example/"))

    def test_inline_schemes_allowed_and_everything_else_cancelled(self):
        for url in ("about:blank", "data:text/html,hi", "blob:null/1234"):
            self.assertTrue(self.ok(url), url)
        for url in ("javascript:alert(1)", "mailto:a@b.example", "ms-settings:", "ftp://x.example/", "", "not a url",
                    "ws://api.dictionary.example/"):
            self.assertFalse(self.ok(url), url)

    def test_own_page_allowed_when_state_root_runs_through_a_link(self):
        # B112: %LOCALAPPDATA% moved to D:\ and linked back (junction), or
        # PINKIE_STATE_ROOT pointing at a link. run() opens the unresolved
        # URL, so the guard must accept that spelling as well.
        real = self.root / "real"
        (real / APP).mkdir(parents=True)
        link = self.root / "link"
        try:
            link.symlink_to(real, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"no symlinks here: {error}")
        app = dict(self.app, dir=link / APP)
        self.assertTrue(appwin.navigation_allowed((link / APP / "index.html").as_uri(), app))
        self.assertTrue(appwin.navigation_allowed((real / APP / "sub" / "p.html").as_uri(), app))
        self.assertFalse(appwin.navigation_allowed((link / (APP + "x") / "index.html").as_uri(), app))
        self.assertFalse(appwin.navigation_allowed((link / "index.json").as_uri(), app))
        self.assertFalse(appwin.navigation_allowed((link / APP).as_uri() + "/../index.json", app))

    def test_own_page_allowed_on_a_mapped_drive_with_a_chinese_user_name(self):
        # B112: on a mapped drive Windows resolve() gives \\server\share\...,
        # whose file: URL has a host; the window itself loads Z:\... .
        drive = PureWindowsPath("Z:/Users/张三 Li/AppData/Local/SuperPinkie/apps") / APP
        unc = PureWindowsPath("//nas/home/Users/张三 Li/AppData/Local/SuperPinkie/apps") / APP
        app = dict(self.app, dir=drive)
        with mock.patch.object(appwin.Path, "absolute", lambda self: drive), \
                mock.patch.object(appwin.Path, "resolve", lambda self, strict=False: unc):
            self.assertTrue(appwin.navigation_allowed((drive / "index.html").as_uri(), app))
            self.assertTrue(appwin.navigation_allowed((drive / "sub" / "p.html").as_uri(), app))
            self.assertFalse(appwin.navigation_allowed((drive.parent / (APP + "x") / "index.html").as_uri(), app))
            self.assertFalse(appwin.navigation_allowed((drive.parent / "index.json").as_uri(), app))
            self.assertFalse(appwin.navigation_allowed((unc / "index.html").as_uri(), app),
                             "a file: URL with a host (SMB) stays blocked")

    def test_read_app_carries_the_ticked_origins(self):
        (self.root / "index.json").write_text(json.dumps({"apps": {APP: {"name": "单词小游戏", "network": ["https://a.example", 3]}}}),
                                              encoding="utf-8")
        app = appwin.read_app(APP, root=self.root)
        self.assertEqual(app["network"], ["https://a.example"])
        (self.root / "index.json").write_text(json.dumps({"apps": {APP: {"name": "x"}}}), encoding="utf-8")
        self.assertEqual(appwin.read_app(APP, root=self.root)["network"], [])


class NavigationHookTest(AppCase):
    def test_guard_cancels_top_level_and_frame_navigations(self):
        core = FakeCore()
        control = FakeControl(core)
        self.assertIsNotNone(appwin.install_navigation_guard(window_with(control), self.app))
        for event in (control.NavigationStarting, core.FrameNavigationStarting):
            bad, good = Args("https://evil.example/"), Args((self.dir / "index.html").as_uri())
            event.fire(control, bad)
            event.fire(control, good)
            self.assertTrue(bad.Cancel)
            self.assertFalse(good.Cancel)

    def test_frames_are_hooked_once_core_webview_is_ready(self):
        control = FakeControl(core=None)
        appwin.install_navigation_guard(window_with(control), self.app)
        core = FakeCore()
        control.CoreWebView2 = core
        control.CoreWebView2InitializationCompleted.fire(control, types.SimpleNamespace(IsSuccess=True))
        bad = Args("https://evil.example/")
        core.FrameNavigationStarting.fire(control, bad)
        self.assertTrue(bad.Cancel)

    def test_errors_fail_closed(self):
        control = FakeControl(FakeCore())
        appwin.install_navigation_guard(window_with(control), self.app)

        class Broken:
            Cancel = False

            @property
            def Uri(self):
                raise RuntimeError("COM gone")

        args = Broken()
        control.NavigationStarting.fire(control, args)
        self.assertTrue(args.Cancel)

    def test_missing_control_is_reported_not_raised(self):
        seen = []
        self.assertIsNone(appwin.install_navigation_guard(types.SimpleNamespace(native=None), self.app, log=seen.append))
        self.assertTrue(seen and "not installed" in seen[0])


class RunWiringTest(AppCase):
    def test_run_keeps_new_windows_in_the_app_and_installs_the_guard(self):
        control = FakeControl(FakeCore())
        made = {}

        def create_window(title, url, **kwargs):
            window = window_with(control)
            window.events = types.SimpleNamespace(before_show=Event())
            made.update(title=title, url=url, window=window)
            return window

        fake = types.SimpleNamespace(settings={"OPEN_EXTERNAL_LINKS_IN_BROWSER": True}, create_window=create_window,
                                     start=lambda **kwargs: made.setdefault("started", kwargs))
        with mock.patch.dict(sys.modules, {"webview": fake}), \
                mock.patch.object(appwin, "read_app", return_value=self.app), \
                mock.patch.object(appwin, "set_app_user_model_id"):
            appwin.run(["--app-window", APP])
        self.assertIs(fake.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"], False, "新窗口不能交给系统浏览器")
        self.assertEqual(made["url"], (self.dir / "index.html").as_uri())
        self.assertIn("started", made)
        self.assertEqual(len(made["window"].events.before_show.handlers), 1, "before_show 要装守卫")
        made["window"].events.before_show.fire()
        bad = Args("https://evil.example/")
        control.NavigationStarting.fire(control, bad)
        self.assertTrue(bad.Cancel, "窗口显示前守卫就该接上")


if __name__ == "__main__":
    unittest.main()
