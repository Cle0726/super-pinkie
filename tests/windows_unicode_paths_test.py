"""B42：中文 / 带空格 / 带引号的用户名路径进 PowerShell 命令时不能断。

PowerShell 的单引号字符串遇到 ' ‘ ’ ‚ ‛ 任何一个都会结束，原来只把 ASCII 的 '
加倍，用户名是 O’Brien（Word 自动换成的弯撇号）时整条命令解析失败
（"The string is missing the terminator"），启动时清不掉残留的 WebView2。

全部用假目录，不真装、不停任何进程：subprocess.run 被换掉，只在 Windows 上
把拼出来的 $root 那一句单独交给 powershell.exe 求值。
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import windows_desktop

NAMES = [
    "张 三",
    "O'Brien",
    "O\u2019Brien",
    "\u2018x\u201b y\u201a",
    "a''\u2019\u2019b",
    "超級碧琪 [1]",
]


def built_script(storage):
    """The -Command text cleanup_orphan_webview would hand to PowerShell."""
    with mock.patch.object(windows_desktop, "os", SimpleNamespace(name="nt")), \
            mock.patch.object(windows_desktop.subprocess, "CREATE_NO_WINDOW", 0, create=True), \
            mock.patch.object(windows_desktop.subprocess, "run") as run:
        windows_desktop.cleanup_orphan_webview(storage)
    command = run.call_args.args[0]
    return command[command.index("-Command") + 1]


def powershell():
    if os.name != "nt":
        return None
    return shutil.which("powershell.exe")


class CleanupOrphanWebviewPathTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def storage(self, name):
        path = Path(self.directory.name) / name / "AppData" / "Local" / "SuperPinkie" / "webview"
        path.mkdir(parents=True)
        return str(path.resolve())

    def test_no_unescaped_quote_reaches_the_root_literal(self):
        for name in NAMES:
            with self.subTest(name=name):
                script = built_script(self.storage(name))
                literal = script.split("Escape(", 1)[1].split("); Get-CimInstance", 1)[0]
                inner = literal[1:-1]
                for quote in "'\u2018\u2019\u201a\u201b":
                    self.assertNotIn(quote, inner.replace(quote * 2, ""))

    @unittest.skipUnless(powershell(), "needs Windows PowerShell")
    def test_root_matches_its_own_webview_command_line_in_powershell(self):
        for name in NAMES:
            with self.subTest(name=name):
                path = self.storage(name)
                root_statement = built_script(path).split("; Get-CimInstance", 1)[0]
                check = (
                    root_statement + "; "
                    "[Console]::Out.Write([string](($env:B42_OURS -like ('*--user-data-dir=*' + $root + '*'))) + '|' + "
                    "[string](($env:B42_OTHER -like ('*--user-data-dir=*' + $root + '*'))))"
                )
                environment = dict(os.environ,
                                   B42_OURS='msedgewebview2.exe --user-data-dir="' + path + '" --type=renderer',
                                   B42_OTHER='msedgewebview2.exe --user-data-dir="' + path + 'x\\other" ')
                environment["B42_OTHER"] = 'msedgewebview2.exe --user-data-dir="C:\\Other\\webview"'
                result = subprocess.run(
                    [powershell(), "-NoProfile", "-NonInteractive", "-Command",
                     "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + check],
                    capture_output=True, timeout=60, env=environment,
                )
                self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
                self.assertEqual(result.stdout.decode("utf-8", "replace").strip(), "True|False")


if __name__ == "__main__":
    unittest.main()
