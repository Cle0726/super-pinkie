"""B87：便携版放在盘根 / 网络共享根时，更新要么换得上，要么明确说为什么换不了，不能抛异常。

便携版的替换脚本把整个安装文件夹改名成 <文件夹>.previous-<token>，再把新版放回原名。
exe 直接放在 D:\\ 或 \\\\nas\\share\\ 下时，「安装文件夹」就是盘根 / 共享根：
  * Python 侧 target_dir.with_name(...) 直接 ValueError（D:\\ 没有名字），launch_replacer 整个抛出去；
  * 就算让它不抛，脚本也会去改名 D:\\ 本身（做不到），而且按 D:\\ 前缀停进程会把整个盘上跑着的程序都停掉。
所以盘根要在起替换脚本之前就拦住，告诉用户把碧琪放进一个文件夹里再更新；带空格 / 中文的普通文件夹照常更新。

全部用假路径和桩：不起 PowerShell，不碰真盘根。
"""
import os
import tempfile
import unittest
from pathlib import Path, PureWindowsPath
from unittest import mock

from app.windows_desktop import WindowsUpdater


ROOTS = [
    PureWindowsPath("D:\\\u8d85\u7d1a\u78a7\u742a.exe"),
    PureWindowsPath("\\\\nas\\share\\\u8d85\u7d1a\u78a7\u742a.exe"),
]


class DriveRootPortableUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pinkie-b87-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        environment = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.root / "state")})
        environment.start()
        self.addCleanup(environment.stop)

    def updater_at(self, executable):
        """A prepared portable updater whose exe sits at `executable` (a fake path)."""
        payload = self.root / "portable.zip"
        payload.write_bytes(b"new")
        updater = WindowsUpdater(self.root, executable=self.root / "placeholder.exe")
        updater.executable = executable
        updater.portable = True
        updater.prepared = {"payload": payload, "sha256": updater._file_hash(payload), "version": "9.9.9"}
        return updater

    def test_root_install_is_refused_with_a_reason_and_no_replacer_starts(self):
        for executable in ROOTS:
            with self.subTest(executable=str(executable)):
                updater = self.updater_at(executable)
                with mock.patch("app.windows_desktop.subprocess.Popen") as popen:
                    result = updater.launch_replacer()
                self.assertFalse(result["started"])
                self.assertIn("文件夹", result["message"])
                self.assertFalse(result.get("elevate"), "admin rights would not help: the root itself cannot be swapped")
                popen.assert_not_called()

    def test_folder_with_spaces_and_chinese_still_starts_the_replacer(self):
        install = self.root / "张 三" / "超級碧琪"
        (install / "_internal").mkdir(parents=True)
        exe = install / "超級碧琪.exe"
        exe.write_bytes(b"old")
        updater = self.updater_at(exe)
        process = mock.Mock()
        process.poll.return_value = None
        seen = {}

        def spawn(command, **_):
            if "-Token" not in command:
                return mock.Mock()  # progress window on Windows
            token = command[command.index("-Token") + 1]
            Path(command[command.index("-ReadyMarker") + 1]).write_text(token, encoding="ascii")
            seen["target"] = command[command.index("-TargetDir") + 1]
            seen["backup"] = command[command.index("-Backup") + 1]
            return process

        with mock.patch("app.windows_desktop.subprocess.Popen", side_effect=spawn):
            self.assertTrue(updater.launch_replacer()["started"])
        self.assertEqual(seen["target"], str(install))
        self.assertEqual(Path(seen["backup"]).parent, install.parent)
        self.assertTrue(Path(seen["backup"]).name.startswith("超級碧琪.previous-"))


if __name__ == "__main__":
    unittest.main()
