"""PLAN §8 native bridge on Windows (same messages as the Mac PinkieNative.swift).

- N1 notifications: tray balloon (shown as a system toast on Windows 10/11);
  a click opens that session.
- N2 tray icon with the same menu as the Mac menu bar.
- N3 global hotkey (RegisterHotKey on the tray thread) + a small on-top
  quick-ask window.
- H2 export: Edge (always present on Windows 10/11) in headless mode prints
  the page's export HTML to PDF or a long PNG; then the save dialog.
- W3 reveal/open a file.

Everything Win32 lives on one tray thread: RegisterHotKey and Shell_NotifyIcon
belong to the thread that owns the hidden message window, so other threads
post commands to it instead of calling Win32 directly.
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

WM_APP = 0x8000
WM_TRAY = WM_APP + 1
WM_COMMAND_QUEUE = WM_APP + 2
WM_HOTKEY = 0x0312
WM_COMMAND = 0x0111
WM_LBUTTONUP = 0x0202
WM_RBUTTONUP = 0x0205
WM_CONTEXTMENU = 0x007B
NIN_BALLOONUSERCLICK = 0x0405
NIM_ADD, NIM_MODIFY, NIM_DELETE, NIM_SETVERSION = 0, 1, 2, 4
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 0x1, 0x2, 0x4, 0x10
NIIF_INFO = 0x1
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN, MOD_NOREPEAT = 0x1, 0x2, 0x4, 0x8, 0x4000
HOTKEY_ID = 0x504B
DEFAULT_HOTKEY = "Ctrl+Alt+Space"
MENU_NEW, MENU_QUICK, MENU_OPEN, MENU_SETTINGS, MENU_QUIT = 1, 2, 3, 4, 5
MENU_RUNNING_BASE = 100

QUICK_HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font:16px system-ui,'Microsoft YaHei UI'}
form{display:flex;align-items:center;gap:12px;height:100%;box-sizing:border-box;padding:0 16px;
border:1px solid rgba(217,81,141,.35);border-radius:14px;background:#fff8fb;box-shadow:0 12px 32px rgba(80,30,55,.22)}
b{color:#d9518d;font-size:12px;white-space:nowrap}
input{flex:1;border:0;outline:0;background:transparent;font-size:18px;color:#3d2232}
</style></head><body><form id="f"><b id="m">碧琪</b><input id="q" placeholder="问碧琪…" autofocus></form><script>
const q=document.getElementById('q');
window.addEventListener('pywebviewready',()=>{pywebview.api.mode().then(m=>{document.getElementById('m').textContent=m||'碧琪'});q.focus();});
document.getElementById('f').onsubmit=e=>{e.preventDefault();const t=q.value.trim();if(t)pywebview.api.submit(t);};
addEventListener('keydown',e=>{if(e.key==='Escape')pywebview.api.close();});
</script></body></html>"""


def parse_accelerator(raw):
    """'Ctrl+Alt+Space' → (modifiers, virtual key) or None."""
    parts = [part.strip().lower() for part in str(raw or "").split("+") if part.strip()]
    if len(parts) < 2:
        return None
    modifiers = 0
    for part in parts[:-1]:
        flag = {"alt": MOD_ALT, "option": MOD_ALT, "ctrl": MOD_CONTROL, "control": MOD_CONTROL,
                "shift": MOD_SHIFT, "win": MOD_WIN, "cmd": MOD_WIN, "meta": MOD_WIN}.get(part)
        if flag is None:
            return None
        modifiers |= flag
    key = parts[-1]
    if key == "space":
        vk = 0x20
    elif key in ("enter", "return"):
        vk = 0x0D
    elif len(key) == 1 and key.isalnum():
        vk = ord(key.upper())
    else:
        return None
    return modifiers | MOD_NOREPEAT, vk


def safe_file_name(raw, ext):
    name = str(raw or "").strip()
    for bad in '<>:"/\\|?*':
        name = name.replace(bad, "-")
    name = name.strip(". ") or "碧琪会话"
    if not name.lower().endswith("." + ext):
        name += "." + ext
    return name[:180]


