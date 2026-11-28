"""作品装成桌面应用（PR①）Windows 这一半：.lnk 入口、卸载删干净、--app-window 参数、原生请求转发。

全部用假的 WScript.Shell 和临时目录，不碰真的开始菜单和桌面。
"""
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import windows_app_window as appwin

APP = "w0123456789abcde"
OTHER = "wfedcba987654321"


class FakeLink:
    def __init__(self, path):
        self.path = path
        self.TargetPath = self.Arguments = self.WorkingDirectory = self.IconLocation = self.Description = ""

    def Save(self):
        Path(self.path).write_text(json.dumps({"target": self.TargetPath, "args": self.Arguments, "icon": self.IconLocation}), encoding="utf-8")


class FakeShell:
    def __init__(self, base):
        self.base = Path(base)

    def SpecialFolders(self, name):
        return str(self.base / name)

    def CreateShortcut(self, path):
        return FakeLink(path)


class AppWindowTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.root = self.base / "state" / "apps"
        self.shell = FakeShell(self.base / "shell")
        self.store = appwin.AppShortcuts(self.root, shell_factory=lambda: self.shell,
                                         launch=lambda app_id: (r"C:\SuperPinkie\超級碧琪.exe", f"--app-window {app_id}"))

    def tearDown(self):
        self._tmp.cleanup()

    def install_files(self, app_id=APP, name="单词小游戏", icon=True):
        folder = self.root / app_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "index.html").write_text("<p>hi</p>", encoding="utf-8")
        if icon:
            (folder / "icon.ico").write_bytes(b"\0\0\1\0")
        index = self.root / "index.json"
        data = json.loads(index.read_text(encoding="utf-8")) if index.exists() else {"apps": {}}
        data["apps"][app_id] = {"id": app_id, "name": name}
        index.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def links(self):
        return sorted(str(p.relative_to(self.base / "shell")) for p in (self.base / "shell").rglob("*.lnk"))

    def test_install_puts_one_link_in_start_menu_folder_and_one_on_desktop(self):
        self.install_files()
        # 前提：还没有任何入口。
        self.assertEqual(self.links(), [])
        out = self.store.install(APP)
        self.assertTrue(out["ok"], out)
        self.assertEqual(self.links(), [os.path.join("Desktop", "单词小游戏.lnk"), os.path.join("Programs", "碧琪应用", "单词小游戏.lnk")])
        saved = json.loads((self.base / "shell" / "Desktop" / "单词小游戏.lnk").read_text(encoding="utf-8"))
        self.assertEqual(saved["args"], f"--app-window {APP}")
        self.assertTrue(saved["icon"].endswith("icon.ico,0"), saved)

    def test_install_without_icon_falls_back_to_the_exe_icon(self):
        self.install_files(icon=False)
        self.store.install(APP)
        saved = json.loads((self.base / "shell" / "Desktop" / "单词小游戏.lnk").read_text(encoding="utf-8"))
        self.assertEqual(saved["icon"], r"C:\SuperPinkie\超級碧琪.exe,0")

    def test_reinstall_with_new_name_removes_the_old_links(self):
        self.install_files(name="旧名")
        self.store.install(APP)
        self.install_files(name="新名")
        self.store.install(APP)
        self.assertEqual(self.links(), [os.path.join("Desktop", "新名.lnk"), os.path.join("Programs", "碧琪应用", "新名.lnk")])

    def test_uninstall_removes_links_and_empty_start_menu_folder_but_keeps_other_apps(self):
        self.install_files()
        self.install_files(OTHER, "计时器")
        self.store.install(APP)
        self.store.install(OTHER)
        self.assertEqual(self.store.uninstall(APP), {"ok": True})
        self.assertEqual(self.links(), [os.path.join("Desktop", "计时器.lnk"), os.path.join("Programs", "碧琪应用", "计时器.lnk")])
        self.assertEqual(self.store.uninstall(OTHER), {"ok": True})
        self.assertEqual(self.links(), [])
        self.assertFalse((self.base / "shell" / "Programs" / "碧琪应用").exists())
        # 再卸一次不报错。
        self.assertEqual(self.store.uninstall(APP), {"ok": True})

    def test_uninstall_only_deletes_lnk_files_named_in_the_ledger(self):
        self.install_files()
        self.store.install(APP)
        victim = self.base / "keep.txt"
        victim.write_text("mine", encoding="utf-8")
        ledger = json.loads(self.store.ledger_file.read_text(encoding="utf-8"))
        ledger[APP].append(str(victim))
        self.store.ledger_file.write_text(json.dumps(ledger), encoding="utf-8")
        self.store.uninstall(APP)
        self.assertTrue(victim.exists(), "台账被改过也不能删 .lnk 以外的文件")

    # B131：卸载 / 重装时 .lnk 已被用户删掉、所在文件夹没了、或被设成只读（用户和同步盘常给桌面图标打只读），都不能中断清理。
    def test_uninstall_when_links_or_their_folders_are_already_gone(self):
        self.install_files()
        self.install_files(OTHER, "计时器")
        self.store.install(APP)
        self.store.install(OTHER)
        ledger = json.loads(self.store.ledger_file.read_text(encoding="utf-8"))
        Path(ledger[APP][0]).unlink()  # 用户自己删了开始菜单那个
        ledger[APP].append(str(self.base / "shell" / "旧桌面" / "单词小游戏.lnk"))  # 记过的文件夹整个没了
        self.store.ledger_file.write_text(json.dumps(ledger, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(self.store.uninstall(APP), {"ok": True})
        self.assertNotIn(APP, self.store.ledger())
        # 别的作品不受影响。
        self.assertEqual(self.links(), [os.path.join("Desktop", "计时器.lnk"), os.path.join("Programs", "碧琪应用", "计时器.lnk")])

    def test_uninstall_removes_a_read_only_link(self):
        self.install_files()
        self.store.install(APP)
        desktop = self.base / "shell" / "Desktop" / "单词小游戏.lnk"
        os.chmod(desktop, stat.S_IREAD)
        self.addCleanup(lambda: desktop.exists() and os.chmod(desktop, stat.S_IREAD | stat.S_IWRITE))
        self.assertEqual(self.store.uninstall(APP), {"ok": True})
        self.assertEqual(self.links(), [])
        self.assertNotIn(APP, self.store.ledger())

    def test_reinstall_over_a_read_only_link_with_the_same_name(self):
        self.install_files()
        self.store.install(APP)
        desktop = self.base / "shell" / "Desktop" / "单词小游戏.lnk"
        os.chmod(desktop, stat.S_IREAD)
        self.addCleanup(lambda: desktop.exists() and os.chmod(desktop, stat.S_IREAD | stat.S_IWRITE))
        self.assertTrue(self.store.install(APP)["ok"])
        self.assertEqual(self.links(), [os.path.join("Desktop", "单词小游戏.lnk"), os.path.join("Programs", "碧琪应用", "单词小游戏.lnk")])
        self.assertTrue(os.access(desktop, os.W_OK), "重装后的图标是新写的，不再只读")

    def test_a_link_that_stays_locked_is_kept_in_the_ledger_for_next_time(self):
        # 反例：真被占用（清了只读也删不掉）就照旧报「删不掉」、留在台账里，下次卸载再删；放开后能删干净。
        self.install_files()
        self.store.install(APP)
        desktop = self.base / "shell" / "Desktop" / "单词小游戏.lnk"
        real_unlink = Path.unlink

        def locked(path, *args, **kwargs):
            if Path(path) == desktop:
                raise PermissionError(13, "in use", str(path))
            return real_unlink(path, *args, **kwargs)

        for read_only in (False, True):
            if read_only:
                os.chmod(desktop, stat.S_IREAD)
            with mock.patch.object(Path, "unlink", locked):
                out = self.store.uninstall(APP)
            self.assertFalse(out["ok"], out)
            self.assertEqual(out["left"], [str(desktop)])
            self.assertEqual(self.store.ledger()[APP], [str(desktop)])
            self.assertTrue(desktop.exists())
        os.chmod(desktop, stat.S_IREAD | stat.S_IWRITE)
        self.assertEqual(self.store.uninstall(APP), {"ok": True})
        self.assertEqual(self.links(), [])
        self.assertNotIn(APP, self.store.ledger())

    def test_bad_ids_never_reach_the_filesystem(self):
        for bad in ("..", "..\\..\\Windows", "w0123", "W0123456789ABCDE", "", None):
            self.assertIsNone(appwin.read_app(bad, self.root), bad)
            self.assertFalse(self.store.install(bad)["ok"])
            self.assertFalse(self.store.open(bad, popen=mock.Mock())["ok"])
        # 正例：合法 id、文件在，才读得到。
        self.install_files()
        self.assertEqual(appwin.read_app(APP, self.root)["name"], "单词小游戏")

    def test_open_starts_the_app_window_process(self):
        self.install_files()
        popen = mock.Mock()
        self.assertEqual(self.store.open(APP, popen=popen), {"ok": True})
        args = popen.call_args.args[0]
        self.assertEqual(args, [r"C:\SuperPinkie\超級碧琪.exe", "--app-window", APP])

    def test_argv_and_launch_command(self):
        self.assertEqual(appwin.app_id_from_argv(["--app-window", APP]), APP)
        self.assertEqual(appwin.app_id_from_argv(["--app-window", "../x"]), "")
        self.assertIsNone(appwin.app_id_from_argv(["--update"]))
        self.assertEqual(appwin.launch_command(APP, executable="C:/a.exe", frozen=True), ("C:/a.exe", f"--app-window {APP}"))
        target, arguments = appwin.launch_command(APP, executable="C:/py.exe", frozen=False, script="C:/r/app/super_pinkie.py")
        self.assertEqual(appwin._split_args(arguments), ["C:/r/app/super_pinkie.py", "--app-window", APP])

    def test_native_bridge_forwards_app_requests(self):
        from app.windows_native import WindowsNative

        # 和 windows_native 一样先试顶层导入：别的测试把 app/ 塞进 sys.path 后，桥用的是顶层的
        # windows_app_window，跟 app.windows_app_window 不是同一个模块对象，打补丁要打在桥真正用的那个上。
        try:
            import windows_app_window as bridged
        except ImportError:
            bridged = appwin
        native = WindowsNative(mock.Mock())
        with mock.patch.object(bridged, "handle", return_value={"ok": True, "via": "apps"}) as handled:
            self.assertEqual(native.handle({"type": "installApp", "appId": APP}), {"ok": True, "via": "apps"})
            self.assertEqual(handled.call_count, 1)
        # 反例：别的类型照旧不认识。
        self.assertFalse(native.handle({"type": "installAppX"})["ok"])

    def test_handle_turns_errors_into_text(self):
        broken = mock.Mock()
        broken.install.side_effect = OSError("disk")
        self.assertEqual(appwin.handle({"type": "installApp", "appId": APP}, broken), {"ok": False, "error": "没能完成：OSError"})


def _has_shell_com():
    try:
        import pythoncom  # noqa: F401
        from win32com.shell import shell  # noqa: F401
    except ImportError:
        return False
    return os.name == "nt"


@unittest.skipUnless(_has_shell_com(), "真的 .lnk 只能在装了 pywin32 的 Windows 上写")
class RealShortcutTest(unittest.TestCase):
    """真写 .lnk（B19 真机走查）：exe 叫 超級碧琪.exe、作品名是中文 / emoji。

    以前用 WScript.Shell，它按系统 ANSI 代码页转路径：非中文 Windows（代码页 1252）上
    TargetPath 设成 超級碧琪.exe 报 E_INVALIDARG，中文名的 .lnk 存不下来，「装到桌面」次次失败。
    这里只把开始菜单 / 桌面两个文件夹换成临时目录，写 .lnk 走的是产品里真的那条路。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.root = self.base / "state" / "apps"
        self.exe = self.base / "超級碧琪" / "超級碧琪.exe"
        self.exe.parent.mkdir(parents=True)
        self.exe.write_bytes(b"MZ")
        real = appwin._wscript_shell()
        folders = {"Programs": str(self.base / "开始菜单"), "Desktop": str(self.base / "桌面")}
        shell = mock.Mock(SpecialFolders=folders.__getitem__, CreateShortcut=real.CreateShortcut)
        self.store = appwin.AppShortcuts(self.root, shell_factory=lambda: shell,
                                         launch=lambda app_id: (str(self.exe), f"--app-window {app_id}"))

    def tearDown(self):
        self._tmp.cleanup()

    def read_link(self, path):
        import pythoncom
        from win32com.shell import shell

        link = pythoncom.CoCreateInstance(shell.CLSID_ShellLink, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink)
        link.QueryInterface(pythoncom.IID_IPersistFile).Load(str(path))
        return {"target": link.GetPath(0)[0], "args": link.GetArguments(), "cwd": link.GetWorkingDirectory(),
                "icon": link.GetIconLocation()}

    def put(self, app_id, name):
        folder = self.root / app_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "index.html").write_text("<p>hi</p>", encoding="utf-8")
        index = self.root / "index.json"
        data = json.loads(index.read_text(encoding="utf-8")) if index.exists() else {"apps": {}}
        data["apps"][app_id] = {"id": app_id, "name": name}
        index.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def test_cjk_exe_and_cjk_emoji_names_round_trip_and_uninstall_cleans_up(self):
        self.put(APP, "单词小游戏")
        self.put(OTHER, "番茄🍅计时器")
        for app_id in (APP, OTHER):
            self.assertTrue(self.store.install(app_id)["ok"], app_id)
        desktop = self.base / "桌面" / "单词小游戏.lnk"
        start = self.base / "开始菜单" / appwin.START_MENU_FOLDER / "番茄🍅计时器.lnk"
        self.assertTrue(desktop.is_file() and start.is_file())
        link = self.read_link(desktop)
        self.assertEqual(link["target"], str(self.exe))
        self.assertEqual(link["args"], f"--app-window {APP}")
        self.assertEqual(link["cwd"], str(self.root / APP))
        self.assertEqual(link["icon"], (str(self.exe), 0))  # no icon.ico: falls back to the exe's own

        self.put(APP, "单词小游戏 第二版")  # reinstall under a new name: the old links go
        self.assertTrue(self.store.install(APP)["ok"])
        self.assertFalse(desktop.exists())
        self.assertTrue((self.base / "桌面" / "单词小游戏 第二版.lnk").is_file())

        for app_id in (APP, OTHER):
            self.assertEqual(self.store.uninstall(app_id), {"ok": True})
        self.assertEqual(sorted(p.name for p in self.base.rglob("*.lnk")), [])
        self.assertFalse((self.base / "开始菜单" / appwin.START_MENU_FOLDER).exists())

    def test_icon_location_with_index_is_kept(self):
        self.put(APP, "单词小游戏")
        (self.root / APP / "icon.ico").write_bytes(b"\0\0\1\0")
        self.assertTrue(self.store.install(APP)["ok"])
        icon = self.read_link(self.base / "桌面" / "单词小游戏.lnk")["icon"]
        self.assertEqual(icon, (str(self.root / APP / "icon.ico"), 0))


if __name__ == "__main__":
    unittest.main()
