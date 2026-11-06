"""从 FanVPN 扩展源码里提取 RSA 私钥。

为什么这样做
------------
碧琪的运行时包里没有单独的 ``_key.pem``，密钥就在 FanVPN 扩展的
``background.js`` 第一行 —— 那是扩展原本的设计：浏览器扩展必须在
前端解密节点配置，所以私钥必须随扩展下发，它本来就不是秘密。

这把私钥保护的是"配置不被随手抓取"，不是"节点不可被发现"。
真要更强，得服务端签发短期凭证，那是另一套工作量。

查找顺序
--------
1. ``resources/fanvpn/background.js`` —— 打包时带进去的
2. ``app/fanvpn/background.js``       —— 源码目录
3. ``~/.openclaw/fanvpn/background.js`` —— 用户自备
4. 各目录下的 ``_key.pem``           —— 显式放 pem 的情况
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Optional

# background.js 里的写法：const PRIVATE_KEY_PEM = `-----BEGIN ...-----END ...-----`;
_PEM_BLOCK = re.compile(
    r"-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----"
)


def _looks_like_pem(text: str) -> bool:
    return "BEGIN" in text and "PRIVATE KEY" in text and "END PRIVATE KEY" in text


def _candidate_dirs() -> list[Path]:
    here = Path(__file__).resolve().parent
    dirs = [
        here / "fanvpn",                    # app/fanvpn/
        here,                               # app/
    ]
    # 打包后 resources/ 与 app/ 平级
    dirs.append(here.parent / "resources" / "fanvpn")
    root = Path(getattr(sys, "_MEIPASS", here))
    dirs.append(root / "resources" / "fanvpn")
    dirs.append(root / "fanvpn")
    try:
        dirs.append(Path.home() / ".openclaw" / "fanvpn")
    except RuntimeError:  # 极少数无 HOME 的环境
        pass
    return dirs


def extract_from_js() -> Optional[str]:
    """在候选目录里找 background.js / _key.pem，返回 PEM 文本。"""
    for directory in _candidate_dirs():
        # 先找 pem（更直接）
        pem_file = directory / "_key.pem"
        try:
            if pem_file.is_file():
                text = pem_file.read_text(encoding="utf-8")
                if _looks_like_pem(text):
                    return text if text.endswith("\n") else text + "\n"
        except OSError:
            pass

        for name in ("background.js", "FanVPN/background.js"):
            js = directory / name
            try:
                if not js.is_file():
                    continue
                source = js.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            match = _PEM_BLOCK.search(source)
            if match:
                return match.group(0) + "\n"
    return None


def where() -> Optional[str]:
    """调试用：告诉人密钥是从哪个文件来的。"""
    for directory in _candidate_dirs():
        for name in ("_key.pem", "background.js", "FanVPN/background.js"):
            path = directory / name
            if path.is_file():
                try:
                    if _looks_like_pem(path.read_text(encoding="utf-8", errors="replace")):
                        return str(path)
                except OSError:
                    continue
    return None