def write_markdown_export(target, markdown, assets, placeholder="__assets__"):
    """H2: write the .md and copy images into `<stem>-附件/` beside it."""
    from urllib.parse import quote

    try:
        usable = [(str(item.get("name")), str(item.get("path"))) for item in assets
                  if isinstance(item, dict) and item.get("name") and item.get("path")
                  and "/" not in str(item.get("name")) and "\\" not in str(item.get("name"))
                  and not str(item.get("name")).startswith(".")]
        if usable:
            folder_name = target.stem + "-附件"
            markdown = markdown.replace("./" + placeholder + "/", "./" + quote(folder_name) + "/")
            folder = target.parent / folder_name
            folder.mkdir(parents=True, exist_ok=True)
            for name, source in usable:
                try:
                    shutil.copyfile(source, folder / name)
                except OSError:
                    pass
        target.write_text(markdown, encoding="utf-8")
        return {"ok": True, "path": str(target)}
    except OSError as error:
        return {"ok": False, "error": f"保存失败：{error}"}


def find_edge():
    candidates = []
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            candidates.append(Path(base) / "Microsoft/Edge/Application/msedge.exe")
    found = shutil.which("msedge")
    if found:
        candidates.insert(0, Path(found))
    return next((path for path in candidates if path.is_file()), None)


def edge_export_command(edge, html_file, out_file, pdf, width=900, height=1200):
    url = Path(html_file).resolve().as_uri()
    base = [str(edge), "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
            "--hide-scrollbars", f"--user-data-dir={Path(out_file).parent / 'edge-profile'}"]
    if pdf:
        return base + ["--no-pdf-header-footer", f"--print-to-pdf={out_file}", url]
    return base + [f"--window-size={int(width)},{int(height)}", f"--screenshot={out_file}", url]


class QuickAskApi:
    def __init__(self, native):
        self._native = native

    def mode(self):
        return self._native.mode_label

    def submit(self, text):
        self._native.quick_submit(str(text or ""))

    def close(self):
        self._native.quick_close()


