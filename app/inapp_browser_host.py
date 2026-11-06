"""碧琪的浏览器 -- the in-app browser window process (Windows).

Started by inapp_browser.BrowserManager as
    超級碧琪.exe --inapp-browser-host --connect PORT --token T --profile DIR ...
It is its own process so its WebView2 environment can carry its own
--proxy-server (the browser-only VPN) without touching the main window, the
gateway or the system.  Crashes stay here too.

Layout: one WinForms window, a small WebView2 at the top that draws the tab
strip / toolbar / node panel (inapp_browser_pages.CHROME_HTML), and one
WebView2 per tab under it.  All of them share one private user-data folder.

Talks to the manager over a loopback socket with JSON lines:
  manager -> host  {"id", "action", ...}      browser requests (app_browser)
                   {"push": "vpn", "state"}   node panel updates
                   {"upreply": n, ...}        answers to our upcalls
  host -> manager  {"id", "ok", ...}          replies
                   {"up": n, "op", ...}       node panel actions
                   {"event": ...}             window state
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import struct
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

NAV_ACTIONS = {"open", "back", "forward", "reload", "show_file"}
DOM_ACTIONS = {"snapshot", "locate", "read", "click", "type", "select", "press", "scroll"}
POINTER_ACTIONS = {"move", "hover", "drag", "set_slider"}
OBSERVE_AFTER = {"click", "type", "select", "press", "scroll", "move", "hover", "drag", "set_slider"}
HOME_URL = "pinkie://start"
SEARCH_URL = "https://www.bing.com/search?q="


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--inapp-browser-host", action="store_true")
    parser.add_argument("--connect", type=int, required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--control-js", default="")
    parser.add_argument("--proxy-port", type=int, default=0)
    parser.add_argument("--owner", type=int, default=0)
    parser.add_argument("--restore", action="store_true")
    parser.add_argument("--hidden", action="store_true")
    args, _ = parser.parse_known_args(argv)
    return args


def png_size(data: bytes) -> tuple:
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    return (0, 0)


def safe_home_file(raw: str) -> Path:
    """Same rule as the Mac browser: only existing files in the user's home,
    never keys or 碧琪's own configuration."""
    home = Path.home().resolve()
    text = str(raw or "").strip()
    if text.startswith("~"):
        text = str(home) + text[1:]
    path = Path(text)
    if not path.is_absolute():
        raise ValueError("请填写本地文件的绝对路径。")
    try:
        path = path.resolve(strict=True)
        relative = path.relative_to(home)
    except (OSError, ValueError):
        raise ValueError("为保护系统文件，只能打开用户主目录里现有的文件。") from None
    parts = [p.casefold() for p in relative.parts]
    state = bool(parts) and (parts[0] == ".openclaw" or parts[0].startswith(".openclaw-"))
    workspace = state and len(parts) > 1 and (parts[1] == "workspace" or parts[1].startswith("workspace-"))
    if parts and (parts[0] == ".ssh" or (state and not workspace)):
        raise ValueError("这个位置包含密钥或碧琪配置，不能从浏览器里打开。")
    if not path.is_file():
        raise ValueError("show_file 只能打开文件。")
    return path


def local_page(url: str) -> bool:
    lowered = (url or "").lower()
    return lowered.startswith(("http://127.0.0.1", "http://localhost", "https://127.0.0.1", "https://localhost", "file:///"))


class Channel:
    def __init__(self, port: int, token: str):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        self.sock.settimeout(None)
        self.lock = threading.Lock()
        self.reader = self.sock.makefile("r", encoding="utf-8", newline="\n")
        self.send({"hello": "host", "token": token, "pid": os.getpid()})

    def send(self, message: Dict[str, Any]) -> None:
        data = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
        with self.lock:
            try:
                self.sock.sendall(data)
            except OSError:
                pass

    def lines(self):
        for line in self.reader:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                continue


class Tab:
    def __init__(self, tab_id: str, view: Any):
        self.id = tab_id
        self.view = view
        self.core = None
        self.ready = threading.Event()
        self.pending_url: Optional[str] = None
        self.title = "新标签页"
        self.url = ""
        self.loading = False
        self.nav_event = threading.Event()
        self.dom_event = threading.Event()
        self.nav_ok = True
        self.nav_error = ""
        self.nav_id = -1
        self.awaiting_start = False
        self.expected_web = False

    def expect_navigation(self, url: str = "") -> None:
        self.awaiting_start = True
        self.expected_web = url.lower().startswith(("http://", "https://", "file:"))
        self.nav_event.clear()
        self.dom_event.clear()


def run(argv: Optional[List[str]] = None) -> None:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    channel = Channel(args.connect, args.token)
    # Load .NET only after the manager accepted us, so a bad launch fails fast.
    os.environ.setdefault("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FFFFFFFF")
    try:
        import clr  # noqa: F401
    except Exception:
        os.environ["PYTHONNET_RUNTIME"] = "coreclr"
        import clr  # noqa: F401
    import clr as _clr
    import webview

    lib = Path(webview.__file__).resolve().parent / "lib"
    _clr.AddReference("System.Windows.Forms")
    _clr.AddReference("System.Drawing")
    _clr.AddReference("System.Threading")
    _clr.AddReference(str(lib / "Microsoft.Web.WebView2.Core.dll"))
    _clr.AddReference(str(lib / "Microsoft.Web.WebView2.WinForms.dll"))
    for platform in ("win-x64", "win-arm64", "win-x86"):
        os.environ["Path"] = os.environ.get("Path", "") + ";" + str(lib / "runtimes" / platform / "native")
    try:
        import ctypes

        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:  # noqa: BLE001
        pass
    from System.Threading import ApartmentState, Thread, ThreadStart

    holder: Dict[str, Any] = {}

    def start():
        app = BrowserApp(args, channel)
        holder["app"] = app
        app.run()

    thread = Thread(ThreadStart(start))
    thread.SetApartmentState(ApartmentState.STA)
    thread.Start()
    thread.Join()
    os._exit(0)


