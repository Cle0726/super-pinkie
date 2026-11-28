import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import windows_native
from app.windows_native import (DEFAULT_HOTKEY, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, WindowsNative,
                                edge_export_command, parse_accelerator, safe_file_name)


def finished_edge(fake_run):
    """Popen stand-in for an Edge that writes its output and exits at once."""
    def popen(command, **kwargs):
        fake_run(command, **kwargs)
        process = mock.MagicMock(pid=4321, returncode=0)
        process.wait.return_value = 0
        process.__enter__.return_value = process
        return process
    return popen


class UnboundedWait(Exception):
    """Stands for a wait that would never return on a real machine."""


class HungEdge:
    """Headless Edge that outlives the export timeout (an Edge helper holds on).

    Every wait with a limit times out; a wait without one is the hang (B111).
    """

    pid = 4321
    returncode = None

    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def _limited(self, name, timeout):
        self.calls.append((name, timeout))
        if timeout is None:
            raise UnboundedWait(f"{name}() without a timeout")
        raise subprocess.TimeoutExpired("msedge", timeout)

    def communicate(self, input=None, timeout=None):
        return self._limited("communicate", timeout)

    def wait(self, timeout=None):
        return self._limited("wait", timeout)

    def kill(self):
        self.calls.append(("kill", None))

    def poll(self):
        return None


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

    def test_hotkey_rejects_long_and_repeated_b43(self):
        # B43: 'Ctrl+' x 100000 + 'A' used to be accepted and written to native-settings.json (600 KB)
        for bad in ("Ctrl+" * 100000 + "A", "Ctrl+Ctrl+A", "Alt+Option+K", "Ctrl+" * 13 + "A", {"a": 1}, ["Ctrl", "A"], 5):
            self.assertIsNone(parse_accelerator(bad), str(bad)[:20])
        self.assertIsNotNone(parse_accelerator("Ctrl+Alt+Shift+Win+K"))
        self.native._call = lambda *args, **kwargs: True
        self.native._post = lambda *args: None
        before = self.native._hotkey
        for bad in ("Ctrl+" * 100000 + "A", "Ctrl+Ctrl+A", {"a": 1}):
            result = self.native.handle({"type": "setHotkey", "accelerator": bad})
            self.assertEqual(result, {"ok": False, "error": "这个快捷键写法不认识"})
        self.assertEqual(self.native._hotkey, before)
        self.assertFalse(self.settings.exists() and "Ctrl+Ctrl" in self.settings.read_text(encoding="utf-8"))

    def test_safe_file_name(self):
        self.assertEqual(safe_file_name('a/b:c?', "pdf"), "a-b-c-.pdf")
        self.assertEqual(safe_file_name("", "png"), "碧琪会话.png")
        self.assertEqual(safe_file_name("x.PDF", "pdf"), "x.PDF")

    def test_safe_file_name_long_keeps_ext_b43(self):
        # B43: the extension used to be added before the 180-char cut, so long titles lost .md / .pdf
        for raw, ext in (("n" * 300, "md"), ("会" * 300 + ".pdf", "pdf"), ("a" * 178 + ". . ", "png")):
            name = safe_file_name(raw, ext)
            self.assertTrue(name.lower().endswith("." + ext), name[-12:])
            self.assertLessEqual(len(name), 180)
            self.assertFalse(name[:-len(ext) - 1].endswith((".", " ")), name[-12:])
        self.assertEqual(safe_file_name("a\x00b\nc", "md"), "a-b-c.md")
        self.assertEqual(safe_file_name("...", "md"), "碧琪会话.md")

    def test_safe_file_name_reserved_device_names_b60(self):
        # B60: "CON.pdf" / "nul" / "COM1" used to pass through, and Windows opens the device instead of a file
        for raw, ext, want in (("CON", "pdf", "CON-.pdf"), ("CON.pdf", "pdf", "CON-.pdf"), ("con.txt.pdf", "pdf", "con-.txt.pdf"),
                               ("nul", "png", "nul-.png"), ("Prn.MD", "md", "Prn-.MD"), ("aux", "md", "aux-.md"),
                               ("COM1", "pdf", "COM1-.pdf"), ("com9.png", "png", "com9-.png"), ("LPT1", "md", "LPT1-.md"),
                               ("lpt9.txt", "pdf", "lpt9-.txt.pdf"), ("CON .pdf", "pdf", "CON-.pdf"), (" Nul ", "md", "Nul-.md")):
            self.assertEqual(safe_file_name(raw, ext), want, raw)
        for raw, ext, want in (("CONSOLE", "pdf", "CONSOLE.pdf"), ("COM10", "pdf", "COM10.pdf"), ("COM0", "pdf", "COM0.pdf"),
                               ("LPT", "md", "LPT.md"), ("NULL.pdf", "pdf", "NULL.pdf"), ("my-con", "pdf", "my-con.pdf"),
                               ("x.con", "pdf", "x.con.pdf"), ("会议 CON", "md", "会议 CON.md"), ("auxiliary.png", "png", "auxiliary.png")):
            self.assertEqual(safe_file_name(raw, ext), want, raw)

    def test_safe_file_name_bare_extension_b60(self):
        # B60: ".pdf" used to lose its leading dot first and come out as "pdf.pdf"
        for raw, ext, want in ((".pdf", "pdf", "碧琪会话.pdf"), (" .md ", "md", "碧琪会话.md"), ("..png", "png", "碧琪会话.png"),
                               (".PDF", "pdf", "碧琪会话.PDF")):
            self.assertEqual(safe_file_name(raw, ext), want, raw)
        for raw, ext, want in (("pdf", "pdf", "pdf.pdf"), (".x.pdf", "pdf", "x.pdf"), (".gitignore", "md", "gitignore.md"),
                               ("report.pdf", "pdf", "report.pdf"), (".pdf", "md", "pdf.md")):
            self.assertEqual(safe_file_name(raw, ext), want, raw)

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

    # ---------- N2 keep-awake ----------
    def _awake_rig(self, start=1000.0):
        posted = []
        clock = [start]
        self.native._post = lambda command, payload=None: posted.append((command, payload))
        self.native._clock = lambda: clock[0]
        return posted, clock

    @staticmethod
    def _ctx(*keys):
        return {"type": "context", "mode": "chat", "running": [{"key": k, "title": k} for k in keys]}

    @staticmethod
    def _awake(posted):
        return [payload for command, payload in posted if command == "awake"]

    def test_awake_held_while_running_released_when_empty(self):
        posted, clock = self._awake_rig()
        self.native.handle(self._ctx("agent:main:a"))
        self.native.handle(self._ctx("agent:main:a", "agent:main:b"))   # still running: no second request
        clock[0] += 10
        self.native.handle(self._ctx())
        self.assertEqual(self._awake(posted), [True, False])

    def test_awake_never_requested_without_running_sessions(self):
        # Counter-case: mode changes and empty lists must not touch the power state.
        posted, _ = self._awake_rig()
        self.native.handle({"type": "context", "mode": "project", "modeLabel": "项目", "running": []})
        self.native.handle({"type": "context", "mode": "chat"})
        self.native.handle({"type": "context", "running": [{"title": "no key"}]})
        self.assertEqual(self._awake(posted), [])

    def test_awake_lease_expires_when_the_page_goes_quiet(self):
        posted, clock = self._awake_rig()
        self.native.handle(self._ctx("agent:main:a"))
        clock[0] += windows_native.AWAKE_LEASE_S - 1
        self.native._awake_tick()
        self.assertEqual(self._awake(posted), [True])           # within the lease: still held
        clock[0] += 2
        self.native._awake_tick()
        self.assertEqual(self._awake(posted), [True, False])    # page silent past the lease
        clock[0] += 5
        self.native.handle(self._ctx("agent:main:a"))           # heartbeat returns -> held again
        self.assertEqual(self._awake(posted), [True, False, True])

    def test_awake_hard_cap_then_rearms_on_a_new_run(self):
        posted, clock = self._awake_rig()
        self.native.handle(self._ctx("agent:main:a"))
        for _ in range(int(windows_native.AWAKE_CAP_S // 60) + 2):   # heartbeats every minute for > cap
            clock[0] += 60
            self.native.handle(self._ctx("agent:main:a"))
        self.assertEqual(self._awake(posted), [True, False])
        clock[0] += 60
        self.native.handle(self._ctx("agent:main:a"))           # same run, still capped
        self.assertEqual(self._awake(posted), [True, False])
        self.native.handle(self._ctx("agent:main:a", "agent:main:b"))   # new run -> allowed again
        self.assertEqual(self._awake(posted), [True, False, True])

    def test_awake_switch_off_releases_and_persists(self):
        posted, _ = self._awake_rig()
        self.native.handle(self._ctx("agent:main:a"))
        self.assertEqual(self.native.handle({"type": "setAwake", "enabled": False}), {"ok": True, "enabled": False})
        self.native.handle(self._ctx("agent:main:a", "agent:main:b"))
        self.assertEqual(self._awake(posted), [True, False])
        self.assertIs(json.loads(self.settings.read_text(encoding="utf-8"))["awake"], False)
        again = WindowsNative(FakeBridge(), self.settings)
        self.assertFalse(again._awake_enabled)

    def test_awake_default_and_bad_setting(self):
        self.assertIs(self.native._awake_enabled, windows_native.AWAKE_DEFAULT)
        self.settings.write_text(json.dumps({"awake": "yes"}), encoding="utf-8")
        self.assertIs(WindowsNative(FakeBridge(), self.settings)._awake_enabled, windows_native.AWAKE_DEFAULT)

    def test_awake_flags_are_system_only(self):
        self.assertEqual(windows_native.ES_SYSTEM_REQUIRED, 0x1)
        self.assertEqual(windows_native.ES_CONTINUOUS, 0x80000000)
        source = Path(windows_native.__file__).read_text(encoding="utf-8")
        self.assertNotIn("ES_DISPLAY_REQUIRED", source)          # the screen still turns off and locks
        self.assertIn('set_awake(False)\n                    remove_icon()', source)   # stop drops it on the tray thread

    def test_stop_without_tray_forgets_awake(self):
        posted, _ = self._awake_rig()
        self.native.handle(self._ctx("agent:main:a"))
        self.native.stop()
        self.assertFalse(self.native._awake_on)

    def test_menubar_and_hotkey_persist(self):
        self.native._post = lambda *args: None
        self.native.handle({"type": "setMenubar", "enabled": False})
        self.native._call = lambda command, payload=None: payload == "Ctrl+Alt+K"
        self.assertEqual(self.native.handle({"type": "setHotkey", "accelerator": "Ctrl+Alt+K"}),
                         {"ok": True, "accelerator": "Ctrl+Alt+K"})
        saved = json.loads(self.settings.read_text(encoding="utf-8"))
        self.assertEqual(saved, {"menubar": False, "hotkey": "Ctrl+Alt+K", "awake": windows_native.AWAKE_DEFAULT})
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

    def test_context_fields_capped_b43(self):
        # B43: mode / modeLabel / running titles used to be stored at any length (1 MB each made it in)
        self.native._post = lambda *args: None
        self.native.handle({"type": "context", "mode": "m" * 1_000_000, "modeLabel": "L" * 1_000_000,
                            "running": [{"key": "k" * 1_000, "title": "t" * 1_000_000}]})
        self.assertEqual(len(self.native.mode), 32)
        self.assertEqual(len(self.native.mode_label), 32)
        self.assertEqual([(len(k), len(t)) for k, t in self.native._running], [(300, 80)])
        self.native.handle({"type": "context", "mode": "project", "modeLabel": "项目",
                            "running": [{"key": "agent:main:a", "title": "天气"}]})
        self.assertEqual((self.native.mode, self.native.mode_label, self.native._running),
                         ("project", "项目", [("agent:main:a", "天气")]))
        # non-strings are ignored, not str()-ed into the tray menu
        self.native.handle({"type": "context", "mode": {"x": 1}, "modeLabel": ["a"],
                            "running": [{"key": {"x": 1}}, {"key": 5}, {"key": "b", "title": {"t": 1}}, None, 1]})
        self.assertEqual((self.native.mode, self.native.mode_label, self.native._running),
                         ("project", "项目", [("b", "未命名会话")]))

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
                mock.patch.object(windows_native.subprocess, "Popen", side_effect=finished_edge(fake_run)), \
                mock.patch.dict(os.environ, {"PINKIE_EXPORT_DIR": str(out_dir)}):
            result = self.native.handle({"type": "exportPDF", "html": "<p>x</p>", "fileName": "会话-20261111"})
        self.assertTrue(result["ok"], result)
        self.assertEqual((out_dir / "会话-20261111.pdf").read_bytes(), b"%PDF-1.4")

    def test_clamp_size_b43(self):
        # B43: page-supplied export sizes are clamped; anything that is not a finite number falls back to the default
        self.assertEqual(windows_native.clamp_size(900, 900, 320, 2400), 900)
        self.assertEqual(windows_native.clamp_size(10 ** 9, 900, 320, 2400), 2400)
        self.assertEqual(windows_native.clamp_size(-5, 1200, 400, 16000), 400)
        self.assertEqual(windows_native.clamp_size(1234.7, 1200, 400, 16000), 1234)
        for bad in (None, "wide", "900", [1], {}, True, float("nan"), float("inf")):
            self.assertEqual(windows_native.clamp_size(bad, 900, 320, 2400), 900, bad)

    def test_export_bad_sizes_b43(self):
        # B43: before this, width [1] raised TypeError, 'wide' sent Python's error text to the page, and 10**9 went straight to Edge
        out_dir = Path(self.tmp.name) / "sizes"
        out_dir.mkdir()
        sizes = []

        def fake_run(command, **_):
            sizes.append(next(part for part in command if part.startswith("--window-size=")))
            target = next(part.split("=", 1)[1] for part in command if part.startswith("--screenshot="))
            Path(target).write_bytes(b"png")

        cases = [([1], {}, "900,1200"), ("wide", "tall", "900,1200"), (10 ** 9, 10 ** 9, "2400,16000"), (900, 3000, "900,3000")]
        with mock.patch.object(windows_native, "find_edge", return_value=Path("edge.exe")), \
                mock.patch.object(windows_native.subprocess, "Popen", side_effect=finished_edge(fake_run)), \
                mock.patch.dict(os.environ, {"PINKIE_EXPORT_DIR": str(out_dir)}):
            for index, (width, height, _) in enumerate(cases):
                result = self.native.handle({"type": "exportImage", "html": "<p>x</p>", "fileName": f"s{index}",
                                             "width": width, "height": height})
                self.assertTrue(result["ok"], (width, height, result))
        self.assertEqual(sizes, ["--window-size=" + expected for _, _, expected in cases])

    def _export_with_hung_edge(self, kill=None):
        out_dir = Path(self.tmp.name) / "hung"
        out_dir.mkdir(exist_ok=True)
        process = HungEdge()
        with mock.patch.object(windows_native, "find_edge", return_value=Path("edge.exe")), \
                mock.patch.object(windows_native.subprocess, "Popen", return_value=process), \
                mock.patch.object(windows_native, "_taskkill", side_effect=kill, create=True) as tree, \
                mock.patch.dict(os.environ, {"PINKIE_EXPORT_DIR": str(out_dir)}):
            result = self.native.handle({"type": "exportPDF", "html": "<p>x</p>", "fileName": "hung"})
        return result, process, tree, out_dir

    def assert_edge_ended_within_limits(self, process, tree):
        self.assertEqual(process.calls[0], ("wait", windows_native.EXPORT_TIMEOUT_S))
        # taskkill /T ends msedge.exe and the helpers it started.
        tree.assert_called_once_with(process.pid, 5)
        self.assertIn(("kill", None), process.calls)
        waits = [timeout for name, timeout in process.calls if name in ("communicate", "wait")]
        self.assertNotIn(None, waits, process.calls)

    def test_export_timeout_ends_edge_and_returns_b111(self):
        # B111: a timed-out export used to wait with no limit after killing msedge.exe
        result, process, tree, out_dir = self._export_with_hung_edge()
        self.assertEqual(result, {"ok": False, "error": f"PDF导出超过 {windows_native.EXPORT_TIMEOUT_S} 秒没完成，已停止"})
        self.assert_edge_ended_within_limits(process, tree)
        self.assertEqual(list(out_dir.iterdir()), [])

    def test_export_timeout_returns_even_if_taskkill_fails_b111(self):
        result, process, tree, _ = self._export_with_hung_edge(kill=OSError("no taskkill"))
        self.assertFalse(result["ok"])
        self.assertIn("秒没完成", result["error"])
        self.assert_edge_ended_within_limits(process, tree)

    def test_edge_output_is_not_piped_b111(self):
        # Nothing reads Edge's output, so nothing may be left to wait on.
        calls = []

        def fake_run(command, **kwargs):
            calls.append(kwargs)
            target = next(part.split("=", 1)[1] for part in command if part.startswith("--print-to-pdf="))
            Path(target).write_bytes(b"%PDF-1.4")

        out_dir = Path(self.tmp.name) / "pipes"
        out_dir.mkdir()
        with mock.patch.object(windows_native, "find_edge", return_value=Path("edge.exe")), \
                mock.patch.object(windows_native.subprocess, "Popen", side_effect=finished_edge(fake_run)), \
                mock.patch.dict(os.environ, {"PINKIE_EXPORT_DIR": str(out_dir)}):
            self.assertTrue(self.native.handle({"type": "exportPDF", "html": "<p>x</p>", "fileName": "p"})["ok"])
        self.assertEqual(len(calls), 1)
        for stream in ("stdin", "stdout", "stderr"):
            self.assertEqual(calls[0].get(stream), subprocess.DEVNULL, stream)

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
