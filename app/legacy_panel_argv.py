"""Commands the old tkinter panel (app/super_pinkie.py) starts, as argv lists.

B33: the panel used os.system(explorer "..."), os.system("start http://...") and
shell=True for npm. cmd expanded %VAR% inside UR_PROMPTS_DIR and a " in it ended
the quoted argument. Everything here runs with no shell in between.
"""
import os
import shutil
import subprocess
import sys
import webbrowser


def open_folder_command(folder, platform=None):
    """argv that opens a folder in the file manager."""
    platform = platform or sys.platform
    if platform == "darwin":
        return ["open", str(folder)]
    if platform.startswith("win"):
        return ["explorer.exe", str(folder)]
    return ["xdg-open", str(folder)]


def open_folder(folder):
    try:
        subprocess.Popen(open_folder_command(folder))
    except OSError:
        pass


def open_web(url):
    webbrowser.open(url)


def npm_install_command(platform_name=None):
    """argv for the global openclaw install. On Windows npm is npm.cmd, which
    CreateProcess runs without shell=True once it is named by its full path."""
    if (platform_name or os.name) == "nt":
        return [shutil.which("npm.cmd") or shutil.which("npm") or "npm.cmd", "install", "-g", "openclaw"]
    return ["npm", "install", "-g", "openclaw"]