class WindowsNative:
    def __init__(self, bridge, settings_file=None):
        self._bridge = bridge          # NativeBridge: owns the main pywebview window
        self._settings_file = Path(settings_file) if settings_file else None
        self._commands = queue.Queue()
        self._thread = None
        self._hwnd = None
        self._icon = None
        self._icon_added = False
        self._menubar = True
        self._hotkey = DEFAULT_HOTKEY
        self._notified = []
        self._last_click_session = ""
        self._running = []
        self.mode = "chat"
        self.mode_label = "唠嗑"
        self._quick = None
        self._load_settings()

    # ---------- settings ----------
    def _load_settings(self):
        try:
            data = json.loads(self._settings_file.read_text(encoding="utf-8")) if self._settings_file else {}
        except (OSError, ValueError):
            data = {}
        self._menubar = data.get("menubar", True) is not False
        hotkey = data.get("hotkey", DEFAULT_HOTKEY)
        self._hotkey = hotkey if hotkey is None or parse_accelerator(hotkey) else DEFAULT_HOTKEY

    def _save_settings(self):
        if not self._settings_file:
            return
        try:
            self._settings_file.parent.mkdir(parents=True, exist_ok=True)
            temp = self._settings_file.with_suffix(".tmp")
            temp.write_text(json.dumps({"menubar": self._menubar, "hotkey": self._hotkey}), encoding="utf-8")
            os.replace(temp, self._settings_file)
        except OSError:
            pass

    # ---------- page → native ----------
    def handle(self, message):
        message = message if isinstance(message, dict) else {}
        kind = str(message.get("type", ""))
        if kind == "notify":
            return self.notify(message)
        if kind == "notifyPermission":
            return {"granted": True}
        if kind in ("exportPDF", "exportImage"):
            return self.export(message, pdf=kind == "exportPDF")
        if kind == "exportMarkdown":
            return self.export_markdown(message)
        if kind in ("revealFile", "openFile"):
            return self.open_path(str(message.get("path", "")), reveal=kind == "revealFile")
        if kind == "setMenubar":
            self._menubar = message.get("enabled", True) is not False
            self._save_settings()
            self._post("menubar")
            return {"ok": True}
        if kind == "setHotkey":
            return self.set_hotkey(message.get("accelerator"))
        if kind == "context":
            self.mode = str(message.get("mode") or self.mode)
            self.mode_label = str(message.get("modeLabel") or self.mode_label)
            items = message.get("running") if isinstance(message.get("running"), list) else []
            self._running = [(str(item.get("key")), str(item.get("title") or "未命名会话"))
                             for item in items[:20] if isinstance(item, dict) and item.get("key")]
            return {"ok": True}
        return {"ok": False, "error": "不认识的原生请求"}

    def emit(self, detail):
        window = getattr(self._bridge, "_window", None)
        if window is None:
            return
        script = "window.dispatchEvent(new CustomEvent('pinkie-native',{detail:" + json.dumps(detail, ensure_ascii=False) + "}))"
        try:
            window.evaluate_js(script)
        except Exception:
            pass

    def show_main(self):
        window = getattr(self._bridge, "_window", None)
        for name in ("restore", "show"):
            try:
                getattr(window, name)()
            except Exception:
                pass

    # ---------- N1 ----------
    def notify(self, message):
        run_id = str(message.get("id") or "")
        session = str(message.get("sessionKey") or "")
        if not run_id or not session or run_id in self._notified:
            return {"ok": True, "skipped": True}
        self._notified = (self._notified + [run_id])[-200:]
        self._last_click_session = session
        title = str(message.get("title") or "碧琪")[:63]
        body = str(message.get("body") or "")[:255]
        self._post("balloon", (title, body))
        return {"ok": True}

    # ---------- W3 ----------
    @staticmethod
    def open_path(raw, reveal):
        path = Path(os.path.expanduser(raw or ""))
        if not raw or not path.exists():
            return {"ok": False, "error": "文件不在了"}
        if reveal:
            subprocess.Popen(["explorer.exe", "/select,", str(path)])
        else:
            os.startfile(str(path))  # noqa: S606 - user clicked 打开 on their own file
        return {"ok": True}

    # ---------- H2 ----------
    def export(self, message, pdf):
        html = message.get("html")
        if not isinstance(html, str) or not html:
            return {"ok": False, "error": "没有可导出的内容"}
        edge = find_edge()
        if not edge:
            return {"ok": False, "error": "没找到 Edge，导出不了 PDF 或长图"}
        ext = "pdf" if pdf else "png"
        name = safe_file_name(message.get("fileName"), ext)
        work = Path(tempfile.mkdtemp(prefix="pinkie-export-"))
        try:
            source = work / "export.html"
            source.write_text(html, encoding="utf-8")
            out = work / ("out." + ext)
            height = max(400, min(int(message.get("height") or 1200), 16000))
            command = edge_export_command(edge, source, out, pdf, int(message.get("width") or 900), height)
            subprocess.run(command, timeout=90, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if not out.is_file() or out.stat().st_size == 0:
                return {"ok": False, "error": ("PDF" if pdf else "长图") + "没生成出来"}
            target = self._ask_save(name, ext)
            if not target:
                return {"ok": False, "cancelled": True}
            shutil.copyfile(out, target)
            return {"ok": True, "path": str(target)}
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            return {"ok": False, "error": f"导出失败：{error}"}
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def export_markdown(self, message):
        markdown = message.get("markdown")
        if not isinstance(markdown, str) or not markdown:
            return {"ok": False, "error": "没有可导出的内容"}
        target = self._ask_save(safe_file_name(message.get("fileName"), "md"), "md")
        if not target:
            return {"ok": False, "cancelled": True}
        return write_markdown_export(Path(target), markdown, message.get("assets") or [],
                                     str(message.get("assetDir") or "__assets__"))

    def _ask_save(self, name, ext):
        override = os.environ.get("PINKIE_EXPORT_DIR")
        if override:
            return Path(override) / name
        import webview

        window = getattr(self._bridge, "_window", None)
        chosen = window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name,
                                           file_types=(f"{ext.upper()} (*.{ext})",))
        if not chosen:
            return None
        return Path(chosen if isinstance(chosen, str) else chosen[0])

    # ---------- N3 ----------
    def set_hotkey(self, accelerator):
        if not accelerator:
            self._hotkey = None
            self._save_settings()
            self._post("hotkey")
            return {"ok": True, "accelerator": None}
        if not parse_accelerator(accelerator):
            return {"ok": False, "error": "这个快捷键写法不认识"}
        result = self._call("hotkey_try", accelerator)
        if result is True:
            self._hotkey = accelerator
            self._save_settings()
            return {"ok": True, "accelerator": accelerator}
        if accelerator != DEFAULT_HOTKEY and self._call("hotkey_try", DEFAULT_HOTKEY) is True:
            self._hotkey = DEFAULT_HOTKEY
            self._save_settings()
            return {"ok": True, "conflict": True, "accelerator": DEFAULT_HOTKEY}
        return {"ok": False, "conflict": True, "error": "这个快捷键被别的程序占用了"}

    def quick_open(self):
        if self._quick is not None:
            try:
                self._quick.show()
                return
            except Exception:
                self._quick = None
        import webview

        self._quick = webview.create_window("快速提问", html=QUICK_HTML, js_api=QuickAskApi(self), width=560, height=64,
                                            frameless=True, on_top=True, easy_drag=True, resizable=False)

    def quick_close(self):
        quick, self._quick = self._quick, None
        if quick is not None:
            try:
                quick.destroy()
            except Exception:
                pass

    def quick_submit(self, text):
        text = text.strip()
        if not text:
            return
        self.quick_close()
        self.show_main()
        self.emit({"type": "quickAsk", "mode": self.mode, "text": text})

    # ---------- tray thread ----------
    def start(self):
        if os.name != "nt" or self._thread is not None:
            return
        ready = threading.Event()
        self._thread = threading.Thread(target=self._tray_main, args=(ready,), name="pinkie-tray", daemon=True)
        self._thread.start()
        ready.wait(5)

    def stop(self):
        """Take the tray icon away and end the tray thread (the app is quitting).

        Without this the icon stays in the notification area after the process
        is gone, until the pointer moves over it -- it looks like 碧琪 is still
        running.
        """
        if self._hwnd is None:
            return
        self._call("stop", timeout=2)

    def _post(self, command, payload=None):
        self._commands.put((command, payload, None))
        self._wake()

    def _call(self, command, payload=None, timeout=5):
        if self._hwnd is None:
            return None
        done = queue.Queue(maxsize=1)
        self._commands.put((command, payload, done))
        self._wake()
        try:
            return done.get(timeout=timeout)
        except queue.Empty:
            return None

    def _wake(self):
        if self._hwnd is None:
            return
        import ctypes

        from ctypes import wintypes

        post = ctypes.windll.user32.PostMessageW
        post.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        post(self._hwnd, WM_COMMAND_QUEUE, 0, 0)

    def _tray_main(self, ready):  # pragma: no cover - Win32 only
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        shell32 = ctypes.WinDLL("shell32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        LRESULT = ctypes.c_ssize_t
        WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
        user32.DefWindowProcW.restype = LRESULT
        user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        # Handles are pointer-sized; the ctypes int default would truncate them on 64-bit.
        user32.CreatePopupMenu.restype = wintypes.HMENU
        user32.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
        user32.TrackPopupMenu.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, ctypes.c_void_p]
        user32.DestroyMenu.argtypes = [wintypes.HMENU]
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                           ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p]
        user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
        user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.LoadIconW.restype = wintypes.HICON
        user32.LoadIconW.argtypes = [wintypes.HINSTANCE, ctypes.c_void_p]
        kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        shell32.ExtractIconW.restype = wintypes.HICON
        shell32.ExtractIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT]

        class GUID(ctypes.Structure):
            _fields_ = [("a", ctypes.c_ulong), ("b", ctypes.c_ushort), ("c", ctypes.c_ushort), ("d", ctypes.c_ubyte * 8)]

        class NOTIFYICONDATAW(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uID", wintypes.UINT),
                        ("uFlags", wintypes.UINT), ("uCallbackMessage", wintypes.UINT), ("hIcon", wintypes.HICON),
                        ("szTip", ctypes.c_wchar * 128), ("dwState", wintypes.DWORD), ("dwStateMask", wintypes.DWORD),
                        ("szInfo", ctypes.c_wchar * 256), ("uVersion", wintypes.UINT), ("szInfoTitle", ctypes.c_wchar * 64),
                        ("dwInfoFlags", wintypes.DWORD), ("guidItem", GUID), ("hBalloonIcon", wintypes.HICON)]

        class WNDCLASSW(ctypes.Structure):
            _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                        ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
                        ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
                        ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR)]

        class POINT(ctypes.Structure):
            _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]

        def icon_data(flags):
            data = NOTIFYICONDATAW()
            data.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
            data.hWnd = self._hwnd
            data.uID = 1
            data.uFlags = flags
            data.uCallbackMessage = WM_TRAY
            data.hIcon = self._icon
            data.szTip = "碧琪"
            return data

        def add_icon():
            if self._icon_added:
                return
            data = icon_data(NIF_MESSAGE | NIF_ICON | NIF_TIP)
            if shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(data)):
                data.uVersion = 4
                shell32.Shell_NotifyIconW(NIM_SETVERSION, ctypes.byref(data))
                self._icon_added = True

        def remove_icon():
            if self._icon_added:
                shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(icon_data(0)))
                self._icon_added = False

        def balloon(title, body):
            add_icon()
            data = icon_data(NIF_INFO)
            data.szInfoTitle = title[:63]
            data.szInfo = body[:255]
            data.dwInfoFlags = NIIF_INFO
            shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(data))
            if not self._menubar:
                # The balloon needs an icon; hide it again once the toast is in the action center.
                threading.Timer(12, lambda: self._post("menubar")).start()

        def register(accelerator):
            user32.UnregisterHotKey(self._hwnd, HOTKEY_ID)
            parsed = parse_accelerator(accelerator) if accelerator else None
            return bool(parsed and user32.RegisterHotKey(self._hwnd, HOTKEY_ID, parsed[0], parsed[1]))

        def show_menu():
            menu = user32.CreatePopupMenu()
            running = user32.CreatePopupMenu()
            user32.AppendMenuW(menu, 0, MENU_NEW, "新会话")
            user32.AppendMenuW(menu, 0, MENU_QUICK, "快速提问…")
            user32.AppendMenuW(menu, 0, MENU_OPEN, "打开碧琪")
            user32.AppendMenuW(menu, 0x800, 0, None)
            for index, (_key, title) in enumerate(self._running):
                user32.AppendMenuW(running, 0, MENU_RUNNING_BASE + index, title[:60])
            user32.AppendMenuW(menu, 0x10 | (0 if self._running else 0x1), running, f"正在运行 {len(self._running)} 个")
            user32.AppendMenuW(menu, 0x800, 0, None)
            user32.AppendMenuW(menu, 0, MENU_SETTINGS, "设置")
            user32.AppendMenuW(menu, 0, MENU_QUIT, "退出碧琪")
            point = POINT()
            user32.GetCursorPos(ctypes.byref(point))
            user32.SetForegroundWindow(self._hwnd)
            user32.TrackPopupMenu(menu, 0, point.x, point.y, 0, self._hwnd, None)
            user32.DestroyMenu(menu)

        def on_command(command_id):
            if command_id == MENU_NEW:
                self.show_main(); self.emit({"type": "newSession"})
            elif command_id == MENU_QUICK:
                threading.Thread(target=self.quick_open, daemon=True).start()
            elif command_id == MENU_OPEN:
                self.show_main()
            elif command_id == MENU_SETTINGS:
                self.show_main(); self.emit({"type": "openSettings"})
            elif command_id == MENU_QUIT:
                window = getattr(self._bridge, "_window", None)
                try:
                    window.destroy()
                except Exception:
                    os._exit(0)
            elif command_id >= MENU_RUNNING_BASE and command_id - MENU_RUNNING_BASE < len(self._running):
                self.show_main(); self.emit({"type": "openSession", "sessionKey": self._running[command_id - MENU_RUNNING_BASE][0]})

        def drain():
            while True:
                try:
                    command, payload, done = self._commands.get_nowait()
                except queue.Empty:
                    return
                result = None
                if command == "balloon":
                    balloon(*payload)
                elif command == "menubar":
                    add_icon() if self._menubar else remove_icon()
                elif command == "hotkey":
                    result = register(self._hotkey)
                elif command == "hotkey_try":
                    result = register(payload)
                    if not result and self._hotkey and self._hotkey != payload:
                        register(self._hotkey)
                elif command == "stop":
                    remove_icon()
                    user32.PostQuitMessage(0)
                if done is not None:
                    done.put(result)

        def wndproc(hwnd, message, wparam, lparam):
            try:
                if message == WM_COMMAND_QUEUE:
                    drain(); return 0
                if message == WM_HOTKEY and wparam == HOTKEY_ID:
                    threading.Thread(target=self.quick_open, daemon=True).start(); return 0
                if message == WM_COMMAND:
                    on_command(wparam & 0xFFFF); return 0
                if message == WM_TRAY:
                    event = lparam & 0xFFFF
                    if event in (WM_RBUTTONUP, WM_CONTEXTMENU, WM_LBUTTONUP):
                        show_menu()
                    elif event == NIN_BALLOONUSERCLICK and self._last_click_session:
                        self.show_main(); self.emit({"type": "openSession", "sessionKey": self._last_click_session})
                    return 0
            except Exception:
                return 0
            return user32.DefWindowProcW(hwnd, message, wparam, lparam)

        self._wndproc = WNDPROC(wndproc)
        instance = kernel32.GetModuleHandleW(None)
        klass = WNDCLASSW()
        klass.lpfnWndProc = self._wndproc
        klass.hInstance = instance
        klass.lpszClassName = "PinkieTrayWindow"
        user32.RegisterClassW(ctypes.byref(klass))
        self._hwnd = user32.CreateWindowExW(0, "PinkieTrayWindow", "碧琪", 0, 0, 0, 0, 0, None, None, instance, None)
        self._icon = shell32.ExtractIconW(instance, sys_executable(), 0) or user32.LoadIconW(None, ctypes.c_void_p(32512))
        if self._menubar:
            add_icon()
        if self._hotkey:
            register(self._hotkey)
        ready.set()
        message = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
        remove_icon()


def sys_executable():
    import sys

    return sys.executable
