"""作品装成桌面上的独立应用 -- Windows 这一半（任务-官方新功能五项-1125 第 1 项，PR①）。

网关（services/mode-architecture/desktop-apps.mjs）已经把作品拷进
<PINKIE_STATE_ROOT 或 %LOCALAPPDATA%\\SuperPinkie>\\apps\\<appId>\\index.html，
并在 apps\\index.json 里记了名字。这里只做三件事：

* 入口：开始菜单「碧琪应用」文件夹和桌面各放一个 .lnk，指向
  超級碧琪.exe --app-window <appId>，图标用作品的 icon.ico（没有就用碧琪的）。
  建了哪些 .lnk 记在 apps\\shortcuts.json，卸载按这份删，不去猜路径；重装改了名字时旧的先删。
* 窗口：--app-window 起一个只显示这件作品的 WebView2 窗口，不起网关、不开碧琪主界面，
  有自己的任务栏分组（AppUserModelID）和自己的浏览数据目录（在 apps\\<appId>\\ 下，卸载一起删）。
* 页面 → 原生：installApp / uninstallApp / openApp 三个请求，由 windows_native.WindowsNative.handle 转过来。

不联网靠网关插进页面的 CSP；联网 / 读文件的勾选和更新是 PR② 的事。
"""

from __future__ import annotations

import json
import os
import re
import posixpath
import stat
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

APP_KINDS = {"installApp", "uninstallApp", "openApp"}
APP_ID = re.compile(r"^w[0-9a-f]{15}$")
START_MENU_FOLDER = "碧琪应用"
WINDOW_SIZE = (1100, 760)

# B139: a work's title comes from apps\index.json (written by the gateway, not
# checked here) and is used to reach IShellLinkW/IPersistFile as one filename
# component, not free text. '/' or '\\' in the title makes Path() treat it as
# separators -- with enough '../' segments the .lnk write escapes the intended
# Start Menu / Desktop folder; the other characters below make Save() fail
# with ERROR_INVALID_NAME; a bare trailing '.' or ' ' is silently stripped by
# Windows itself and can make two differently-named apps collide on one file.
_UNSAFE_SHORTCUT_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_MAX_SHORTCUT_NAME = 120  # keeps folder + name comfortably under MAX_PATH


def _safe_shortcut_name(name):
    """`name` made safe as a single Windows file-name component for a .lnk."""
    cleaned = _UNSAFE_SHORTCUT_CHARS.sub("_", str(name or "")).strip(" .")
    cleaned = cleaned[:_MAX_SHORTCUT_NAME].strip(" .")
    return cleaned or "作品"


def state_root():
    configured = os.environ.get("PINKIE_STATE_ROOT")
    if configured:
        return Path(configured)
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData/Local")
    return Path(base) / "SuperPinkie"


def apps_root():
    return state_root() / "apps"


