import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import windows_native
from app.windows_native import (DEFAULT_HOTKEY, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, WindowsNative,
                                edge_export_command, parse_accelerator, safe_file_name)


class FakeWindow:
    def __init__(self):
        self.scripts = []

    def evaluate_js(self, script):
        self.scripts.append(script)


class FakeBridge:
    def __init__(self):
        self._window = FakeWindow()


class WindowsNativeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Path(self.tmp.name) / "native.json"
        self.native = WindowsNative(FakeBridge(), self.settings)

    def tearDown(self):
        self.tmp.cleanup()

    def test_parse_accelerator(self):
        self.assertEqual(parse_accelerator("Ctrl+Alt+Space"), (MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x20))
        self.assertEqual(parse_accelerator("Alt+K")[1], ord("K"))
        self.assertIsNone(parse_accelerator("Space"))
        self.assertIsNone(parse_accelerator("Hyper+Space"))
        self.assertIsNone(parse_accelerator("Ctrl+F13"))

    def test_safe_file_name(self):
        self.assertEqual(safe_file_name('a/b:c?', "pdf"), "a-b-c-.pdf")
        self.assertEqual(safe_file_name("", "png"), "碧琪会话.png")
        self.assertEqual(safe_file_name("x.PDF", "pdf"), "x.PDF")

    def test_notify_dedupes_by_run_id(self):
        posted = []
        self.native._post = lambda command, payload=None: posted.append((command, payload))
        message = {"type": "notify", "id": "run-1", "sessionKey": "agent:main:x", "title": "碧琪 · 测试", "body": "做完了"}
        self.assertEqual(self.native.handle(message), {"ok": True})
        self.assertTrue(self.native.handle(message).get("skipped"))
        self.assertEqual(posted, [("balloon", ("碧琪 · 测试", "做完了"))])

    def test_unknown_and_context(self):
        self.assertFalse(self.native.handle({"type": "nope"})["ok"])
        self.native.handle({"type": "context", "mode": "project", "modeLabel": "项目",
                            "running": [{"key": "agent:project:a", "title": "甲"}, {"title": "no key"}]})
        self.assertEqual(self.native.mode_label, "项目")
        self.assertEqual(self.native._running, [("agent:project:a", "甲")])

    def test_menubar_and_hotkey_persist(self):
        self.native._post = lambda *args: None
        self.native.handle({"type": "setMenubar", "enabled": False})
        self.native._call = lambda command, payload=None: payload == "Ctrl+Alt+K"
        self.assertEqual(self.native.handle({"type": "setHotkey", "accelerator": "Ctrl+Alt+K"}),
                         {"ok": True, "accelerator": "Ctrl+Alt+K"})
        saved = json.loads(self.settings.read_text(encoding="utf-8"))
        self.assertEqual(saved, {"menubar": False, "hotkey": "Ctrl+Alt+K"})
        again = WindowsNative(FakeBridge(), self.settings)
        self.assertFalse(again._menubar)
        self.assertEqual(again._hotkey, "Ctrl+Alt+K")

    def test_hotkey_conflict_falls_back(self):
        self.native._call = lambda command, payload=None: payload == DEFAULT_HOTKEY
        result = self.native.handle({"type": "setHotkey", "accelerator": "Alt+Space"})
        self.assertEqual(result, {"ok": True, "conflict": True, "accelerator": DEFAULT_HOTKEY})
        self.native._call = lambda command, payload=None: False
        self.assertFalse(self.native.handle({"type": "setHotkey", "accelerator": "Alt+Space"})["ok"])
        self.assertFalse(self.native.handle({"type": "setHotkey", "accelerator": "Banana"})["ok"])

    def test_hotkey_off(self):
        self.native._post = lambda *args: None
        self.assertEqual(self.native.handle({"type": "setHotkey", "accelerator": None}), {"ok": True, "accelerator": None})

    def test_open_missing_file(self):
        self.assertFalse(self.native.handle({"type": "revealFile", "path": "/nope/missing.txt"})["ok"])

    def test_quick_submit_emits_event(self):
        self.native.mode = "thinking"
        self.native.quick_submit("  你好  ")
        script = self.native._bridge._window.scripts[-1]
        self.assertIn("pinkie-native", script)
        self.assertIn('"type": "quickAsk"', script)
        self.assertIn('"text": "你好"', script)

    def test_edge_command(self):
        pdf = edge_export_command(Path("C:/edge.exe"), Path(self.tmp.name) / "a.html", Path(self.tmp.name) / "o.pdf", True)
        self.assertTrue(any(part.startswith("--print-to-pdf=") for part in pdf))
        png = edge_export_command(Path("C:/edge.exe"), Path(self.tmp.name) / "a.html", Path(self.tmp.name) / "o.png", False, 900, 3000)
        self.assertIn("--window-size=900,3000", png)

    def test_export_without_edge(self):
        with mock.patch.object(windows_native, "find_edge", return_value=None):
            self.assertIn("Edge", self.native.handle({"type": "exportPDF", "html": "<p>x</p>", "fileName": "a"})["error"])

    def test_export_with_fake_edge(self):
        out_dir = Path(self.tmp.name) / "out"
        out_dir.mkdir()

        def fake_run(command, **_):
            target = next(part.split("=", 1)[1] for part in command if part.startswith("--print-to-pdf="))
            Path(target).write_bytes(b"%PDF-1.4")

        with mock.patch.object(windows_native, "find_edge", return_value=Path("edge.exe")), \
                mock.patch.object(windows_native.subprocess, "run", side_effect=fake_run), \
                mock.patch.dict(os.environ, {"PINKIE_EXPORT_DIR": str(out_dir)}):
            result = self.native.handle({"type": "exportPDF", "html": "<p>x</p>", "fileName": "会话-20261111"})
        self.assertTrue(result["ok"], result)
        self.assertEqual((out_dir / "会话-20261111.pdf").read_bytes(), b"%PDF-1.4")

    def test_export_markdown_copies_assets(self):
        out_dir = Path(self.tmp.name) / "md"
        out_dir.mkdir()
        image = Path(self.tmp.name) / "img.png"
        image.write_bytes(b"png")
        message = {"type": "exportMarkdown", "fileName": "天气-20261111", "assetDir": "__assets__",
                   "markdown": "# 天气\n\n![a](./__assets__/a.png)\n",
                   "assets": [{"name": "a.png", "path": str(image)}, {"name": "../evil", "path": str(image)}]}
        with mock.patch.dict(os.environ, {"PINKIE_EXPORT_DIR": str(out_dir)}):
            result = self.native.handle(message)
        self.assertTrue(result["ok"], result)
        text = (out_dir / "天气-20261111.md").read_text(encoding="utf-8")
        self.assertIn("](./%E5%A4%A9%E6%B0%94-20261111-%E9%99%84%E4%BB%B6/a.png)", text)
        self.assertEqual((out_dir / "天气-20261111-附件" / "a.png").read_bytes(), b"png")
        self.assertFalse((out_dir / "evil").exists())


if __name__ == "__main__":
    unittest.main()
