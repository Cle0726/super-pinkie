"""Windows 端文本读写必须写明编码（backlog B41）。

打包的 exe 不跑 UTF-8 模式（PYTHONUTF8=1 只给子进程设），中文 / 法语 / 德语 Windows 上
不写 encoding 的 open() / read_text() / write_text() 会按 cp936 / cp1252 读写，
text=True 的子进程输出按控制台代码页来，严格解码一碰到坏字节就丢掉整段输出。
这里静态检查 app/windows_*.py：
  - open() / io.open() / Path.open() 文本模式要带 encoding=
  - read_text() / write_text() 要带 encoding=
  - 任何 text=True / universal_newlines=True 的调用要带 encoding= 或 errors=
二进制模式（"rb" / "ab" …）和 read_bytes() / write_bytes() 不管。
"""
import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_MODE = re.compile(r"[rwxabt+]{1,3}")


def _keyword(node, name):
    for keyword in node.keywords:
        if keyword.arg == name:
            return keyword.value
    return None


def _constant(value):
    return value.value if isinstance(value, ast.Constant) else None


def _has_kwargs_splat(node):
    return any(keyword.arg is None for keyword in node.keywords)


def text_io_without_encoding(source):
    """(line, kind) for every text-mode read / write / subprocess call that does not name an encoding."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else None
        owner = func.value.id if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else None
        builtin_open = name == "open" and (isinstance(func, ast.Name) or owner == "io")
        # Path.open(mode)：没有参数，或第一个参数是 "r" / "wb" 这样的模式字串。
        # store.open(app_id) / opener.open(url) / webbrowser.open(url) 这类不是打开文件。
        path_open = name == "open" and isinstance(func, ast.Attribute) and owner != "io" and (
            not node.args and not node.keywords
            or (node.args and isinstance(_constant(node.args[0]), str) and _MODE.fullmatch(_constant(node.args[0])))
            or (not node.args and _keyword(node, "mode") is not None)
        )
        if builtin_open or path_open:
            index = 1 if builtin_open else 0
            mode = _keyword(node, "mode") or (node.args[index] if len(node.args) > index else None)
            mode_text = _constant(mode) if mode is not None else "r"
            if not isinstance(mode_text, str):
                found.append((node.lineno, "open with a computed mode"))
                continue
            if "b" in mode_text:
                continue
            # open(path, mode, buffering, encoding)：第 4 个位置参数就是 encoding
            if _keyword(node, "encoding") is None and len(node.args) <= index + 2 and not _has_kwargs_splat(node):
                found.append((node.lineno, f"open({mode_text!r}) without encoding"))
        elif name in ("read_text", "write_text") and isinstance(func, ast.Attribute):
            positional = node.args if name == "read_text" else node.args[1:]
            if _keyword(node, "encoding") is None and not positional and not _has_kwargs_splat(node):
                found.append((node.lineno, f"{name}() without encoding"))
        for flag in ("text", "universal_newlines"):
            value = _keyword(node, flag)
            if value is not None and _constant(value) is not False:
                if _keyword(node, "encoding") is None and _keyword(node, "errors") is None:
                    found.append((node.lineno, f"{flag}=True without encoding or errors"))
    return sorted(found)


class GuardCatchesTest(unittest.TestCase):
    """守卫自己要真能认出问题写法，不然下面那条永远是绿的。"""

    def test_flags_text_io_without_an_encoding(self):
        source = (
            "open(p)\n"
            "open(p, 'w')\n"
            "io.open(p, mode='a')\n"
            "path.open()\n"
            "path.open('w')\n"
            "path.read_text()\n"
            "path.write_text(data)\n"
            "subprocess.run(cmd, capture_output=True, text=True)\n"
            "(runner or subprocess.run)(cmd, text=True)\n"
            "subprocess.check_output(cmd, universal_newlines=True)\n"
        )
        self.assertEqual(list(range(1, 11)), [line for line, _ in text_io_without_encoding(source)])

    def test_leaves_binary_and_explicit_encodings_alone(self):
        source = (
            "open(p, 'rb')\n"
            "path.open('ab')\n"
            "open(p, 'w', encoding='utf-8')\n"
            "path.open('r', encoding='utf-8')\n"
            "path.read_text(encoding='utf-8')\n"
            "path.read_text('utf-8')\n"
            "path.write_text(data, encoding='utf-8')\n"
            "path.read_bytes()\n"
            "subprocess.run(cmd, capture_output=True)\n"
            "subprocess.run(cmd, text=True, encoding='utf-8')\n"
            "subprocess.run(cmd, text=True, errors='replace')\n"
            "subprocess.run(cmd, text=False)\n"
            "webbrowser.open(url)\n"
            "webbrowser.open('https://example.com')\n"
            "store.open(app_id)\n"
            "opener.open(request, timeout=5)\n"
        )
        self.assertEqual([], text_io_without_encoding(source))


class WindowsModulesNameTheirEncodingTest(unittest.TestCase):
    def test_app_windows_modules_name_an_encoding_for_text_io(self):
        modules = sorted((ROOT / "app").glob("windows_*.py"))
        self.assertTrue(modules)
        problems = []
        for path in modules:
            for line, kind in text_io_without_encoding(path.read_text(encoding="utf-8")):
                problems.append(f"{path.relative_to(ROOT).as_posix()}:{line}  {kind}")
        self.assertEqual([], problems, "文本读写要写明 encoding=\"utf-8\"（子进程输出也可以用 errors=\"replace\"）")


if __name__ == "__main__":
    unittest.main()