def _read_json(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def read_app(app_id, root=None):
    """The gateway's record for one installed app, or None. The id is checked
    before it touches a path, so a page cannot point us outside apps\\."""
    app_id = str(app_id or "")
    if not APP_ID.match(app_id):
        return None
    root = Path(root) if root else apps_root()
    app = _read_json(root / "index.json").get("apps", {}).get(app_id)
    if not isinstance(app, dict) or not (root / app_id / "index.html").is_file():
        return None
    network = [str(origin) for origin in app.get("network") or [] if isinstance(origin, str)]
    return {"id": app_id, "name": str(app.get("name") or "作品"), "dir": root / app_id, "network": network}


# B10：跟 macOS AppWindow.swift 的 decidePolicyFor、网关 #188 的页面守卫同一条规矩，在原生这一层再拦一次——
# 页面脚本被绕过（或作品在守卫前就跳走）时，WebView2 自己也不放行。
# about / data / blob 放行；http / https 只放装的时候勾过的来源（默认端口 443 / 80 算同一个）；
# file: 只能留在这件作品自己的文件夹里（<id>x\ 这种前缀相同的兄弟文件夹不算）；其他一律取消。
_DEFAULT_PORTS = {"http": 80, "https": 443}


def _origin(url):
    try:
        parts = urlsplit(str(url))
        scheme, host, port = parts.scheme.lower(), (parts.hostname or "").lower(), parts.port
    except ValueError:
        return None
    if scheme not in _DEFAULT_PORTS or not host:
        return None
    return f"{scheme}://{host}" + ("" if port in (None, _DEFAULT_PORTS[scheme]) else f":{port}")


def _file_path(url):
    """Normalized path of a file: URL (or of a folder's as_uri()), comparable across both."""
    parts = urlsplit(str(url))
    if parts.scheme.lower() != "file" or parts.netloc.lower() not in ("", "localhost"):
        return None
    path = posixpath.normpath(unquote(parts.path))
    return path.lower() if os.name == "nt" else path


def _app_folders(directory):
    """The work's folder in both spellings a file: URL may use.

    run() opens (app["dir"] / "index.html").as_uri() without resolving it, and
    WebView2 reports that URL as given. Comparing it only with the resolved
    folder blocked the work's own page whenever %LOCALAPPDATA% or
    PINKIE_STATE_ROOT runs through a junction or symlink (a profile moved to
    D:\\ and linked back), and on a mapped drive resolve() turns Z:\\ into
    \\\\server\\share, a file: URL with a host, so every page was refused.
    """
    folders = []
    for spell in (Path.absolute, Path.resolve):
        try:
            folder = _file_path(spell(Path(directory)).as_uri())
        except (OSError, ValueError):
            continue
        if folder and folder not in folders:
            folders.append(folder)
    return folders


def navigation_allowed(url, app):
    url = str(url or "")
    scheme = urlsplit(url).scheme.lower() if ":" in url else ""
    if scheme in ("about", "data", "blob"):
        return True
    if scheme in _DEFAULT_PORTS:
        ticked = {_origin(origin) for origin in app.get("network") or []}
        target = _origin(url)
        return target is not None and target in ticked
    if scheme == "file":
        target = _file_path(url)
        return bool(target) and any(target == folder or target.startswith(folder.rstrip("/") + "/")
                                    for folder in _app_folders(app["dir"]))
    return False


def install_navigation_guard(window, app, log=None):
    """Cancel every navigation the work is not allowed to make. Runs from before_show on the GUI thread."""
    log = log or (lambda message: None)
    control = getattr(getattr(getattr(window, "native", None), "browser", None), "webview", None)
    if control is None:
        log("navigation guard not installed: WebView2 control not found")
        return None

    def starting(sender, args):
        try:
            if not navigation_allowed(args.Uri, app):
                args.Cancel = True
                log(f"blocked navigation: {str(args.Uri)[:200]}")
        except Exception as error:  # an event handler must never raise into WebView2; fail closed
            args.Cancel = True
            log(f"navigation guard error: {error}")

    def attach_frames(core):
        if core is not None:
            core.FrameNavigationStarting += starting

    def ready(sender, args):
        if getattr(args, "IsSuccess", True):
            attach_frames(getattr(control, "CoreWebView2", None))

    control.NavigationStarting += starting
    core = getattr(control, "CoreWebView2", None)
    if core is not None:
        attach_frames(core)
    else:
        control.CoreWebView2InitializationCompleted += ready
    return starting


def launch_command(app_id, executable=None, frozen=None, script=None):
    """(target, arguments) for the shortcut and for 打开. The packaged App is
    one exe; from a checkout it is python + app/super_pinkie.py."""
    executable = executable or sys.executable
    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    if frozen:
        return executable, f"--app-window {app_id}"
    script = script or str(Path(__file__).resolve().parent / "super_pinkie.py")
    return executable, f'"{script}" --app-window {app_id}'


class _ShellLink:
    """One .lnk written through IShellLinkW, with the same properties and Save()
    as WScript.Shell's shortcut object.

    WScript.Shell is not used: it converts paths through the ANSI code page, so on
    a non-Chinese Windows (code page 1252) setting TargetPath to 超級碧琪.exe fails
    with E_INVALIDARG, and saving a link named 单词小游戏.lnk fails with
    ERROR_INVALID_NAME. IShellLinkW and IPersistFile take UTF-16 throughout."""

    def __init__(self, path):
        self.path = str(path)
        self.TargetPath = self.Arguments = self.WorkingDirectory = self.IconLocation = self.Description = ""

    def Save(self):
        import pythoncom
        from win32com.shell import shell

        try:  # the bridge may call us on a thread that has not entered COM yet
            pythoncom.CoInitialize()
        except pythoncom.com_error:
            pass  # already in COM with another apartment model: fine for an in-proc ShellLink
        link = pythoncom.CoCreateInstance(shell.CLSID_ShellLink, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink)
        link.SetPath(self.TargetPath)
        link.SetArguments(self.Arguments)
        link.SetWorkingDirectory(self.WorkingDirectory)
        link.SetDescription(self.Description)
        if self.IconLocation:
            icon, _, index = self.IconLocation.rpartition(",")
            if not icon or not index.strip().lstrip("-").isdigit():
                icon, index = self.IconLocation, "0"
            link.SetIconLocation(icon, int(index))
        link.QueryInterface(pythoncom.IID_IPersistFile).Save(self.path, 0)


class _UnicodeShell:
    """The two WScript.Shell calls AppShortcuts makes, both Unicode-safe."""

    def SpecialFolders(self, name):
        from win32com.shell import shell, shellcon

        csidl = {"Programs": shellcon.CSIDL_PROGRAMS, "Desktop": shellcon.CSIDL_DESKTOPDIRECTORY}[name]
        return shell.SHGetFolderPath(0, csidl, None, 0)

    def CreateShortcut(self, path):
        return _ShellLink(path)


def _wscript_shell():
    return _UnicodeShell()


class AppShortcuts:
    """Start Menu + desktop .lnk files for installed apps. `shell` is the
    WScript.Shell COM object (a fake in tests)."""

    def __init__(self, root=None, shell_factory=_wscript_shell, launch=launch_command):
        self.root = Path(root) if root else apps_root()
        self.ledger_file = self.root / "shortcuts.json"
        self._shell_factory = shell_factory
        self._launch = launch

    def ledger(self):
        data = _read_json(self.ledger_file)
        return {key: value for key, value in data.items() if APP_ID.match(key) and isinstance(value, list)}

    def _delete(self, paths):
        left = []
        for raw in paths:
            path = Path(str(raw))
            # Only ever delete .lnk files we wrote; the ledger is a file on disk.
            if path.suffix.lower() != ".lnk":
                continue
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except PermissionError:
                # Windows refuses to delete a read-only file (users and sync tools mark desktop
                # icons read-only). Clear the flag on our own .lnk and try once more; a link that
                # is really in use stays in the ledger and goes next time.
                try:
                    os.chmod(path, stat.S_IREAD | stat.S_IWRITE)
                    path.unlink()
                except FileNotFoundError:
                    pass
                except OSError:
                    left.append(str(path))
            except OSError:
                left.append(str(path))
        return left

    def install(self, app_id):
        app = read_app(app_id, self.root)
        if not app:
            return {"ok": False, "error": "这个应用还没装好，请重新点「装到桌面」"}
        shell = self._shell_factory()
        ledger = self.ledger()
        self._delete(ledger.get(app["id"], []))  # reinstall: a renamed app must not leave the old icon
        target, arguments = self._launch(app["id"])
        icon = app["dir"] / "icon.ico"
        folders = [Path(str(shell.SpecialFolders("Programs"))) / START_MENU_FOLDER, Path(str(shell.SpecialFolders("Desktop")))]
        safe_name = _safe_shortcut_name(app["name"])
        made = []
        for folder in folders:
            folder.mkdir(parents=True, exist_ok=True)
            link_path = folder / f"{safe_name}.lnk"
            link = shell.CreateShortcut(str(link_path))
            link.TargetPath = target
            link.Arguments = arguments
            link.WorkingDirectory = str(app["dir"])
            link.IconLocation = f"{icon if icon.is_file() else target},0"
            link.Description = f"{app['name']}（碧琪做的应用）"
            link.Save()
            made.append(str(link_path))
        ledger[app["id"]] = made
        _write_json(self.ledger_file, ledger)
        return {"ok": True, "shortcuts": made}

    def uninstall(self, app_id):
        app_id = str(app_id or "")
        if not APP_ID.match(app_id):
            return {"ok": False, "error": "不认识的应用"}
        ledger = self.ledger()
        left = self._delete(ledger.pop(app_id, []))
        if left:
            ledger[app_id] = left
        _write_json(self.ledger_file, ledger)
        if left:
            return {"ok": False, "error": "有图标删不掉，可能正被占用", "left": left}
        try:  # the Start Menu folder goes once nothing of ours is in it (rmdir only works when empty)
            (Path(str(self._shell_factory().SpecialFolders("Programs"))) / START_MENU_FOLDER).rmdir()
        except Exception:
            pass
        return {"ok": True}

    def open(self, app_id, popen=subprocess.Popen):
        app = read_app(app_id, self.root)
        if not app:
            return {"ok": False, "error": "这个应用不在了"}
        target, arguments = self._launch(app["id"])
        args = [target] + _split_args(arguments)
        popen(args, cwd=str(app["dir"]), close_fds=True)
        return {"ok": True}


def _split_args(arguments):
    out, current, quoted = [], "", False
    for char in arguments:
        if char == '"':
            quoted = not quoted
        elif char == " " and not quoted:
            if current:
                out.append(current)
            current = ""
        else:
            current += char
    if current:
        out.append(current)
    return out


_SHORTCUTS = None


def shortcuts():
    global _SHORTCUTS
    if _SHORTCUTS is None:
        _SHORTCUTS = AppShortcuts()
    return _SHORTCUTS


def handle(message, store=None):
    store = store or shortcuts()
    kind = str(message.get("type", ""))
    app_id = message.get("appId")
    try:
        if kind == "installApp":
            return store.install(app_id)
        if kind == "uninstallApp":
            return store.uninstall(app_id)
        if kind == "openApp":
            return store.open(app_id)
    except Exception as error:  # a COM or file error must reach the page as text, not kill the bridge
        return {"ok": False, "error": f"没能完成：{type(error).__name__}"}
    return {"ok": False, "error": "不认识的原生请求"}


def app_id_from_argv(arguments=None):
    args = list(sys.argv[1:] if arguments is None else arguments)
    if "--app-window" not in args:
        return None
    index = args.index("--app-window")
    value = args[index + 1] if index + 1 < len(args) else ""
    return value if APP_ID.match(value) else ""


def set_app_user_model_id(app_id):
    try:
        import ctypes

        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(f"SuperPinkie.App.{app_id}")
    except Exception:
        pass


def run(arguments=None):
    """超級碧琪.exe --app-window <appId>: one window with only this work in it."""
    app_id = app_id_from_argv(arguments)
    app = read_app(app_id) if app_id else None
    import webview

    if not app:
        webview.create_window("碧琪应用", html="<meta charset=utf-8><body style='font:15px system-ui;padding:32px'>"
                              "这个应用已经卸载了，或者文件不在了。可以在碧琪的作品库里重新「装到桌面」。</body>",
                              width=520, height=220)
        webview.start(gui="edgechromium")
        return
    set_app_user_model_id(app["id"])
    icon = app["dir"] / "icon.ico"
    # pywebview 默认把新窗口（window.open / target=_blank）交给系统浏览器打开，绕过上面的规矩；
    # 关掉以后它改成在本窗口里 load_url，就会走 NavigationStarting，被 install_navigation_guard 拦。
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
    window = webview.create_window(app["name"], (app["dir"] / "index.html").as_uri(), width=WINDOW_SIZE[0], height=WINDOW_SIZE[1],
                                   min_size=(360, 260), resizable=True, text_select=True)
    window.events.before_show += lambda *_: install_navigation_guard(window, app)
    webview.start(gui="edgechromium", debug=False, private_mode=False, storage_path=str(app["dir"] / "webview-data"),
                  icon=str(icon) if icon.is_file() else None)
