"""B33: the old tkinter panel (app/super_pinkie.py) no longer goes through a shell.

* "打开配置目录" ran os.system(f'explorer "{prompts_dir()}"'). cmd expanded %VAR%
  inside the folder (UR_PROMPTS_DIR comes from the environment), and a " in it
  ended the quoted argument. It is now an argv list.
* "打开 Web 界面" ran os.system("start http://..."); it now uses webbrowser.
* The global openclaw install used shell=True on Windows only to find npm.cmd;
  it now names npm.cmd by its full path and runs without a shell.
"""
import inspect
import io
import os
import re
import shutil
import subprocess
import tokenize
import unittest
from unittest import mock

from app import legacy_panel_argv, super_pinkie


def code_without_strings_and_comments(source):
    kept = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type not in (tokenize.STRING, tokenize.COMMENT):
            kept.append(token.string)
    return " ".join(kept)


class LegacyPanelArgvTest(unittest.TestCase):
    def test_open_folder_is_an_argv_list_on_every_platform(self):
        folder = "C:\\Users\\a\\%USERPROFILE%\\x\" & calc & \""
        self.assertEqual(legacy_panel_argv.open_folder_command(folder, "win32"), ["explorer.exe", folder])
        self.assertEqual(legacy_panel_argv.open_folder_command("/tmp/a b", "darwin"), ["open", "/tmp/a b"])
        self.assertEqual(legacy_panel_argv.open_folder_command("/tmp/a b", "linux"), ["xdg-open", "/tmp/a b"])

    def test_open_folder_never_uses_a_shell(self):
        with mock.patch.object(legacy_panel_argv.subprocess, "Popen") as popen:
            legacy_panel_argv.open_folder("/tmp/%HOME% $(id)")
        args, kwargs = popen.call_args
        self.assertIsInstance(args[0], list)
        self.assertEqual(args[0][-1], "/tmp/%HOME% $(id)")
        self.assertFalse(kwargs.get("shell", False))

    def test_open_folder_swallows_a_missing_file_manager(self):
        with mock.patch.object(legacy_panel_argv.subprocess, "Popen", side_effect=FileNotFoundError):
            legacy_panel_argv.open_folder("/tmp")

    def test_npm_install_command(self):
        self.assertEqual(legacy_panel_argv.npm_install_command("posix"), ["npm", "install", "-g", "openclaw"])
        with mock.patch.object(legacy_panel_argv.shutil, "which", side_effect=lambda name: None):
            self.assertEqual(legacy_panel_argv.npm_install_command("nt"), ["npm.cmd", "install", "-g", "openclaw"])
        found = "C:\\Program Files\\nodejs\\npm.cmd"
        with mock.patch.object(legacy_panel_argv.shutil, "which", side_effect=lambda name: found if name == "npm.cmd" else None):
            self.assertEqual(legacy_panel_argv.npm_install_command("nt"), [found, "install", "-g", "openclaw"])

    def test_no_shell_left_in_the_panel(self):
        for module in (super_pinkie, legacy_panel_argv):
            name = module.__name__.rsplit(".", 1)[-1] + ".py"
            code = code_without_strings_and_comments(inspect.getsource(module))
            self.assertIsNone(re.search(r"\bos \. system\b", code), f"os.system is back in {name}")
            self.assertIsNone(re.search(r"\bshell = True\b", code), f"shell=True is back in {name}")


@unittest.skipUnless(os.name == "nt" and shutil.which("npm.cmd"), "needs npm.cmd on Windows")
class RealNpmCmdTest(unittest.TestCase):
    def test_npm_cmd_starts_without_a_shell(self):
        command = legacy_panel_argv.npm_install_command()
        result = subprocess.run([command[0], "-v"], capture_output=True, text=True, timeout=60,
                                **super_pinkie.hidden_process_kwargs())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout.strip(), r"^\d+\.\d+\.\d+")


if __name__ == "__main__":
    unittest.main()
