"""控制台编码兜底：让中文输出在任何 Windows 上都不炸。

为什么需要这个
--------------
Windows 控制台默认编码不是 UTF-8：
  * 中文版 Windows 是 cp936（GBK）
  * 英文版 Windows 是 cp1252（西欧）

在 cp1252 上 `print("节点已就绪")` 会直接抛：

    UnicodeEncodeError: 'charmap' codec can't encode characters in
    position 3-6: character maps to <undefined>

这个 bug 在 macOS / Linux 上永远复现不了（那边默认 UTF-8），
只有真的在英文 Windows 上跑一次才会暴露 —— GitHub Actions 的
windows-latest 正好是英文环境，一跑就出来了。

修法不是「别输出中文」，而是把流的编码显式改成 UTF-8。
Python 3.7+ 的 `reconfigure()` 可以原地改已存在的流。

注意 PyInstaller --windowed 下 sys.stdout 是 None，所以必须先判空 ——
这也是为什么这里不能简单地 `sys.stdout.reconfigure(...)` 了事。
"""

from __future__ import annotations

import sys
from typing import Any


def _fix_stream(stream: Any) -> bool:
    """把单个流改成 UTF-8。返回是否成功改过。"""
    if stream is None:
        return False
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is None:
        return False
    try:
        # errors="replace"：即使有极端字符也宁可显示成 ? ，
        # 不能让整个程序因为一句提示文案崩掉。
        reconfigure(encoding="utf-8", errors="replace")
        return True
    except (ValueError, OSError):
        # 流已经关闭 / 被重定向到不支持的对象，忽略即可
        return False


def ensure_utf8_console() -> bool:
    """在所有入口点调用一次。幂等，反复调用无副作用。"""
    changed = False
    changed = _fix_stream(sys.stdout) or changed
    changed = _fix_stream(sys.stderr) or changed
    return changed


def safe_print(*args: Any, **kwargs: Any) -> None:
    """print 的兜底版本：流不可用或编码失败时静默跳过。

    --windowed 打包后没有控制台，print 会抛 AttributeError，
    所以业务代码里应当用这个而不是裸 print。
    """
    if sys.stdout is None:
        return
    try:
        print(*args, **kwargs)
    except (UnicodeEncodeError, AttributeError, ValueError):
        pass


def safe_eprint(*args: Any, **kwargs: Any) -> None:
    if sys.stderr is None:
        return
    kwargs.setdefault("file", sys.stderr)
    try:
        print(*args, **kwargs)
    except (UnicodeEncodeError, AttributeError, ValueError):
        pass
