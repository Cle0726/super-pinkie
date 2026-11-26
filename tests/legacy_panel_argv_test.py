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

from app import super_pinkie


def code_without_strings_and_comments(source):
    kept = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type not in (tokenize.STRING, tokenize.COMMENT):
            kept.append(token.string)
    return " ".join(kept)


class LegacyPanelArgvTest(unittest.TestCase):
    def test_open_folder_is_an_argv_list_on_every_platform(self):
        folder = "C:\\Users\\a\\%USERPROFILE%\\x\" & calc & \""
        self.assertEqual(super_pinkie.open_folder_command(folder, "win32"), ["explorer.exe", folder])
        self.assertEqual(super_pinkie.open_folder_command("/tmp/a b", "darwin"), ["open", "/tmp/a b"])
        self.assertEqual(super_pinkie.open_folder_command("/tmp/a b", "linux"), ["xdg-open", "/tmp/a b"])

    def test_open_folder_never_uses_a_shell(self):
        with mock.patch.object(super_pinkie.subprocess, "Popen") as popen:
            super_pinkie.open_folder("/tmp/%HOME% $(id)")
        args, kwargs = popen.call_args
        self.assertIsInstance(args[0], list)
        self.assertEqual(args[0][-1], "/tmp/%HOME% $(id)")
        self.assertFalse(kwargs.get("shell", False))

    def test_open_folder_swallows_a_missing_file_manager(self):
        with mock.patch.object(super_pinkie.subprocess, "Popen", side_effect=FileNotFoundError):
            super_pinkie.open_folder("/tmp")

    def test_npm_install_command(self):
        self.assertEqual(super_pinkie.npm_install_command("posix"), ["npm", "install", "-g", "openclaw"])
        with mock.patch.object(super_pinkie.shutil, "which", side_effect=lambda name: None):
            self.assertEqual(super_pinkie.npm_install_command("nt"), ["npm.cmd", "install", "-g", "openclaw"])
        found = "C:\\Program Files\\nodejs\\npm.cmd"
        with mock.patch.object(super_pinkie.shutil, "which", side_effect=lambda name: found if name == "npm.cmd" else None):
            self.assertEqual(super_pinkie.npm_install_command("nt"), [found, "install", "-g", "openclaw"])

    def test_no_shell_left_in_the_panel(self):
        code = code_without_strings_and_comments(inspect.getsource(super_pinkie))
        self.assertIsNone(re.search(r"\bos \. system\b", code), "os.system is back in super_pinkie.py")
        self.assertIsNone(re.search(r"\bshell = True\b", code), "shell=True is back in super_pinkie.py")


@unittest.skipUnless(os.name == "nt" and shutil.which("npm.cmd"), "needs npm.cmd on Windows")
class RealNpmCmdTest(unittest.TestCase):
    def test_npm_cmd_starts_without_a_shell(self):
        command = super_pinkie.npm_install_command()
        result = subprocess.run([command[0], "-v"], capture_output=True, text=True, timeout=60,
                                **super_pinkie.hidden_process_kwargs())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout.strip(), r"^\d+\.\d+\.\d+")


if __name__ == "__main__":
    unittest.main()
