"""控制台编码回归测试。

守的 bug：英文 Windows 控制台是 cp1252，`print("中文")` 直接抛
UnicodeEncodeError 把进程干掉。

这个 bug 只在英文 Windows 上复现（中文 Windows 是 cp936，能编码大部分
汉字所以侥幸不炸；macOS/Linux 是 UTF-8 更不会炸）。GitHub Actions 的
windows-latest 正好是英文环境，第一次真跑就撞上了。
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

# 测试要 import app/fanvpn 下的扁平模块（local_proxy / win_sysproxy ...）
_APP = _Path(__file__).resolve().parent.parent / "app"
for _p in (_APP / "fanvpn", _APP):
    if str(_p) not in _sys.path:
        _sys.path.insert(0, str(_p))


import io
import unittest
from unittest import mock

from console_io import ensure_utf8_console, safe_eprint, safe_print


class FakeCp1252Stream(io.TextIOBase):
    """模拟英文 Windows 控制台：只认 cp1252。"""

    encoding = "cp1252"

    def __init__(self):
        self.buffer_out = []
        self.reconfigured = None

    def reconfigure(self, encoding=None, errors=None):
        self.reconfigured = (encoding, errors)

    def write(self, text):
        # 真实 cp1252 编码器遇到中文的行为
        text.encode("cp1252")
        self.buffer_out.append(text)
        return len(text)


class FakeNoneStream:
    """模拟 PyInstaller --windowed：sys.stdout is None。"""

    def __getattr__(self, name):
        raise AttributeError(name)


class TestEnsureUtf8(unittest.TestCase):
    def test_reconfigures_stdout_and_stderr(self):
        out, err = FakeCp1252Stream(), FakeCp1252Stream()
        with mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
            changed = ensure_utf8_console()
        self.assertTrue(changed)
        self.assertEqual(out.reconfigured, ("utf-8", "replace"))
        self.assertEqual(err.reconfigured, ("utf-8", "replace"))

    def test_handles_none_streams(self):
        """--windowed 下 stdout/stderr 是 None，不能炸。"""
        with mock.patch("sys.stdout", None), mock.patch("sys.stderr", None):
            changed = ensure_utf8_console()
        self.assertFalse(changed)

    def test_handles_stream_without_reconfigure(self):
        """被重定向到 StringIO 之类没有 reconfigure 的对象时，静默跳过。"""
        with mock.patch("sys.stdout", io.StringIO()), mock.patch("sys.stderr", io.StringIO()):
            changed = ensure_utf8_console()
        self.assertFalse(changed)

    def test_idempotent(self):
        out = FakeCp1252Stream()
        with mock.patch("sys.stdout", out), mock.patch("sys.stderr", out):
            ensure_utf8_console()
            ensure_utf8_console()
        self.assertEqual(out.reconfigured, ("utf-8", "replace"))


class TestSafePrint(unittest.TestCase):
    def test_does_not_raise_on_unencodable(self):
        """核心：cp1252 流上打印中文不能抛异常。"""
        stream = FakeCp1252Stream()
        with mock.patch("sys.stdout", stream):
            safe_print("节点已就绪")
        # 不允许抛异常，也不要求一定写出去

    def test_does_not_raise_when_stdout_is_none(self):
        with mock.patch("sys.stdout", None):
            safe_print("节点已就绪")  # 不应抛

    def test_normal_print_still_works(self):
        stream = io.StringIO()
        with mock.patch("sys.stdout", stream):
            safe_print("hello")
        self.assertEqual(stream.getvalue(), "hello\n")

    def test_eprint_does_not_raise(self):
        stream = FakeCp1252Stream()
        with mock.patch("sys.stderr", stream):
            safe_eprint("解密失败")
        with mock.patch("sys.stderr", None):
            safe_eprint("解密失败")

    def test_unencodable_is_swallowed_not_crashing(self):
        """连 print 本身都抛 UnicodeEncodeError 时也要吞掉。"""
        class Boom(io.TextIOBase):
            def write(self, text):
                raise UnicodeEncodeError("charmap", text, 0, 1, "boom")

            def flush(self):
                pass

        with mock.patch("sys.stdout", Boom()):
            safe_print("中文")  # 不应抛


if __name__ == "__main__":
    unittest.main(verbosity=2)
