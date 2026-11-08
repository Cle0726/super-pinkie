"""2.5.40: right after an update the window showed WebView2's bare
「未找到文件 ERR_FILE_NOT_FOUND」 although the splash existed at start. Any
failed file:// navigation now shows the built-in startup page instead."""
from types import SimpleNamespace
import unittest

from app import windows_desktop


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def fire(self, sender, args):
        for handler in self.handlers:
            handler(sender, args)


class FakeControl:
    def __init__(self):
        self.NavigationCompleted = Event()
        self.Source = ""
        self.shown = []
        self.CoreWebView2 = SimpleNamespace(NavigateToString=self.shown.append)


def window_with(control):
    return SimpleNamespace(native=SimpleNamespace(browser=SimpleNamespace(webview=control)))


class FailedFileNavigationTest(unittest.TestCase):
    def setUp(self):
        self.control = FakeControl()
        self.messages = []
        windows_desktop.watch_failed_file_navigation(window_with(self.control), log=self.messages.append, limit=2)

    def navigate(self, source, success, status="FileNotFound"):
        self.control.Source = source
        self.control.NavigationCompleted.fire(self.control, SimpleNamespace(IsSuccess=success, WebErrorStatus=status))

    def test_failed_splash_shows_the_built_in_page(self):
        self.navigate("file:///C:/x/%E8%B6%85/_internal/ui/launcher-loading.html", False)
        self.assertEqual(self.control.shown, [windows_desktop.STARTUP_FALLBACK_HTML])
        self.assertIn("FileNotFound", self.messages[-1])

    def test_successful_and_http_failures_are_left_to_the_page(self):
        self.navigate("file:///C:/x/ui/launcher-loading.html", True)
        self.navigate("http://127.0.0.1:18789/chat", False, "ConnectionAborted")
        self.assertEqual(self.control.shown, [])

    def test_repeated_failures_do_not_loop(self):
        for _ in range(5):
            self.navigate("file:///C:/gone.html", False)
        self.assertEqual(len(self.control.shown), 2)

    def test_handler_never_raises_into_webview2(self):
        def broken(_):
            raise RuntimeError("COM gone")
        self.control.CoreWebView2 = SimpleNamespace(NavigateToString=broken)
        self.navigate("file:///C:/gone.html", False)
        self.assertIn("COM gone", self.messages[-1])

    def test_missing_control_is_logged_not_raised(self):
        messages = []
        self.assertIsNone(windows_desktop.watch_failed_file_navigation(SimpleNamespace(native=None), log=messages.append))
        self.assertIn("not found", messages[0])

    def test_guard_is_installed_before_the_window_shows(self):
        source = open(windows_desktop.__file__, encoding="utf-8").read()
        before_show = source.split("    def before_show():", 1)[1].split("    def bootstrap():", 1)[0]
        self.assertIn("watch_failed_file_navigation", before_show)


if __name__ == "__main__":
    unittest.main()
