"""作品装成桌面应用（PR①）Windows 这一半：.lnk 入口、卸载删干净、--app-window 参数、原生请求转发。

全部用假的 WScript.Shell 和临时目录，不碰真的开始菜单和桌面。
"""
import json
import os
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

        native = WindowsNative(mock.Mock())
        with mock.patch.object(appwin, "handle", return_value={"ok": True, "via": "apps"}) as handled:
            self.assertEqual(native.handle({"type": "installApp", "appId": APP}), {"ok": True, "via": "apps"})
            self.assertEqual(handled.call_count, 1)
        # 反例：别的类型照旧不认识。
        self.assertFalse(native.handle({"type": "installAppX"})["ok"])

    def test_handle_turns_errors_into_text(self):
        broken = mock.Mock()
        broken.install.side_effect = OSError("disk")
        self.assertEqual(appwin.handle({"type": "installApp", "appId": APP}, broken), {"ok": False, "error": "没能完成：OSError"})


if __name__ == "__main__":
    unittest.main()
