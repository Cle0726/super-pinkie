"""NativeBridge and attachment/notification helpers for the Windows WebView2 shell."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import uuid
import webbrowser

if "_PINKIE_DESKTOP_PART" not in globals():
    try:
        from inapp_browser import InAppBrowserBridge
    except ImportError:  # imported as app.windows_bridge (tests)
        from app.inapp_browser import InAppBrowserBridge
    try:
        from windows_bridge_scripts import BRIDGE_SCRIPT
    except ImportError:  # imported as app.windows_bridge (tests)
        from app.windows_bridge_scripts import BRIDGE_SCRIPT
    try:
        from windows_elevated import RESIZE_EDGES
    except ImportError:  # imported as app.windows_bridge (tests)
        from app.windows_elevated import RESIZE_EDGES

    PARTY_URL = "http://127.0.0.1:18889/"
    ROUNDTABLE_URL = "http://127.0.0.1:18891/"
    DEFAULT_APP_DOCUMENT_EXTENSIONS = frozenset({
        "pdf", "txt", "md", "markdown", "rtf", "csv", "tsv", "json", "log",
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub",
        "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "svg", "psd", "ai",
        "mp4", "mov", "m4v", "webm", "mkv", "avi", "mp3", "m4a", "wav", "aac", "flac",
        "srt", "ass", "vtt", "zip",
    })

    def _desktop():
        module = sys.modules.get("app.windows_desktop") or sys.modules.get("windows_desktop")
        if module is not None:
            return module
        try:
            import windows_desktop as module
        except ImportError:  # imported as app.windows_bridge (tests)
            from app import windows_desktop as module
        return module

    def append_log(*args, **kwargs): return _desktop().append_log(*args, **kwargs)
    def configure_native_corners(*args, **kwargs): return _desktop().configure_native_corners(*args, **kwargs)
    def configure_native_glass(*args, **kwargs): return _desktop().configure_native_glass(*args, **kwargs)
    def follow_native_resize(*args, **kwargs): return _desktop().follow_native_resize(*args, **kwargs)
    def gateway_ui_url(*args, **kwargs): return _desktop().gateway_ui_url(*args, **kwargs)
    def hidden_process_kwargs(*args, **kwargs): return _desktop().hidden_process_kwargs(*args, **kwargs)
    def state_root(*args, **kwargs): return _desktop().state_root(*args, **kwargs)


def _describe_material(path: Path):
    """Read-only file metadata for the chat's material list.

    Mac asks its native preview for the same facts; Windows reports them from
    the filesystem and, for images and PDFs, the header alone. Nothing here
    opens the document with a renderer or touches the file's contents beyond
    the bytes needed for width/height/page count.
    """
    import mimetypes

    try:
        stat = path.stat()
    except OSError as error:
        return {"ok": False, "message": str(error)}
    suffix = path.suffix.lower()
    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    info = {
        "ok": True,
        "name": path.name,
        "path": str(path),
        "kind": suffix.lstrip("."),
        "size": stat.st_size,
        "mimeType": mime_type,
        "modified": int(stat.st_mtime),
    }
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}:
        try:
            info.update(_image_dimensions(path, suffix))
        except Exception:
            pass
    if suffix == ".pdf":
        # Page count needs the page tree, and compressed object streams hide it
        # from a byte scan. Only report a number when the whole file was read and
        # the count is non-zero; otherwise say nothing rather than a wrong figure.
        try:
            if stat.st_size <= 64 * 1024 * 1024:
                with open(path, "rb") as handle:
                    whole = handle.read()
                # /Type /Page but not /Type /Pages, which is the tree node.
                pages = len(re.findall(rb"/Type\s*/Page(?![s\w])", whole))
                if pages:
                    info["pages"] = pages
        except OSError:
            pass
    if suffix in {".txt", ".md", ".csv", ".json", ".py", ".js", ".mjs", ".ts", ".log", ".html", ".css", ".yaml", ".yml"}:
        # A partial read would undercount a long file, so only claim a line count
        # for files small enough to read completely.
        try:
            if stat.st_size <= 8 * 1024 * 1024:
                with open(path, "rb") as handle:
                    whole = handle.read()
                info["lines"] = whole.count(b"\n") + (0 if whole.endswith(b"\n") or not whole else 1)
        except OSError:
            pass
    return info


def _image_dimensions(path: Path, suffix: str):
    """Width/height from the file header only; no image decoder involved."""
    import struct

    with open(path, "rb") as handle:
        head = handle.read(32)
        if suffix == ".png" and head[:8] == b"\x89PNG\r\n\x1a\n":
            width, height = struct.unpack(">II", head[16:24])
            return {"width": width, "height": height}
        if suffix in {".jpg", ".jpeg"} and head[:2] == b"\xff\xd8":
            with open(path, "rb") as handle:
                handle.read(2)
                while True:
                    marker = handle.read(2)
                    if len(marker) < 2 or marker[0] != 0xFF:
                        break
                    length_bytes = handle.read(2)
                    if len(length_bytes) < 2:
                        break
                    length = struct.unpack(">H", length_bytes)[0]
                    if marker[1] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        data = handle.read(5)
                        height, width = struct.unpack(">HH", data[1:5])
                        return {"width": width, "height": height}
                    handle.seek(length - 2, 1)
        if suffix == ".gif" and head[:6] in (b"GIF87a", b"GIF89a"):
            width, height = struct.unpack("<HH", head[6:10])
            return {"width": width, "height": height}
        if suffix == ".bmp" and head[:2] == b"BM":
            width, height = struct.unpack("<ii", head[18:26])
            return {"width": abs(width), "height": abs(height)}
    return {}


def run_notify_fields(payload):
    """Clamp a run-notify payload from the page to (title, body, sessionKey)."""
    data = payload if isinstance(payload, dict) else {}
    title = str(data.get("title") or "").strip()[:80] or "超級碧琪"
    body = str(data.get("body") or "").strip()[:200]
    session_key = str(data.get("sessionKey") or "").strip()[:300]
    return title, body, session_key


class NativeBridge(InAppBrowserBridge):
    def __init__(self, updater):
        # pywebview recursively exposes public js_api attributes. Keeping a
        # public reference to Window makes it walk Window.native/WebView2 COM
        # objects, producing thousands of cross-thread errors and sometimes
        # freezing startup. Private fields are intentionally not exported.
        self._updater = updater
        self._window = None
        self._gateway = None
        self.maximized = False
        self._resize_lock = threading.Lock()
        self._resize_active = False
        self.fullscreen = False
        self._dock_window = None
        self._dock_opening = False
        self._dock_lock = threading.RLock()
        self.appearance_dark = False
        self.reduce_motion = False
        self._computer = None
        self.dictation_stop = threading.Event()
        self.dictation_thread = None
        self.dictation_text = ""

    def attach(self, window):
        self._window = window

    def _pinkie_native(self):
        native = getattr(self, "_native_bridge", None)
        if native is None:
            # The frozen App puts app/ on the module path (build-win.ps1
            # --paths app); there is no `app` package in it. Importing only
            # `app.windows_native` left the packaged build without the tray
            # icon, global hotkey, notifications and exports
            # (native.log: ModuleNotFoundError).
            try:
                from windows_native import WindowsNative
            except ImportError:  # imported as app.windows_desktop (tests)
                from app.windows_native import WindowsNative

            native = self._native_bridge = WindowsNative(self, state_root() / "native-settings.json")
        return native

    def pinkieNative(self, message):  # noqa: N802 - same name as the Mac handler (PLAN §8)
        try:
            return self._pinkie_native().handle(message)
        except Exception as error:  # the page always gets an answer
            append_log("native", f"pinkieNative failed: {type(error).__name__}")
            return {"ok": False, "error": "原生端出错了"}

    def open_chat(self):
        self._window.load_url(gateway_ui_url())

    def open_party(self):
        self._window.load_url(PARTY_URL)

    def open_roundtable(self):
        self._window.load_url(ROUNDTABLE_URL)

    def project_folder(self, payload):
        payload = payload if isinstance(payload, dict) else {}
        request_id = str(payload.get("requestId", ""))
        if payload.get("action") == "reveal":
            path = Path(str(payload.get("path", "")))
            if path.is_dir():
                subprocess.Popen(["explorer.exe", str(path)], **hidden_process_kwargs(hide_window=False))
            return {"requestId": request_id, "cancelled": not path.is_dir()}
        if payload.get("action") != "choose":
            return {"requestId": request_id, "cancelled": True}
        import webview

        initial = Path(str(payload.get("path", "")))
        directory = str(initial if initial.is_dir() else Path.home())
        selected = self._window.create_file_dialog(
            webview.FOLDER_DIALOG, directory=directory, allow_multiple=False
        )
        if not selected:
            return {"requestId": request_id, "cancelled": True}
        path = Path(selected[0]).resolve()
        return {
            "requestId": request_id,
            "cancelled": False,
            "path": str(path),
            "name": path.name,
        }

    def preview_material(self, payload):
        """Open, copy, reveal or preview one file after a visible user click.

        The bridge checks the canonical path on every action. Preview bytes
        stay in WebView2 as a data URL; this does not change agent permissions.
        """
        payload = payload if isinstance(payload, dict) else {}
        action = str(payload.get("action", "open"))
        path = Path(str(payload.get("path", ""))).expanduser()
        try:
            path = path.resolve(strict=True)
            home = Path.home().resolve(strict=True)
            relative = path.relative_to(home)
        except (OSError, ValueError):
            return {"ok": False, "message": "只能打开用户主目录里的现有文件，且不能越过符号链接。"}
        if not path.is_file():
            return {"ok": False, "message": "这里只能打开文件，不能打开文件夹。"}
        parts = [part.casefold() for part in relative.parts]
        is_openclaw_workspace = (
            len(parts) >= 2
            and parts[0] == ".openclaw"
            and (parts[1] == "workspace" or parts[1].startswith("workspace-"))
        )
        if (
            parts[0] == ".ssh"
            or len(parts) >= 2 and parts[:2] == ["library", "keychains"]
            or parts[0] == ".openclaw" and not is_openclaw_workspace
        ):
            return {"ok": False, "message": "这个位置包含密钥或 C.le. 配置，不能从聊天里打开。"}
        if action == "check":
            try:
                return {"ok": True, "name": path.name, "size": path.stat().st_size}
            except OSError:
                return {"ok": True, "name": path.name}

        if action == "describe":
            return _describe_material(path)

        if action == "save":
            try:
                downloads = Path.home() / "Downloads"
                downloads.mkdir(parents=True, exist_ok=True)
                base = path.name
                stem, suffix = path.stem, path.suffix
                destination = downloads / base
                index = 1
                while destination.exists():
                    index += 1
                    destination = downloads / f"{stem} ({index}){suffix}"
                shutil.copy2(path, destination)
                return {"ok": True, "path": str(destination)}
            except OSError:
                return {"ok": False, "message": "保存到下载文件夹失败，请检查磁盘空间和文件权限。"}
        if action == "reveal":
            try:
                subprocess.Popen(["explorer.exe", "/select,", str(path)], **hidden_process_kwargs(hide_window=False))
                return {"ok": True}
            except OSError:
                return {"ok": False, "message": "无法在文件夹中显示这个文件。"}
        if action == "open-default":
            # Paths come from model output; only hand documents to their viewers,
            # never scripts, installers or executables.
            if path.suffix.lower().lstrip(".") not in DEFAULT_APP_DOCUMENT_EXTENSIONS:
                return {"ok": False, "message": "为了安全，这类文件不直接打开；可以在文件夹中显示后自己处理。"}
            try:
                os.startfile(str(path))
                return {"ok": True}
            except OSError:
                return {"ok": False, "message": "Windows 没有找到能打开这个文件的应用。"}

        suffix = path.suffix.lower()
        mime_types = {
            ".pdf": "application/pdf",
            ".html": "text/html", ".htm": "text/html",
            ".png": "image/png",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp",
            ".avif": "image/avif", ".bmp": "image/bmp",
            ".tif": "image/tiff", ".tiff": "image/tiff",
            ".heic": "image/heic", ".heif": "image/heic",
            ".svg": "image/svg+xml",
            ".mp4": "video/mp4", ".mov": "video/quicktime",
            ".m4v": "video/x-m4v", ".webm": "video/webm",
            ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
        }
        text_extensions = {
            ".md", ".markdown", ".txt", ".text", ".log", ".csv", ".tsv",
            ".json", ".yaml", ".yml", ".xml", ".toml", ".ini", ".conf",
            ".swift", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
            ".css", ".scss", ".sh", ".bash", ".zsh", ".c", ".h", ".cpp",
            ".hpp", ".rs", ".go", ".java", ".kt", ".rb", ".php", ".sql",
            ".diff", ".patch", ".plist",
        }
        if suffix in text_extensions:
            mime_types[suffix] = "text/plain"
        mime_type = mime_types.get(suffix)
        if not mime_type:
            return {"ok": False, "message": "暂时无法预览这种文件。"}
        try:
            size = path.stat().st_size
            kind_limit = 128 if suffix in {".mp4", ".mov", ".m4v", ".webm", ".mp3", ".m4a", ".wav"} else 64
            if size > kind_limit * 1024 * 1024:
                return {"ok": False, "message": f"这个文件超过 {kind_limit} MB，Windows 版暂时不能直接预览。"}
            content = path.read_bytes()
            if suffix in {".html", ".htm"}:
                # Data URLs have no response headers. Put a restrictive CSP
                # before the selected document so it cannot fetch local or
                # remote resources while it runs in the sandboxed frame.
                content = (
                    b'<!doctype html><meta http-equiv="Content-Security-Policy" '
                    b'content="default-src \'none\'; img-src data: blob:; media-src data: blob:; '
                    b"style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; "
                    b"form-action 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'\">"
                    + content
                )
            encoded = base64.b64encode(content).decode("ascii")
            return {
                "ok": True,
                "src": f"data:{mime_type};base64,{encoded}",
                "mimeType": mime_type,
            }
        except OSError:
            return {"ok": False, "message": "读取这个材料时出了点问题，请再试一次。"}

    def _browser_proxy_paths(self):
        config_name = os.environ.get("OPENCLAW_CONFIG_PATH")
        config = Path(config_name) if config_name else Path.home() / ".openclaw" / "openclaw.json"
        return config, state_root()

    def browser_proxy_get(self):
        import browser_proxy

        config, state = self._browser_proxy_paths()
        try:
            return {"ok": True, **browser_proxy.apply(config, state)}
        except (OSError, ValueError) as error:
            return {"ok": False, "message": str(error), **browser_proxy.status(browser_proxy.load_setting(state))}

    def browser_proxy_set(self, payload):
        import browser_proxy

        payload = payload if isinstance(payload, dict) else {}
        config, state = self._browser_proxy_paths()
        try:
            result = browser_proxy.apply(config, state, {"mode": payload.get("mode"), "server": payload.get("server")})
        except (OSError, ValueError) as error:
            return {"ok": False, "message": str(error)}
        append_log("launcher", f"browser proxy set: {result['effective']}")
        return {"ok": True, "message": "已保存。碧琪下次打开浏览器时生效；浏览器已经开着的话，关掉重开一次。", **result}

    # ── FanVPN：把节点挂到用户自己的浏览器上 ──────────────────────
    #
    # 和上面 browser_proxy_* 的区别要说清楚，两者不是一回事：
    #   browser_proxy  -> 只给 OpenClaw 单独启动的那个浏览器实例加
    #                     --proxy-server，用户自己双击打开的浏览器不受影响
    #   fanvpn_*       -> 写 WinINET 系统代理 + PAC，用户双击 Chrome /
    #                     Edge / Firefox 就默认走节点
    #
    # 所以这两个开关可以同时存在，互不覆盖。但都指向本机不同端口时，
    # 用户会看到两套代理并行，UI 上要分开呈现。

    def fanvpn_status(self):
        try:
            from fanvpn_bridge import get_bridge

            return get_bridge().status()
        except Exception as error:  # noqa: BLE001 - 状态查询永远不能抛给前端
            append_log("launcher", f"fanvpn status failed: {error}")
            return {"ok": False, "running": False, "enabled": False, "error": str(error)}

    def fanvpn_start(self, payload=None):
        payload = payload if isinstance(payload, dict) else {}
        try:
            from fanvpn_bridge import get_bridge

            bridge = get_bridge()
            result = bridge.start(enable_system_proxy=bool(payload.get("enableSystemProxy", True)))
            append_log("launcher", f"fanvpn start: running={result.get('running')} enabled={result.get('enabled')}")
            return result
        except Exception as error:  # noqa: BLE001
            append_log("launcher", f"fanvpn start failed: {error}")
            return {"ok": False, "running": False, "enabled": False, "error": str(error)}

    def fanvpn_stop(self):
        try:
            from fanvpn_bridge import get_bridge

            result = get_bridge().stop()
            append_log("launcher", "fanvpn stopped, system proxy restored")
            return result
        except Exception as error:  # noqa: BLE001
            append_log("launcher", f"fanvpn stop failed: {error}")
            return {"ok": False, "running": False, "enabled": False, "error": str(error)}

    def fanvpn_enable_browser_proxy(self, payload=None):
        payload = payload if isinstance(payload, dict) else {}
        method = str(payload.get("method") or "pac")
        try:
            from fanvpn_bridge import get_bridge

            result = get_bridge().enable_browser_proxy(method)
            append_log("launcher", f"fanvpn browser proxy on ({method})")
            return result
        except Exception as error:  # noqa: BLE001
            append_log("launcher", f"fanvpn enable failed: {error}")
            return {"ok": False, "error": str(error)}

    def fanvpn_disable_browser_proxy(self):
        try:
            from fanvpn_bridge import get_bridge

            result = get_bridge().disable_browser_proxy()
            append_log("launcher", "fanvpn browser proxy off, settings restored")
            return result
        except Exception as error:  # noqa: BLE001
            append_log("launcher", f"fanvpn disable failed: {error}")
            return {"ok": False, "error": str(error)}

    def fanvpn_select_node(self, payload=None):
        payload = payload if isinstance(payload, dict) else {}
        try:
            from fanvpn_bridge import get_bridge

            return get_bridge().select_node(str(payload.get("server", "")), int(payload.get("port", 0)))
        except (TypeError, ValueError) as error:
            return {"ok": False, "error": f"节点参数不对: {error}"}
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "error": str(error)}

    def fanvpn_refresh_nodes(self):
        try:
            from fanvpn_bridge import get_bridge

            return get_bridge().refresh_nodes()
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "error": str(error)}

    def open_external(self, url):
        if isinstance(url, str) and url.startswith(("https://", "http://")):
            webbrowser.open(url)

    def _dictation_update(self, state, transcript=None, message=None):
        payload = {"state": state}
        if transcript is not None:
            payload["transcript"] = transcript
        if message:
            payload["message"] = message
        try:
            self._window.evaluate_js(
                "window.__laolaoNativeDictationUpdate?.(" + json.dumps(payload, ensure_ascii=False) + ")"
            )
        except Exception:
            pass

    def start_dictation(self):
        if self.dictation_thread and self.dictation_thread.is_alive():
            return
        self.dictation_stop.clear()
        self.dictation_text = ""

        def listen():
            try:
                import pythoncom
                import win32com.client

                pythoncom.CoInitialize()
                recognizer = win32com.client.Dispatch("SAPI.SpSharedRecognizer")
                context = recognizer.CreateRecoContext()
                bridge = self

                class SpeechEvents:
                    def OnRecognition(self, _stream_number, _stream_position, _recognition_type, result):
                        text = str(result.PhraseInfo.GetText() or "").strip()
                        if text:
                            bridge.dictation_text += text
                            bridge._dictation_update("recording", bridge.dictation_text)

                # Keep the COM event sink alive for the whole recording. If it
                # is collected, SAPI keeps listening but no text reaches the UI.
                events = win32com.client.WithEvents(context, SpeechEvents)
                grammar = context.CreateGrammar()
                grammar.DictationLoad()
                grammar.DictationSetState(1)
                self._dictation_update("recording")
                while not self.dictation_stop.wait(.05):
                    pythoncom.PumpWaitingMessages()
                grammar.DictationSetState(0)
                _ = events
                self._dictation_update("idle", self.dictation_text)
            except Exception as error:
                self._dictation_update("error", self.dictation_text, f"语音识别没有启动：{error}")
            finally:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass

        self.dictation_thread = threading.Thread(target=listen, name="pinkie-dictation", daemon=True)
        self.dictation_thread.start()

    def stop_dictation(self):
        self.dictation_stop.set()

    def minimize(self):
        self._window.minimize()

    # ---- 计划书 B 第三节：页面看不到时的提醒（laolao-run-notify.js 调用） ----

    def request_attention(self, kind=None):
        """Flash the taskbar button until the window comes back to the front."""
        handle = self._native_window_handle()
        if not handle:
            return False
        try:
            import ctypes
            from ctypes import wintypes

            class FlashInfo(ctypes.Structure):
                _fields_ = [("cbSize", wintypes.UINT), ("hwnd", wintypes.HWND), ("dwFlags", wintypes.DWORD),
                            ("uCount", wintypes.UINT), ("dwTimeout", wintypes.DWORD)]

            user32 = ctypes.WinDLL("user32", use_last_error=True)
            if user32.GetForegroundWindow() == handle:
                return False
            # FLASHW_TRAY | FLASHW_TIMERNOFG: only the taskbar button, until the user comes back.
            info = FlashInfo(ctypes.sizeof(FlashInfo), handle, 0x2 | 0xC, 0, 0)
            user32.FlashWindowEx(ctypes.byref(info))
            return True
        except (AttributeError, OSError, TypeError, ValueError):
            return False

    def notify(self, payload=None):
        """Show one Windows notification; clicking it opens that session."""
        title, body, session_key = run_notify_fields(payload)
        if os.name != "nt" or not self._window:
            return False
        try:
            from System import Action
            native = self._window.native
            native.Invoke(Action(lambda: self._show_run_notification(title, body, session_key)))
            return True
        except Exception as error:  # pythonnet raises .NET exceptions here
            append_log("launcher", f"run notify failed: {type(error).__name__}")
            return False

    def _show_run_notification(self, title, body, session_key):
        import sys as _sys
        from System.Drawing import Icon, SystemIcons
        from System.Windows.Forms import NotifyIcon, ToolTipIcon

        icon = getattr(self, "_run_notify_icon", None)
        if icon is None:
            icon = NotifyIcon()
            try:
                icon.Icon = Icon.ExtractAssociatedIcon(_sys.executable)
            except Exception:
                icon.Icon = SystemIcons.Application
            icon.Text = "超級碧琪"
            icon.BalloonTipClicked += lambda *_: self._open_run_session()
            icon.BalloonTipClosed += lambda *_: setattr(icon, "Visible", False)
            self._run_notify_icon = icon
        self._run_notify_session = session_key
        icon.Visible = True
        icon.ShowBalloonTip(8000, title, body or " ", ToolTipIcon.Info)

    def _open_run_session(self):
        icon = getattr(self, "_run_notify_icon", None)
        if icon is not None:
            icon.Visible = False
        window = self._window
        if not window:
            return
        try:
            window.restore()
            window.show()
            handle = self._native_window_handle()
            if handle:
                import ctypes
                ctypes.windll.user32.SetForegroundWindow(handle)
        except Exception:
            pass
        key = getattr(self, "_run_notify_session", "")
        if key:
            window.evaluate_js("window.__laolaoSidebar?.navigateSession?.(" + json.dumps(key) + ")")

    def _native_window_handle(self):
        """Return the Win32 HWND exposed by pywebview's WinForms backend."""
        if os.name != "nt" or not self._window:
            return None
        try:
            handle = self._window.native.Handle
            return int(handle.ToInt64()) if hasattr(handle, "ToInt64") else int(handle)
        except (AttributeError, TypeError, ValueError):
            return None

    def _begin_nonclient_action(self, hit_test):
        """Hand the current pointer gesture to Windows for native drag/resize."""
        handle = self._native_window_handle()
        if not handle:
            return False
        try:
            import ctypes

            user32 = ctypes.windll.user32
            user32.ReleaseCapture()
            user32.SendMessageW(handle, 0x00A1, int(hit_test), 0)
            return True
        except (AttributeError, OSError, TypeError, ValueError):
            return False

    def begin_resize(self, direction):
        """Resize the borderless window by following the pointer ourselves.

        pywebview's frameless WinForms host has no WS_THICKFRAME, and
        DefWindowProc ignores SC_SIZE (what WM_NCLBUTTONDOWN + HTLEFT..
        HTBOTTOMRIGHT turns into) for such a window. The old hand-off to
        Windows therefore returned True and nothing moved. Track the cursor
        while the button stays down and move the edges with SetWindowPos.
        """
        edge = str(direction).lower()
        if edge not in RESIZE_EDGES or self.maximized:
            return False
        handle = self._native_window_handle()
        if not handle:
            return False
        with self._resize_lock:
            if self._resize_active:
                return True
            self._resize_active = True
        def run():
            try:
                follow_native_resize(handle, edge)
            except Exception as error:
                append_log("launcher", f"window resize failed: {error}")
            finally:
                with self._resize_lock:
                    self._resize_active = False
        threading.Thread(target=run, name="pinkie-resize", daemon=True).start()
        return True

    def toggle_maximize(self):
        previous = self.maximized
        target = not previous
        # Set the optimistic target before asking the host to change state.
        # The native event may arrive synchronously: flipping the value after
        # maximize()/restore() can then undo that event and break the next click.
        self.maximized = target
        try:
            if target:
                self._window.maximize()
            else:
                self._window.restore()
        except Exception:
            self.maximized = previous
            raise
        return {"maximized": self.maximized}

    def toggle_fullscreen(self):
        """Mac's ⌃⌘F equivalent, done with the Win32 call that actually exists.

        pywebview ships Window.toggle_fullscreen, but its Windows backend does
        not implement it: the call lands on a GUI method EdgeChrome never
        defines, so relying on it would raise AttributeError and leave the
        button doing nothing. ShowWindow(SW_MAXIMIZE) plus removing the resize
        frame is what a frameless window needs here. The borderless window is
        frameless already, so maximising fills the work area and the caption
        chrome keeps working -- there is no separate fullscreen state to lose
        sync with.
        """
        handle = self._native_window_handle()
        if not handle:
            return {"fullscreen": bool(getattr(self, "fullscreen", False))}
        try:
            import ctypes

            user32 = ctypes.windll.user32
            target = not getattr(self, "fullscreen", False)
            # SW_MAXIMIZE restores the pre-maximise frame when SW_RESTORE is used.
            user32.ShowWindow(ctypes.c_void_p(handle), 3 if target else 9)
            self.fullscreen = target
            return {"fullscreen": self.fullscreen}
        except Exception as error:
            append_log("launcher", f"toggle_fullscreen failed: {error}")
            return {"fullscreen": bool(getattr(self, "fullscreen", False))}

    def apply_appearance(self, payload=None):
        """Follow the web UI's night switch on the native window.

        Windows keeps one dark window chrome; matching Mac means the title area,
        caption buttons and scrollbar tint follow the page instead of staying
        light. DwmSetWindowAttribute's immersive-dark flag is what Explorer and
        WinUI apps use, and it is ignored on Windows 10, which stays correct.
        """
        payload = payload if isinstance(payload, dict) else {}
        dark = bool(payload.get("dark"))
        self.appearance_dark = dark
        if self._window is None:
            return {"dark": dark}
        try:
            import ctypes

            handle = self._native_window_handle()
            if handle:
                value = ctypes.c_int32(1 if dark else 0)
                # Declare the signature: an undeclared HWND argument is truncated
                # to a C int on 64-bit, which silently targets the wrong window.
                setter = ctypes.windll.dwmapi.DwmSetWindowAttribute
                setter.argtypes = [
                    ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32
                ]
                setter.restype = ctypes.c_int32
                # 20 = DWMWA_USE_IMMERSIVE_DARK_MODE (19 before Windows 10 2004).
                for attribute in (20, 19):
                    result = setter(ctypes.c_void_p(handle), attribute, ctypes.byref(value), ctypes.sizeof(value))
                    if result == 0:
                        break
        except Exception as error:
            append_log("launcher", f"appearance sync skipped: {error}")
        return {"dark": dark}

    # ── 分屏工作区 ──
    # The Mac shell hosts a second WKWebView beside the primary one. Windows
    # did not have that shell, so the dock button quietly disappeared. A
    # separate window that shares the same gateway session is the honest
    # equivalent here: independent scroll, independent mode, no overlay
    # covering the primary chat, and the real 退出分屏 control the page draws.
    WORKSPACE_SESSIONS = {
        "chat": "agent:main:main",
        "project": "agent:project:main",
        "thinking": "agent:thinking:main",
        "learning": "agent:learning:main",
        "unrestricted": "agent:unrestricted:main",
        "metre": "agent:metre:main",
    }

    def _dock_url(self, mode, session_key):
        session = session_key or self.WORKSPACE_SESSIONS.get(mode, "")
        if not session:
            return ""
        base = gateway_ui_url()
        separator = "&" if "?" in base else "?"
        params = urllib.parse.urlencode({"session": session, "laolao-dock": "1"})
        return f"{base}{separator}{params}"

    def _primary_mode(self):
        try:
            url = urllib.parse.urlparse(str(self._window.get_current_url() or ""))
            query = urllib.parse.parse_qs(url.query)
            session = (query.get("session") or [""])[0]
            for mode, key in self.WORKSPACE_SESSIONS.items():
                if key == session:
                    return mode
        except Exception:
            pass
        return "project"

    def open_workspace_dock(self, payload=None):
        """Open (or refocus) the companion chat that the split control asks for."""
        payload = payload if isinstance(payload, dict) else {}
        mode = str(payload.get("mode") or "")
        if mode not in self.WORKSPACE_SESSIONS:
            return {"ok": False, "message": "这个模式不能分屏"}
        if mode == self._primary_mode():
            return {"ok": False, "message": "左右两侧不能是同一个模式"}
        target = self._dock_url(mode, str(payload.get("sessionKey") or ""))
        if not target:
            return {"ok": False, "message": "这个模式还没有可用的会话"}
        with self._dock_lock:
            dock = self._dock_window
            if dock is not None:
                try:
                    dock.load_url(target)
                    dock.show()
                    self._notify_dock_state()
                    return {"ok": True, "reused": True}
                except Exception as error:
                    append_log("launcher", f"dock reuse failed: {error}")
                    self._dock_window = None
            # Claim the slot before the worker starts. Two quick clicks used to
            # both see None here and open two companion windows.
            if self._dock_opening:
                return {"ok": True, "pending": True}
            self._dock_opening = True
        threading.Thread(target=self._create_dock_window, args=(target,), name="pinkie-dock", daemon=True).start()
        return {"ok": True}

    def _create_dock_window(self, target):
        import webview

        try:
            dock = webview.create_window(
                "分屏工作区", target, width=620, height=760, min_size=(420, 420),
                frameless=True, easy_drag=False, shadow=False, background_color="#000000",
                transparent=True,
                # The companion page draws the same 退出分屏 control as the
                # primary one; without js_api that click has nowhere to go.
                js_api=self,
            )
        except Exception as error:
            append_log("launcher", f"dock window failed: {error}")
            with self._dock_lock:
                self._dock_opening = False
            return
        with self._dock_lock:
            self._dock_opening = False
        self._dock_window = dock
        dock.events.closed += self._dock_closed
        dock.events.loaded += self._dock_loaded

        # The companion is frameless and transparent like the primary window,
        # so it needs the same DWM glass treatment. Without it WebView2 paints
        # an opaque rectangle where the primary window shows the desktop.
        def dress(*_):
            for label, configure in (("glass", configure_native_glass), ("corners", configure_native_corners)):
                try:
                    configure(dock)
                except Exception as error:
                    append_log("launcher", f"dock {label} setup failed: {error}")

        dock.events.before_show += dress
        try:
            dock.evaluate_js(BRIDGE_SCRIPT)
        except Exception as error:
            append_log("launcher", f"dock bridge injection skipped: {error}")
        self._notify_dock_state()

    def _dock_loaded(self, *_):
        try:
            self._dock_window.evaluate_js(BRIDGE_SCRIPT)
        except Exception:
            pass

    def _dock_closed(self, *_):
        self._dock_window = None
        self._notify_dock_state()

    def close_workspace_dock(self, payload=None):
        with self._dock_lock:
            dock = self._dock_window
            self._dock_window = None
            self._dock_opening = False
        if dock is not None:
            try:
                dock.destroy()
            except Exception as error:
                append_log("launcher", f"dock close failed: {error}")
        self._notify_dock_state()
        return {"ok": True}

    def _notify_dock_state(self):
        window = self._window
        if window is None:
            return
        state = {"open": self._dock_window is not None}
        try:
            window.evaluate_js(
                "window.__pinkieWorkspaceDockState?.(" + json.dumps(state) + ")"
            )
        except Exception:
            pass

    def apply_motion_preference(self, payload=None):
        """Keep the native shell's own animations on the same switch as the page.

        The web UI owns the preference; the shell only needs to know about it so
        its chrome does not keep animating when the user asked for calmer motion.
        """
        payload = payload if isinstance(payload, dict) else {}
        self.reduce_motion = bool(payload.get("reduce"))
        return {"reduce": self.reduce_motion}

    def window_close(self):
        self._window.destroy()

    def control_center(self):
        subprocess.Popen([sys.executable, "--control-center"], **hidden_process_kwargs(hide_window=False))

    def check_for_updates(self, route=None):
        return self._updater.check(force=True, route="mirror" if route == "mirror" else None)

    def prepare_update(self, route=None):
        try:
            def progress(event):
                if self._window:
                    self._window.evaluate_js("window.__pinkieUpdateProgress?.(" + json.dumps(event) + ")")
            return self._updater.prepare(progress=progress, route="mirror" if route == "mirror" else None)
        except Exception as error:
            append_log("updater", f"update preparation failed: {error}")
            return {"available": True, "ready": False, "temporaryError": True, "message": "新版下载没有完成，稍后再点一次就会重试"}

    def apply_update(self):
        result = self._updater.launch_replacer()
        if not result.get("started") and result.get("elevate") and self._ask_elevated_install():
            result = self._updater.launch_replacer(elevated=True)
        if result.get("started"):
            threading.Timer(.6, self._window.destroy).start()
        return result

    def _ask_elevated_install(self):
        """The install folder refused our write test: offer the UAC route."""
        try:
            import ctypes
            owner = self._native_window_handle() or None
            answer = ctypes.windll.user32.MessageBoxW(
                owner,
                "碧琪装在一个需要管理员权限才能改动的文件夹里，普通方式换不了新版。\n\n"
                "点「是」后 Windows 会询问一次管理员权限，然后自动换好并重新打开碧琪。",
                "超級碧琪更新", 0x4 | 0x20 | 0x40000)  # MB_YESNO | MB_ICONQUESTION | MB_TOPMOST
            return answer == 6  # IDYES
        except Exception as error:
            append_log("updater", f"elevation prompt failed: {error}")
            return False

    # ---- startup page (file://): shown when the gateway is not up after ~60 s
    def startup_status(self):
        gateway = self._gateway
        return {"notice": getattr(gateway, "notice", "") or "",
                "exits": int(getattr(gateway, "exits", 0) or 0),
                "version": getattr(self._updater, "current_version", "")}

    def startup_repair(self):
        gateway = self._gateway
        if gateway is None:
            return {"ok": False, "message": "本机网关还没有开始启动，请稍等"}
        append_log("launcher", "startup page: user asked to repair settings")
        result = gateway.repair_config(force=True)
        if not (gateway.process and gateway.process.poll() is None):
            gateway.reset_backoff()  # B44: a user-asked restart must not wait out the backoff
            gateway.start()
        message = result.get("message") or "已经重新启动本机网关"
        if result.get("step") == "none":
            message = "设置文件没有发现问题，已经重新启动本机网关。还是不行的话，点「检查更新并安装」"
        return {"ok": bool(result.get("repaired")) or result.get("step") == "none", "message": message}

    def startup_update(self):
        append_log("launcher", "startup page: user asked to check and install an update")
        try:
            info = self._updater.check(force=True)
        except Exception as error:
            append_log("updater", f"startup update check failed: {error}")
            info = {"available": False, "message": "检查更新没有成功"}
        if info.get("error") or info.get("temporaryError"):
            try:
                info = self._updater.check(force=True, route="mirror")
            except Exception:
                pass
        if not info.get("available"):
            return {"ok": False, "stage": "none",
                    "message": info.get("message") or "已经是最新版。可以先点「自动修复设置」，或者打开日志文件夹把记录发给我们"}
        prepared = self.prepare_update(route=info.get("route"))
        if not prepared.get("ready"):
            return {"ok": False, "stage": "download", "message": prepared.get("message") or "新版下载没有完成，稍后再点一次"}
        applied = self.apply_update()
        if not applied.get("started"):
            return {"ok": False, "stage": "install", "message": applied.get("message") or "新版没有开始安装"}
        return {"ok": True, "stage": "install", "message": "新版已经下载好，窗口会关上，换好后自动打开"}

    def open_logs(self):
        folder = state_root() / "logs"
        folder.mkdir(parents=True, exist_ok=True)
        try:
            subprocess.Popen(["explorer.exe", str(folder)], **hidden_process_kwargs(hide_window=False))
        except OSError as error:
            return {"ok": False, "message": str(error)}
        return {"ok": True, "path": str(folder)}