class BrowserApp:
    def __init__(self, args: argparse.Namespace, channel: Channel):
        import System.Windows.Forms as WinForms
        from System.Drawing import Color, Size
        from Microsoft.Web.WebView2.WinForms import CoreWebView2CreationProperties, WebView2
        import inapp_browser_pages as pages

        self.WinForms = WinForms
        self.WebView2 = WebView2
        self.Props = CoreWebView2CreationProperties
        self.pages = pages
        self.args = args
        self.channel = channel
        self.state_dir = Path(args.state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.control_js = ""
        if args.control_js and Path(args.control_js).is_file():
            self.control_js = Path(args.control_js).read_text(encoding="utf-8")
        self.browser_args = " ".join(self._browser_args())
        self.tabs: List[Tab] = []
        self.active: Optional[Tab] = None
        self.upcalls: Dict[int, Dict[str, Any]] = {}
        self.upcall_seq = 0
        self.agent_busy = 0
        self.pinned = False
        self.user_closed = False
        self.cancelled: set = set()
        self.write_lock = threading.Lock()
        self.chrome_ready = threading.Event()
        self.vpn_state: Dict[str, Any] = {}

        self.panel_open = False
        self.chrome_px = 66  # device pixels; the chrome reports its real height
        self.mode = "float"
        self.float_bounds = None
        WinForms.Application.EnableVisualStyles()
        form = WinForms.Form()
        self.form = form
        form.Text = "碧琪的浏览器"
        form.BackColor = Color.FromArgb(255, 237, 247)  # Mac browser toolbar pink
        form.StartPosition = WinForms.FormStartPosition.Manual
        form.MinimumSize = Size(520, 360)
        try:
            from System.Drawing import Icon

            if getattr(sys, "frozen", False):
                form.Icon = Icon.ExtractAssociatedIcon(sys.executable)
        except Exception:  # noqa: BLE001
            pass
        self._restore_bounds()
        self.content = WinForms.Panel()
        self.content.Dock = WinForms.DockStyle.Fill
        self.chrome = self._new_view()
        self.chrome.Dock = WinForms.DockStyle.Top
        form.Controls.Add(self.content)
        form.Controls.Add(self.chrome)
        self._layout_chrome(False)
        self.chrome.CoreWebView2InitializationCompleted += self._chrome_ready
        self.chrome.EnsureCoreWebView2Async(None)
        form.FormClosing += self._closing
        form.Resize += lambda *_: self._layout_chrome(self.panel_open)
        form.Move += lambda *_: self._save_window_soon()
        form.ResizeEnd += lambda *_: self._save_window_soon()
        self.save_timer: Optional[threading.Timer] = None
        restore = self._load_window().get("tabs") if args.restore else None
        urls = [u for u in (restore or []) if isinstance(u, str) and u] or [HOME_URL]
        active_index = int(self._load_window().get("active", 0) or 0) if args.restore else 0
        for url in urls[:12]:
            self._add_tab(url, activate=False)
        self._activate(self.tabs[min(max(active_index, 0), len(self.tabs) - 1)])
        threading.Thread(target=self._read_loop, name="inapp-browser-read", daemon=True).start()

    # ── setup ──
    def _browser_args(self) -> List[str]:
        from browser_vpn_core import browser_proxy_arguments

        base = ["--disable-features=ElasticOverscroll", "--no-first-run"]
        return base + browser_proxy_arguments(self.args.proxy_port)

    def _new_view(self):
        view = self.WebView2()
        props = self.Props()
        props.UserDataFolder = self.args.profile
        props.AdditionalBrowserArguments = self.browser_args
        view.CreationProperties = props
        return view

    def run(self) -> None:
        WinForms = self.WinForms
        if self.args.owner:
            self.form.HandleCreated += lambda *_: self._set_owner()
        self.form.HandleCreated += lambda *_: self._frameless()
        self.form.Shown += lambda *_: self._frameless()
        if not self.args.hidden:
            self.form.Show()
        else:
            # Create the handle so Invoke works while still hidden.
            _ = self.form.Handle
        self.channel.send({"event": "ready", "proxyPort": self.args.proxy_port})
        WinForms.Application.Run()

    def _set_owner(self) -> None:
        try:
            import ctypes

            handle = int(self.form.Handle.ToInt64())
            ctypes.windll.user32.SetWindowLongPtrW(ctypes.c_void_p(handle), -8, ctypes.c_void_p(self.args.owner))
        except Exception:  # noqa: BLE001
            pass

    def _hwnd(self):
        import ctypes

        return ctypes.c_void_p(int(self.form.Handle.ToInt64()))

    def _frameless(self) -> None:
        """Like the Mac floating panel: no title bar, rounded corners and a
        shadow from DWM, edges still resizable (WS_THICKFRAME is kept)."""
        try:
            import ctypes

            user32 = ctypes.windll.user32
            user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            hwnd = self._hwnd()
            style = user32.GetWindowLongPtrW(hwnd, -16)
            user32.SetWindowLongPtrW(hwnd, -16, ctypes.c_ssize_t((style & ~0x00C00000) | 0x00040000))
            corner = ctypes.c_int(2)  # DWMWCP_ROUND
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(corner), 4)
            user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, 0x0027)  # FRAMECHANGED|NOMOVE|NOSIZE|NOZORDER
        except Exception:  # noqa: BLE001
            pass

    def _drag(self) -> None:
        try:
            import ctypes

            if self.mode == "full":
                return
            ctypes.windll.user32.ReleaseCapture()
            ctypes.windll.user32.SendMessageW(self._hwnd(), 0x00A1, 2, 0)  # WM_NCLBUTTONDOWN, HTCAPTION
        except Exception:  # noqa: BLE001
            pass

    def _present(self, mode: str) -> None:
        from System.Drawing import Rectangle

        WinForms = self.WinForms
        form = self.form
        if self.mode == "float" and form.WindowState == WinForms.FormWindowState.Normal:
            self.float_bounds = form.Bounds
        if mode == "full":
            form.WindowState = WinForms.FormWindowState.Maximized
        elif mode == "dock":
            form.WindowState = WinForms.FormWindowState.Normal
            area = WinForms.Screen.FromControl(form).WorkingArea
            width = max(520, min(int(area.Width * .42), 980))
            form.Bounds = Rectangle(area.Right - width, area.Top, width, area.Height)
        else:
            mode = "float"
            form.WindowState = WinForms.FormWindowState.Normal
            if self.float_bounds is not None:
                form.Bounds = self.float_bounds
        self.mode = mode
        self._sync_chrome()

    def _dpi(self) -> float:
        try:
            return max(1.0, float(self.form.DeviceDpi) / 96.0)
        except Exception:  # noqa: BLE001
            return 1.0

    def _layout_chrome(self, panel: bool) -> None:
        # The sheet and the menu draw over the pages, so the chrome view
        # grows to the whole window while they are open.
        if panel:
            self.chrome.Height = max(200, self.form.ClientSize.Height)
        else:
            self.chrome.Height = int(self.chrome_px)

    # ── window persistence ──
    def _window_file(self) -> Path:
        return self.state_dir / "window.json"

    def _load_window(self) -> Dict[str, Any]:
        try:
            data = json.loads(self._window_file().read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _restore_bounds(self) -> None:
        from System.Drawing import Point, Rectangle, Size

        saved = self._load_window().get("bounds")
        screen = self.WinForms.Screen.PrimaryScreen.WorkingArea
        if isinstance(saved, list) and len(saved) == 4:
            x, y, w, h = (int(v) for v in saved)
            rect = Rectangle(x, y, max(w, 520), max(h, 360))
            if any(s.WorkingArea.IntersectsWith(rect) for s in self.WinForms.Screen.AllScreens):
                self.form.Location = Point(rect.X, rect.Y)
                self.form.Size = Size(rect.Width, rect.Height)
                return
        w, h = min(1180, int(screen.Width * .7)), min(820, int(screen.Height * .82))
        self.form.Size = Size(w, h)
        self.form.Location = Point(screen.X + screen.Width - w - 40, screen.Y + (screen.Height - h) // 2)

    def _save_window_soon(self) -> None:
        if self.save_timer:
            self.save_timer.cancel()
        self.save_timer = threading.Timer(0.6, lambda: self._on_ui(self._save_window))
        self.save_timer.daemon = True
        self.save_timer.start()

    def _save_window(self) -> None:
        data = self._load_window()
        if self.form.WindowState == self.WinForms.FormWindowState.Normal and self.form.Visible:
            b = self.form.Bounds
            data["bounds"] = [b.X, b.Y, b.Width, b.Height]
        data["tabs"] = [t.url for t in self.tabs if t.url and t.url.startswith(("http://", "https://"))][:12]
        data["active"] = max(0, self.tabs.index(self.active)) if self.active in self.tabs else 0
        try:
            self._window_file().write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    # ── threading helpers ──
    def _on_ui(self, fn: Callable[[], Any], wait: bool = True) -> Any:
        from System import Action

        if not self.form.IsHandleCreated or not self.form.InvokeRequired:
            return fn()
        box: Dict[str, Any] = {}

        def call():
            try:
                box["value"] = fn()
            except Exception as error:  # noqa: BLE001
                box["error"] = error

        if not wait:
            self.form.BeginInvoke(Action(call))
            return None
        self.form.Invoke(Action(call))
        if "error" in box:
            raise box["error"]
        return box.get("value")

    @staticmethod
    def _await(task, timeout: float) -> Any:
        if not task.Wait(int(timeout * 1000)):
            raise TimeoutError("浏览器操作超时，请确认页面状态后再试。")
        return task.Result

    # ── chrome (toolbar) ──
    def _chrome_ready(self, sender, args) -> None:
        if not args.IsSuccess:
            self.channel.send({"event": "error", "message": "WebView2 初始化失败：" + str(args.InitializationException)})
            return
        core = self.chrome.CoreWebView2
        settings = core.Settings
        settings.AreDefaultContextMenusEnabled = False
        settings.AreDevToolsEnabled = False
        settings.IsStatusBarEnabled = False
        settings.IsZoomControlEnabled = False
        core.WebMessageReceived += self._chrome_message
        core.NavigateToString(self.pages.CHROME_HTML)

    def _post_chrome(self, message: Dict[str, Any]) -> None:
        def post():
            core = self.chrome.CoreWebView2
            if core is not None:
                core.PostWebMessageAsJson(json.dumps(message, ensure_ascii=False))
        try:
            self._on_ui(post, wait=False)
        except Exception:  # noqa: BLE001
            pass

    def _sync_chrome(self) -> None:
        if not self.chrome_ready.is_set():
            return
        tabs = [{"id": t.id, "title": t.title or t.url or "新标签页", "url": "" if t.url.startswith("pinkie:") or t.url.startswith("about:") or t.url.startswith("data:") else t.url,
                 "loading": t.loading} for t in self.tabs]
        active = self.active
        core = active.core if active else None
        self._post_chrome({
            "type": "state", "tabs": tabs, "active": active.id if active else "",
            "canGoBack": bool(core and core.CanGoBack), "canGoForward": bool(core and core.CanGoForward),
            "pinned": self.pinned, "agent": self.agent_busy > 0, "proxy": bool(self.args.proxy_port), "mode": self.mode,
        })

    def _chrome_message(self, sender, args) -> None:
        try:
            message = json.loads(args.WebMessageAsJson)
        except ValueError:
            return
        kind = message.get("type")
        if kind == "hello":
            self.chrome_ready.set()
            self._sync_chrome()
            if self.vpn_state:
                self._post_chrome({"type": "vpn", "state": self.vpn_state})
            return
        tab = self.active
        if kind == "navigate":
            self._navigate(tab, self._address_to_url(str(message.get("text", ""))))
        elif kind == "back" and tab and tab.core and tab.core.CanGoBack:
            tab.core.GoBack()
        elif kind == "forward" and tab and tab.core and tab.core.CanGoForward:
            tab.core.GoForward()
        elif kind == "reload" and tab and tab.core:
            tab.core.Reload()
        elif kind == "stop" and tab and tab.core:
            tab.core.Stop()
        elif kind == "home":
            self._navigate(tab, HOME_URL)
        elif kind == "newTab":
            self._add_tab(HOME_URL, activate=True)
        elif kind == "closeTab":
            self._close_tab(str(message.get("id", "")))
        elif kind == "activate":
            match = next((t for t in self.tabs if t.id == message.get("id")), None)
            if match:
                self._activate(match)
        elif kind == "pin":
            self.pinned = not self.pinned
            self.form.TopMost = self.pinned
            self._sync_chrome()
        elif kind == "height":
            self.chrome_px = max(30, min(400, int(message.get("px") or 66)))
            self._layout_chrome(self.panel_open)
        elif kind == "drag":
            self._drag()
        elif kind == "present":
            self._present(str(message.get("mode", "float")))
        elif kind == "close":
            self._hide()
        elif kind == "external" and tab and tab.url.startswith(("http://", "https://")):
            try:
                os.startfile(tab.url)
            except OSError:
                pass
        elif kind == "panel":
            if message.get("menu") and tab and tab.core is not None:
                self._send_backdrop(tab)
            self.panel_open = bool(message.get("open"))
            self._layout_chrome(self.panel_open)
        elif kind == "vpn":
            op = str(message.get("op", ""))
            payload = {k: v for k, v in message.items() if k not in ("type", "op", "rid")}
            rid = message.get("rid")
            threading.Thread(target=self._vpn_upcall, args=(op, payload, rid), daemon=True).start()

    def _send_backdrop(self, tab: Tab) -> None:
        """The menu covers the page view; show a still of the page under it."""
        def done(task):
            try:
                data = json.loads(str(task.Result)).get("data")
                if data:
                    self._post_chrome({"type": "backdrop", "src": "data:image/jpeg;base64," + data})
            except Exception:  # noqa: BLE001
                pass
        try:
            from System import Action
            from System.Threading.Tasks import Task

            task = tab.core.CallDevToolsProtocolMethodAsync("Page.captureScreenshot", json.dumps({"format": "jpeg", "quality": 70}))
            task.ContinueWith(Action[Task[str]](done))
        except Exception:  # noqa: BLE001
            pass

    def _vpn_upcall(self, op: str, payload: Dict[str, Any], rid: Any) -> None:
        reply = self.upcall("vpn." + op, payload, timeout=180)
        self._post_chrome({"type": "vpnReply", "rid": rid, "reply": reply})
        if op == "open_ip_check" and reply.get("ok"):
            self._on_ui(lambda: self._add_tab(reply.get("url") or "https://api.ip.sb/geoip", activate=True))

    def upcall(self, op: str, payload: Dict[str, Any], timeout: float = 60) -> Dict[str, Any]:
        self.upcall_seq += 1
        number = self.upcall_seq
        slot = {"event": threading.Event(), "reply": None}
        self.upcalls[number] = slot
        self.channel.send({"up": number, "op": op, **payload})
        if not slot["event"].wait(timeout):
            self.upcalls.pop(number, None)
            return {"ok": False, "message": "碧琪主程序没有回应，请稍后再试。"}
        self.upcalls.pop(number, None)
        return slot["reply"] or {"ok": False}

    @staticmethod
    def _address_to_url(text: str) -> str:
        text = text.strip()
        if not text:
            return HOME_URL
        lowered = text.lower()
        if lowered.startswith(("http://", "https://", "file:///", "about:")):
            return text
        if " " not in text and ("." in text or text.startswith("localhost")) and not text.endswith("."):
            return ("http://" if text.startswith(("localhost", "127.0.0.1")) else "https://") + text
        import urllib.parse

        return SEARCH_URL + urllib.parse.quote(text)

    # ── tabs ──
    def _add_tab(self, url: str, activate: bool = True, on_ready: Optional[Callable[[Tab], None]] = None) -> Tab:
        view = self._new_view()
        view.Dock = self.WinForms.DockStyle.Fill
        view.Visible = False
        tab = Tab(uuid.uuid4().hex[:10], view)
        tab.pending_url = url
        self.tabs.append(tab)
        self.content.Controls.Add(view)

        def ready(sender, args):
            if not args.IsSuccess:
                self.channel.send({"event": "error", "message": "WebView2 初始化失败：" + str(args.InitializationException)})
                return
            self._wire_tab(tab)
            tab.ready.set()
            if on_ready:
                on_ready(tab)
            if tab.pending_url:
                target, tab.pending_url = tab.pending_url, None
                self._navigate(tab, target)

        view.CoreWebView2InitializationCompleted += ready
        view.EnsureCoreWebView2Async(None)
        if activate:
            self._activate(tab)
        else:
            self._sync_chrome()
        return tab

    def _wire_tab(self, tab: Tab) -> None:
        core = tab.view.CoreWebView2
        tab.core = core
        settings = core.Settings
        settings.IsStatusBarEnabled = True
        settings.AreDevToolsEnabled = True

        # Only the newest navigation may complete a wait: replacing a page
        # that is still loading finishes the old one as ConnectionAborted.
        def starting(sender, args):
            tab.loading = True
            if tab.awaiting_start and tab.expected_web and str(args.Uri or "").startswith(("data:", "about:")):
                return  # the start page, replaced by the page we are waiting for
            tab.nav_id = int(args.NavigationId)
            tab.awaiting_start = False
            tab.nav_event.clear()
            tab.dom_event.clear()
            self._sync_chrome()

        def completed(sender, args):
            if tab.awaiting_start or int(args.NavigationId) != tab.nav_id:
                return
            tab.loading = False
            tab.nav_ok = bool(args.IsSuccess)
            tab.nav_error = "" if args.IsSuccess else str(args.WebErrorStatus)
            tab.nav_event.set()
            tab.dom_event.set()
            self._sync_chrome()
            self._save_window_soon()

        def dom_loaded(sender, args):
            if not tab.awaiting_start and int(args.NavigationId) == tab.nav_id:
                tab.dom_event.set()

        def source(sender, args):
            tab.url = str(core.Source or "")
            self._sync_chrome()

        def title(sender, args):
            tab.title = str(core.DocumentTitle or "")
            self._sync_chrome()

        def new_window(sender, args):
            deferral = args.GetDeferral()
            uri = str(args.Uri or "")

            def adopt(child: Tab):
                try:
                    args.NewWindow = child.core
                    args.Handled = True
                finally:
                    deferral.Complete()

            child = self._add_tab("", activate=True, on_ready=adopt)
            child.pending_url = None
            child.url = uri

        core.NavigationStarting += starting
        core.NavigationCompleted += completed
        core.DOMContentLoaded += dom_loaded
        core.SourceChanged += source
        core.DocumentTitleChanged += title
        core.HistoryChanged += lambda *_: self._sync_chrome()
        core.NewWindowRequested += new_window
        core.WindowCloseRequested += lambda *_: self._close_tab(tab.id)

    def _activate(self, tab: Tab) -> None:
        for other in self.tabs:
            other.view.Visible = other is tab
        self.active = tab
        self._sync_chrome()

    def _close_tab(self, tab_id: str) -> None:
        tab = next((t for t in self.tabs if t.id == tab_id), None)
        if not tab:
            return
        index = self.tabs.index(tab)
        self.tabs.remove(tab)
        self.content.Controls.Remove(tab.view)
        try:
            tab.view.Dispose()
        except Exception:  # noqa: BLE001
            pass
        if not self.tabs:
            self._add_tab(HOME_URL, activate=True)
        elif self.active is tab:
            self._activate(self.tabs[min(index, len(self.tabs) - 1)])
        self._sync_chrome()
        self._save_window_soon()

    def _navigate(self, tab: Optional[Tab], url: str) -> None:
        if tab is None:
            return
        if tab.core is None:
            tab.pending_url = url
            return
        tab.expect_navigation(url)
        if url == HOME_URL:
            tab.url = HOME_URL
            tab.title = "新标签页"
            tab.core.NavigateToString(self.pages.START_HTML)
        else:
            tab.core.Navigate(url)

    # ── window visibility ──
    def _show(self, focus: bool) -> None:
        if not self.form.Visible:
            if focus:
                self.form.Show()
            else:
                try:
                    import ctypes

                    ctypes.windll.user32.ShowWindow(ctypes.c_void_p(int(self.form.Handle.ToInt64())), 4)  # SW_SHOWNOACTIVATE
                    self.form.Visible = True
                except Exception:  # noqa: BLE001
                    self.form.Show()
        if self.form.WindowState == self.WinForms.FormWindowState.Minimized:
            self.form.WindowState = self.WinForms.FormWindowState.Normal
        if focus:
            self.form.Activate()

    def _hide(self) -> None:
        self._save_window()
        for tab in self.tabs:
            if tab.core is not None:
                try:
                    tab.core.ExecuteScriptAsync("document.querySelectorAll('video,audio').forEach(m=>{try{m.pause()}catch(e){}})")
                except Exception:  # noqa: BLE001
                    pass
        self.form.Hide()
        self.channel.send({"event": "hidden"})

    def _closing(self, sender, args) -> None:
        # The user's close button hides the window; the process stays so the
        # pages and logins are still there next time 碧琪 opens something.
        if args.CloseReason == self.WinForms.CloseReason.UserClosing and not self.user_closed:
            args.Cancel = True
            self._hide()

    # ── manager channel ──
    def _read_loop(self) -> None:
        try:
            for message in self.channel.lines():
                if "upreply" in message:
                    slot = self.upcalls.get(message["upreply"])
                    if slot:
                        slot["reply"] = message
                        slot["event"].set()
                elif message.get("push") == "vpn":
                    self.vpn_state = message.get("state") or {}
                    self._post_chrome({"type": "vpn", "state": self.vpn_state})
                elif message.get("action") == "cancel":
                    self.cancelled.add(str(message.get("requestId", "")))
                    self.channel.send({"id": message.get("id"), "ok": True, "result": {"cancelled": True}})
                elif message.get("action") == "quit":
                    break
                elif "action" in message:
                    threading.Thread(target=self._handle, args=(message,), daemon=True).start()
        finally:
            self.user_closed = True
            try:
                self._on_ui(self._save_window)
            except Exception:  # noqa: BLE001
                pass
            os._exit(0)

    def _handle(self, message: Dict[str, Any]) -> None:
        request_id = message.get("id")
        action = str(message.get("action", ""))
        timeout = min(30.0, max(1.0, float(message.get("timeoutMs") or 15000) / 1000))
        deadline = time.monotonic() + timeout
        agent = action not in ("status", "show")
        if agent:
            self.agent_busy += 1
            self._on_ui(self._sync_chrome, wait=False)
        try:
            result = self._perform(action, message, deadline)
            self.channel.send({"id": request_id, "ok": True, "result": result})
        except Exception as error:  # noqa: BLE001
            reason = str(error) or "浏览器操作没有完成，请重新观察页面后再试。"
            self.channel.send({"id": request_id, "ok": False, "reason": reason,
                               "mayHaveExecuted": action in OBSERVE_AFTER, "nextAction": "snapshot-before-retry"})
        finally:
            if agent:
                self.agent_busy = max(0, self.agent_busy - 1)
                self._on_ui(self._sync_chrome, wait=False)

    # ── actions ──
    def _status(self) -> Dict[str, Any]:
        def read():
            tab = self.active
            core = tab.core if tab else None
            url = tab.url if tab else ""
            return {
                "open": bool(self.form.Visible), "url": "" if url.startswith(("pinkie:", "about:", "data:")) else url,
                "title": tab.title if tab else "", "loading": bool(tab and tab.loading),
                "canGoBack": bool(core and core.CanGoBack), "canGoForward": bool(core and core.CanGoForward),
                "tabs": len(self.tabs), "proxied": bool(self.args.proxy_port),
                "capabilities": {"nativePointer": True, "setSlider": "native-range"},
            }
        return self._on_ui(read)

    def _ready_tab(self, deadline: float) -> Tab:
        tab = self._on_ui(lambda: self.active)
        if tab is None:
            raise RuntimeError("App 浏览器暂时不可用。")
        if not tab.ready.wait(max(0.1, deadline - time.monotonic())):
            raise RuntimeError("浏览器还没准备好，请稍后再试。")
        return tab

    def _perform(self, action: str, body: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        if action == "status":
            return self._status()
        if action == "show":
            self._on_ui(lambda: self._show(True))
            url = str(body.get("url") or "")
            if url:
                tab = self._ready_tab(deadline)
                self._on_ui(lambda: self._navigate(tab, url))
            return self._status()
        if action == "chrome_eval" and os.environ.get("PINKIE_INAPP_BROWSER_DEBUG") == "1":
            task = self._on_ui(lambda: self.chrome.CoreWebView2.ExecuteScriptAsync(str(body.get("js", ""))))
            return {"value": str(self._await(task, 5))}
        if action == "close":
            self._on_ui(self._hide)
            return {"open": False}
        if action in NAV_ACTIONS:
            return self._navigation(action, body, deadline)
        tab = self._ready_tab(deadline)
        if not self._on_ui(lambda: self.form.Visible):
            raise RuntimeError("请先用 open 打开 App 浏览器。")
        if action == "eval":
            url = self._on_ui(lambda: tab.url)
            if not local_page(url):
                raise RuntimeError("自定义脚本只允许在本机服务或家目录的文件页面运行。")
            script = body.get("js")
            if not isinstance(script, str) or not script.strip() or len(script.encode("utf-8")) > 128 * 1024:
                raise RuntimeError("脚本为空或过长。")
            raw = self._execute(tab, script, deadline)
            return {"value": json.loads(raw) if raw else None}
        if action == "screenshot":
            return self._screenshot(tab, body, deadline)
        if action == "wait" and not any(body.get(k) is not None for k in ("text", "selector", "ref", "name")):
            ms = min(15000, max(0, int(body.get("ms") or 0)))
            time.sleep(ms / 1000)
            return {"waitedMs": ms}
        if action == "wait":
            return self._wait(tab, body, deadline)
        if action in POINTER_ACTIONS or (action == "click" and (body.get("input") == "native" or body.get("x") is not None
                                                                 or body.get("button") is not None or body.get("clickCount") is not None)):
            result = self._pointer(tab, action, body, deadline)
        elif action == "press" and not any(body.get(k) for k in ("ref", "selector", "name")):
            result = self._press_native(tab, str(body.get("key", "")), deadline)
        elif action in DOM_ACTIONS:
            result = self._dom(tab, action, body, deadline)
        else:
            raise RuntimeError("不支持这个浏览器操作。")
        if action in OBSERVE_AFTER:
            time.sleep(0.15)
            if tab.loading:
                # The action started a navigation: observe the new page.
                tab.dom_event.wait(max(0.1, min(deadline - time.monotonic(), 8)))
            result["observation"] = self._observe(tab, deadline)
            result["page"] = self._page(tab)
        return result

    def _page(self, tab: Tab) -> Dict[str, Any]:
        return self._on_ui(lambda: {"url": "" if tab.url.startswith(("pinkie:", "about:", "data:")) else tab.url, "title": tab.title})

    def _navigation(self, action: str, body: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        focus = bool(body.get("focus", False))
        if action in ("open", "show_file"):
            if action == "open":
                url = str(body.get("url") or "").strip()
                lowered = url.lower()
                if lowered.startswith("file:"):
                    from urllib.parse import unquote, urlsplit

                    url = safe_home_file(unquote(urlsplit(url).path.lstrip("/"))).as_uri()
                elif not lowered.startswith(("http://", "https://")) and lowered != "about:blank":
                    raise RuntimeError("网址无效，请填写完整的 http(s) 网址。")
            else:
                url = safe_home_file(str(body.get("path", ""))).as_uri()
            self._on_ui(lambda: self._show(focus))
            tab = self._on_ui(lambda: self.active)
            if tab is None:
                raise RuntimeError("App 浏览器暂时不可用。")
            # Before the tab is ready this replaces its start page instead of racing it.
            self._on_ui(lambda: self._navigate(tab, url))
            tab = self._ready_tab(deadline)
        else:
            tab = self._ready_tab(deadline)
            if not self._on_ui(lambda: self.form.Visible):
                raise RuntimeError("请先用 open 打开 App 浏览器。")

            def go():
                core = tab.core
                if action == "back":
                    if not core.CanGoBack:
                        return False
                    tab.expect_navigation()
                    core.GoBack()
                elif action == "forward":
                    if not core.CanGoForward:
                        return False
                    tab.expect_navigation()
                    core.GoForward()
                else:
                    tab.expect_navigation()
                    core.Reload()
                return True

            if not self._on_ui(go):
                raise RuntimeError("没有可以" + ("后退" if action == "back" else "前进") + "的页面。")
        event = tab.nav_event if body.get("waitUntil") == "load" else tab.dom_event
        if not event.wait(max(0.1, deadline - time.monotonic())):
            raise RuntimeError("网页加载超时，请先观察页面确认结果。")
        if tab.nav_event.is_set() and not tab.nav_ok:
            hint = "；浏览器节点已开启，可能是当前节点不通，可在浏览器右上角「节点」里换一个" if self.args.proxy_port else ""
            raise RuntimeError(f"网页没有打开（{tab.nav_error}）{hint}。")
        result = self._page(tab)
        result["page"] = dict(result)
        result["observation"] = self._observe(tab, deadline)
        return result

    def _execute(self, tab: Tab, script: str, deadline: float) -> str:
        task = self._on_ui(lambda: tab.core.ExecuteScriptAsync(script))
        return str(self._await(task, max(0.5, deadline - time.monotonic())) or "")

    def _run_control(self, tab: Tab, params: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        if not self.control_js:
            raise RuntimeError("浏览器控制脚本缺失，请重新安装。")
        clean = {k: v for k, v in params.items() if k not in ("token", "timeoutMs", "id")}
        script = self.control_js + "\n globalThis.__pinkieBrowserControl.run(" + json.dumps(clean, ensure_ascii=False) + ");"
        raw = self._execute(tab, script, deadline)
        try:
            value = json.loads(raw) if raw else {}
        except ValueError:
            value = {}
        return value if isinstance(value, dict) else {}

    def _retrying(self, tab: Tab, params: Dict[str, Any], deadline: float, request_id: str = "") -> Dict[str, Any]:
        while True:
            if request_id and request_id in self.cancelled:
                raise RuntimeError("浏览器操作已取消；请重新观察页面确认已完成的部分。")
            value = self._run_control(tab, params, deadline)
            if value.get("reason") and value.get("retryable") and time.monotonic() + 0.1 < deadline:
                time.sleep(0.08)
                continue
            return value

    def _observe(self, tab: Tab, deadline: float) -> Dict[str, Any]:
        try:
            return self._run_control(tab, {"action": "snapshot", "compact": True}, min(deadline + 3, time.monotonic() + 5))
        except Exception:  # noqa: BLE001
            return {}

    def _dom(self, tab: Tab, action: str, body: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        params = dict(body)
        params["action"] = action
        value = self._retrying(tab, params, deadline, str(body.get("id", "")))
        if value.get("reason"):
            raise RuntimeError(value["reason"])
        return value

    def _wait(self, tab: Tab, body: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        params = dict(body)
        params["action"] = "wait"
        while True:
            value = self._run_control(tab, params, deadline)
            if value.get("reason") and not value.get("retryable"):
                raise RuntimeError(value["reason"])
            if value.get("matched"):
                return {"matched": True}
            if time.monotonic() + 0.15 >= deadline:
                raise RuntimeError("等待的内容没有出现，请先观察页面。")
            time.sleep(0.12)

    def _cdp(self, tab: Tab, method: str, params: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        payload = json.dumps(params)
        task = self._on_ui(lambda: tab.core.CallDevToolsProtocolMethodAsync(method, payload))
        raw = self._await(task, max(0.5, deadline - time.monotonic()))
        return json.loads(str(raw)) if raw else {}

    def _mouse(self, tab: Tab, kind: str, x: float, y: float, deadline: float, button: str = "left", count: int = 1) -> None:
        params = {"type": kind, "x": float(x), "y": float(y), "button": button if kind != "mouseMoved" else "none",
                  "clickCount": count if kind != "mouseMoved" else 0}
        if kind == "mouseMoved" and button and button != "none":
            params["button"] = "none"
        self._cdp(tab, "Input.dispatchMouseEvent", params, deadline)

    def _pointer(self, tab: Tab, action: str, body: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        operation = {"move": "move", "hover": "hover", "drag": "drag", "set_slider": "set_slider"}.get(action, "click")
        params = dict(body)
        params.update({"action": "pointer-plan", "operation": operation})
        has_target = any(body.get(k) for k in ("ref", "selector", "name", "role"))
        if not has_target and body.get("x") is not None and body.get("y") is not None and action in ("click", "move", "hover"):
            plan = {"x": float(body["x"]), "y": float(body["y"])}
        else:
            plan = self._retrying(tab, params, deadline, str(body.get("id", "")))
            if plan.get("reason"):
                raise RuntimeError(plan["reason"])
        x, y = plan["x"], plan["y"]
        button = str(body.get("button") or "left")
        if action in ("move", "hover"):
            self._mouse(tab, "mouseMoved", x, y, deadline)
            return {"moved": True, "x": x, "y": y, **({"ref": plan["ref"]} if plan.get("ref") else {})}
        if action == "click":
            count = max(1, min(3, int(body.get("clickCount") or 1)))
            self._mouse(tab, "mouseMoved", x, y, deadline)
            for index in range(1, count + 1):
                self._mouse(tab, "mousePressed", x, y, deadline, button, index)
                self._mouse(tab, "mouseReleased", x, y, deadline, button, index)
            return {"clicked": True, "x": x, "y": y, "input": "native", **({"ref": plan["ref"]} if plan.get("ref") else {})}
        to = plan.get("to") or {}
        if "x" not in to:
            raise RuntimeError("拖拽终点无效。")
        self._mouse(tab, "mouseMoved", x, y, deadline)
        self._mouse(tab, "mousePressed", x, y, deadline)
        steps = 12
        for i in range(1, steps + 1):
            self._mouse(tab, "mouseMoved", x + (to["x"] - x) * i / steps, y + (to["y"] - y) * i / steps, deadline, "left")
            time.sleep(0.01)
        self._mouse(tab, "mouseReleased", to["x"], to["y"], deadline)
        if action == "set_slider":
            slider = plan.get("slider") or {}
            check = self._run_control(tab, {"action": "slider-value", "ref": plan.get("ref")}, deadline).get("slider") or {}
            if abs(float(check.get("value", 0)) - float(slider.get("target", 0))) > float(slider.get("tolerance", 0.5)):
                raise RuntimeError(f"滑杆停在 {check.get('value')}，没有到 {slider.get('target')}；请重新观察后再试。")
            return {"slider": check, "ref": plan.get("ref")}
        return {"dragged": True, "from": {"x": x, "y": y}, "to": {"x": to["x"], "y": to["y"]}}

    def _press_native(self, tab: Tab, key: str, deadline: float) -> Dict[str, Any]:
        keys = {"Enter": (13, "\r"), "Escape": (27, ""), "Tab": (9, ""), "ArrowLeft": (37, ""), "ArrowUp": (38, ""),
                "ArrowRight": (39, ""), "ArrowDown": (40, "")}
        if key not in keys:
            raise RuntimeError("只支持回车、退出、制表和方向键。")
        code, text = keys[key]
        down = {"type": "keyDown" if text else "rawKeyDown", "key": key, "code": key, "windowsVirtualKeyCode": code}
        if text:
            down["text"] = text
        self._cdp(tab, "Input.dispatchKeyEvent", down, deadline)
        self._cdp(tab, "Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": key, "windowsVirtualKeyCode": code}, deadline)
        return {"pressed": key}

    def _screenshot(self, tab: Tab, body: Dict[str, Any], deadline: float) -> Dict[str, Any]:
        full = bool(body.get("fullPage"))
        value = self._cdp(tab, "Page.captureScreenshot", {"format": "png", "captureBeyondViewport": full, "fromSurface": True}, deadline)
        data = base64.b64decode(value.get("data") or "")
        if not data:
            raise RuntimeError("浏览器截图失败，请稍后再试。")
        folder = self.state_dir / "screenshots"
        folder.mkdir(parents=True, exist_ok=True)
        old = sorted(folder.glob("*.png"), key=lambda p: p.stat().st_mtime)
        for stale in old[:-40]:
            try:
                stale.unlink()
            except OSError:
                pass
        path = folder / (uuid.uuid4().hex + ".png")
        path.write_bytes(data)
        width, height = png_size(data)
        metrics = self._execute(tab, "JSON.stringify({width:innerWidth,height:innerHeight})", deadline)
        try:
            viewport = json.loads(json.loads(metrics)) if metrics else {}
        except (ValueError, TypeError):
            viewport = {}
        return {"path": str(path), "width": width, "height": height,
                "coordinateSpace": "document-image" if full else "viewport-css", "viewport": viewport, "message": "用 image 工具查看"}


if __name__ == "__main__":
    run()
