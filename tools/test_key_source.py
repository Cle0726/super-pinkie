"""密钥来源的回归测试（碧琪版）。

碧琪的运行时包里没有单独的 ``_key.pem``，密钥来自 FanVPN 扩展的
``background.js``。这个测试守住两件事：

1. 从 js 里提取出来的 PEM 形状合法，且能与 pem 文件互相印证
2. 找不到密钥时报错要说得清怎么办，而不是只说 failed

不依赖任何被 gitignore 的文件 —— CI 干净 checkout 上也能跑。
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

_APP = _Path(__file__).resolve().parent.parent / "app"
for _p in (_APP / "fanvpn", _APP):
    if str(_p) not in _sys.path:
        _sys.path.insert(0, str(_p))

import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import win_bootstrap_keys
from win_bootstrap_keys import _looks_like_pem, extract_from_js, where

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app"
BG_JS = APP / "fanvpn" / "background.js"


def make_pem() -> str:
    """造一个形状合法的 PEM（不要求能解密，只测解析路径）。"""
    body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ" * 3
    return (
        "-----BEGIN PRIVATE KEY-----\n"
        + "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
        + "\n-----END PRIVATE KEY-----\n"
    )


class TestLooksLikePem(unittest.TestCase):
    def test_accepts_valid(self):
        self.assertTrue(_looks_like_pem(make_pem()))

    def test_rejects_garbage(self):
        self.assertFalse(_looks_like_pem("not a key"))
        self.assertFalse(_looks_like_pem(""))
        self.assertFalse(_looks_like_pem("-----BEGIN PRIVATE KEY-----"))


class TestExtractFromJs(unittest.TestCase):
    def test_background_js_exists_in_app(self):
        """前提：打包时 background.js 必须在 app/fanvpn 下。"""
        self.assertTrue(BG_JS.is_file(), f"缺少 {BG_JS}")

    def test_extracts_valid_pem_shape(self):
        key = extract_from_js()
        self.assertIsNotNone(key, "从 background.js 提取失败")
        assert key is not None
        body = re.sub(r"-----[^-]+-----", "", key)
        self.assertGreater(len("".join(body.split())), 1000)
        self.assertTrue(key.strip().endswith("-----END PRIVATE KEY-----"))

    def test_where_reports_a_path(self):
        """where() 要能告诉人密钥来自哪个文件，便于排错。"""
        self.assertIsNotNone(where())

    def test_pem_file_wins_over_js(self):
        """同目录既有 _key.pem 又有 js 时，优先用 pem。"""
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            pem_text = make_pem()
            (d / "_key.pem").write_text(pem_text, encoding="utf-8")
            (d / "background.js").write_text(
                "const K = `" + make_pem().replace("\n", "\\n") + "`;", encoding="utf-8"
            )
            with mock.patch.object(win_bootstrap_keys, "_candidate_dirs", return_value=[d]):
                got = extract_from_js()
        assert got is not None
        self.assertEqual("".join(got.split()), "".join(pem_text.split()))

    def test_falls_back_to_js_when_no_pem(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            pem_text = make_pem()
            (d / "background.js").write_text(
                "const PRIVATE_KEY_PEM = `" + pem_text + "`;", encoding="utf-8"
            )
            with mock.patch.object(win_bootstrap_keys, "_candidate_dirs", return_value=[d]):
                got = extract_from_js()
        assert got is not None
        self.assertEqual("".join(got.split()), "".join(pem_text.split()))

    def test_returns_none_when_nothing_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(
                win_bootstrap_keys, "_candidate_dirs", return_value=[Path(tmp)]
            ):
                self.assertIsNone(extract_from_js())

    def test_ignores_js_without_pem(self):
        """background.js 里没有 PEM 时不能返回垃圾。"""
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / "background.js").write_text("console.log('nothing here');", encoding="utf-8")
            with mock.patch.object(win_bootstrap_keys, "_candidate_dirs", return_value=[d]):
                self.assertIsNone(extract_from_js())


if __name__ == "__main__":
    unittest.main(verbosity=2)
