"""B42：中文 / 带空格的用户名路径经更新脚本交给新起的 PowerShell 时不能断、不能串位。

替换脚本（apply-<token>.ps1）有两处把路径拼成命令行交给另一个 powershell.exe：
  * 需要管理员修复时，$script:RepairArguments 交给 Start-Process -ArgumentList（-Verb RunAs）；
  * App 自己没开进度窗时，Start-UpdateProgressWindow 用 ProcessStartInfo.Arguments 拼一整行。
两处都靠 ConvertTo-Argument 包一对双引号。Windows PowerShell 5.1 的 -ArgumentList 只用空格连接、
不替你加引号：少了那对引号，C:/Users/张 三 下的路径就在空格处断开，后面的参数整体串位。

这里跑的是真实替换脚本里的那几句（用 PowerShell 自己的解析器从生成的脚本里取函数），
只把被起的修复脚本 / 进度窗换成一个把收到的参数原样写回 JSON 的小脚本，不提权、不弹窗。
（ui3 #306 已测 cleanup_orphan_webview；#338 已测 restore-<token>.ps1 的弯撇号。）
"""
import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

from app.windows_desktop import WindowsUpdater

NAMES = [
    "张 三",
    "a  b",
    "O\u2019Brien",
    "超級碧琪 [1]",
]

ECHO_REPAIR = textwrap.dedent("""\
    param([string]$Mode, [string]$Target, [string]$TargetExe, [string]$Backup, [string]$Failed, [string]$LogPath)
    $o = [ordered]@{Mode=$Mode; Target=$Target; TargetExe=$TargetExe; Backup=$Backup; Failed=$Failed; LogPath=$LogPath}
    [IO.File]::WriteAllText($env:B42_OUT, ($o | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
""")

ECHO_PROGRESS = textwrap.dedent("""\
    param([string]$Status, [int]$Owner, [string]$Version)
    $o = [ordered]@{Status=$Status; Owner=$Owner; Version=$Version}
    [IO.File]::WriteAllText($env:B42_OUT, ($o | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
""")

LOAD_FUNCTIONS = textwrap.dedent("""\
    $ErrorActionPreference = 'Stop'
    $__ast = [System.Management.Automation.Language.Parser]::ParseFile($env:B42_HELPER, [ref]$null, [ref]$null)
    foreach ($__name in @('ConvertTo-Argument', 'Start-UpdateProgressWindow')) {
      $__fn = $__ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $__name }, $true)
      if (-not $__fn) { throw ('missing function ' + $__name) }
      . ([scriptblock]::Create($__fn.Extent.Text))
    }
""")


def powershell():
    if os.name != "nt":
        return None
    return shutil.which("powershell.exe")


def ps_literal(value):
    text = str(value)
    for quote in "'\u2018\u2019\u201a\u201b":
        text = text.replace(quote, quote * 2)
    return "'" + text + "'"


def repair_statement(helper):
    start = helper.index("$script:RepairArguments = @(")
    tail = "(ConvertTo-Argument $LogPath))"
    return helper[start:helper.index(tail, start) + len(tail)]


@unittest.skipUnless(powershell(), "needs Windows PowerShell")
class UpdateHelperArgumentPathTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def run_probe(self, helper, body, out):
        helper_file = self.root / "helper-under-test.ps1"
        helper_file.write_text(helper, encoding="utf-8-sig")
        script = self.root / "probe.ps1"
        script.write_text(LOAD_FUNCTIONS + body, encoding="utf-8-sig")
        environment = dict(os.environ, B42_OUT=str(out), B42_HELPER=str(helper_file))
        result = subprocess.run(
            [powershell(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
            capture_output=True, timeout=90, env=environment, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        # Start-UpdateProgressWindow 不等子进程，给它一点时间写回。
        for _ in range(300):
            if out.is_file() and out.stat().st_size:
                break
            time.sleep(0.1)
        self.assertTrue(out.is_file(), "被起的 PowerShell 没写回参数（命令行在路径处断了？）")
        return json.loads(out.read_text(encoding="utf-8"))

    def check_repair(self, helper, mode):
        for name in NAMES:
            with self.subTest(mode=mode, name=name):
                home = self.root / mode / name
                home.mkdir(parents=True)
                echo = home / "repair-0123.ps1"
                echo.write_text(ECHO_REPAIR, encoding="utf-8-sig")
                target_dir = home / "超級碧琪"
                target = target_dir / "超級碧琪.exe"
                values = {
                    "RepairScript": echo, "TargetDir": target_dir, "TargetExe": target, "Target": target,
                    "Backup": home / "超級碧琪.previous-0123", "LogPath": home / "logs" / "updater.log",
                }
                body = "".join(f"${key} = {ps_literal(value)}\n" for key, value in values.items())
                body += "$Token = '0123'\n" + repair_statement(helper) + "\n"
                body += ("Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') "
                         "-ArgumentList $script:RepairArguments -Wait -WindowStyle Hidden\n")
                got = self.run_probe(helper, body, home / "got.json")
                expected_target = str(target_dir) if mode == "dir" else str(target)
                self.assertEqual(got["Mode"], mode)
                self.assertEqual(got["Target"], expected_target)
                self.assertEqual(got["TargetExe"], str(target))
                self.assertEqual(got["Backup"], str(values["Backup"]))
                self.assertEqual(got["Failed"], expected_target + ".failed-0123")
                self.assertEqual(got["LogPath"], str(values["LogPath"]))

    def test_directory_repair_arguments_survive_unicode_and_spaces(self):
        self.check_repair(WindowsUpdater._directory_helper_source(), "dir")

    def test_file_repair_arguments_survive_unicode_and_spaces(self):
        self.check_repair(WindowsUpdater._helper_source(), "file")

    def test_progress_window_arguments_survive_unicode_and_spaces(self):
        helper = WindowsUpdater._directory_helper_source()
        for name in NAMES:
            with self.subTest(name=name):
                home = self.root / "progress" / name
                home.mkdir(parents=True)
                echo = home / "progress-0123.ps1"
                echo.write_text(ECHO_PROGRESS, encoding="utf-8-sig")
                status = home / "progress-0123.json"
                body = (f"$ProgressShown = $false\n$ProgressScript = {ps_literal(echo)}\n"
                        f"$ProgressFile = {ps_literal(status)}\n$Version = '2.6.0 测试'\n"
                        "Start-UpdateProgressWindow\n")
                got = self.run_probe(helper, body, home / "got.json")
                self.assertEqual(got["Status"], str(status))
                self.assertEqual(got["Version"], "2.6.0 测试")
                self.assertGreater(got["Owner"], 0)


if __name__ == "__main__":
    unittest.main()
