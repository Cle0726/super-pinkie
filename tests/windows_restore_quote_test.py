"""B42：用户名带弯撇号时，「下次登录时把旧版本搬回来」的脚本也要能跑。

Register-RestoreAtLogon 把安装目录、备份目录、日志路径写进 restore-*.ps1 的
单引号字符串里，原来只加倍 ASCII '。PowerShell 遇到 ‘ ’ ‚ ‛ 也会结束单引号串，
用户目录是 C:\\Users\\O’Brien 时这份脚本解析失败，最后一道保险也失效，
桌面快捷方式继续指向空目录。

只用临时假目录；New-Item / Set-ItemProperty 被换掉，不碰真注册表。
"""
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

from app.windows_desktop import WindowsUpdater

HELPER = WindowsUpdater._directory_helper_source()

NAMES = ["张 三", "O'Brien", "O\u2019Brien", "\u2018x\u201b y\u201a", "a''\u2019\u2019b"]


def powershell():
    return shutil.which("powershell.exe") if os.name == "nt" else None


class RestoreQuoteSourceTest(unittest.TestCase):
    def test_every_powershell_single_quote_is_doubled(self):
        body = HELPER.split("function Register-RestoreAtLogon", 1)[1].split("\nfunction ", 1)[0]
        self.assertNotIn(".Replace(\"'\", \"''\")", body)
        self.assertIn("$quotes = \"['\\u2018-\\u201b]\"", body)


@unittest.skipUnless(powershell(), "needs Windows PowerShell")
class RestoreQuoteRunTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.helper_file = self.base / "helper.ps1"
        self.helper_file.write_text(HELPER, encoding="utf-8-sig")

    def run_powershell(self, script_path, body=None):
        if body is not None:
            script_path.write_text(body, encoding="utf-8-sig")
        return subprocess.run(
            [powershell(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script_path)],
            capture_output=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW,
        )

    def test_restore_script_runs_under_a_quoted_user_folder(self):
        for name in NAMES:
            with self.subTest(name=name):
                root = self.base / name / "AppData" / "Local"
                install = root / "超級碧琪"
                backup = root / "超級碧琪.previous-0123"
                backup.mkdir(parents=True)
                (backup / "超級碧琪.exe").write_text("exe", encoding="utf-8")
                updates = root / "updates"
                updates.mkdir()
                log = root / "updater.log"

                def literal(path):
                    # the test's own literals use the same doubling as the fix
                    text = str(path)
                    for quote in "'\u2018\u2019\u201a\u201b":
                        text = text.replace(quote, quote * 2)
                    return "'" + text + "'"

                probe = textwrap.dedent(f"""
                    $ErrorActionPreference = 'Stop'
                    $__ast = [System.Management.Automation.Language.Parser]::ParseFile({literal(self.helper_file)}, [ref]$null, [ref]$null)
                    foreach ($__name in @('Write-UpdateLog', 'Register-RestoreAtLogon')) {{
                      $__fn = $__ast.Find({{ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $__name }}, $true)
                      if (-not $__fn) {{ throw ('missing function ' + $__name) }}
                      . ([scriptblock]::Create($__fn.Extent.Text))
                    }}
                    $TargetDir = {literal(install)}
                    $Backup = {literal(backup)}
                    $UpdateRoot = {literal(updates)}
                    $LogPath = {literal(log)}
                    $Token = '0123456789abcdef0123456789abcdef'
                    # Never touch the real registry from a test.
                    function New-Item {{ param($Path, [switch]$Force) }}
                    function Set-ItemProperty {{ param($Path, $Name, $Value) "runonce=$Name" }}
                    Register-RestoreAtLogon
                """)
                result = self.run_powershell(self.base / "probe.ps1", probe)
                out = result.stdout.decode("utf-8", "replace")
                self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
                self.assertIn("runonce=SuperPinkieRestore-01234567", out)
                restore = next(updates.glob("restore-*.ps1"))
                result = self.run_powershell(restore)
                self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
                self.assertTrue((install / "超級碧琪.exe").is_file(), "previous version was not moved back")
                self.assertFalse(backup.exists())
                self.assertFalse(restore.exists())
                self.assertIn("previous version restored at sign-in", log.read_text(encoding="utf-8-sig"))


if __name__ == "__main__":
    unittest.main()
