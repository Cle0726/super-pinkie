"""refresh_mac_runtime.py must not silently drop snapshot files.

A whole-snapshot refresh from a runtime that lacked a patch (one missing from
patch/apply-all.mjs ORDER) used to unlink that patch's files from
desktop/windows/mac-runtime, so the fix quietly vanished from Windows.
Everything here runs on temporary directories: no installed app, no ~/.openclaw.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/windows-package/refresh_mac_runtime.py"
VERSION = json.loads((ROOT / "desktop/windows/runtime-manifest.json").read_text(encoding="utf-8"))["openclaw"]


def load_tool():
    spec = importlib.util.spec_from_file_location("refresh_mac_runtime_under_test", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


class RefreshDropGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="refresh-drop-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.snapshot = self.tmp / "snapshot"
        self.mac = self.tmp / "mac"
        self.pristine = self.tmp / "pristine"
        for root in (self.mac / "openclaw", self.pristine):
            write(root / "openclaw.mjs", b"entry\n")
            write(root / "package.json", json.dumps({"version": VERSION}).encode())
            write(root / "dist/stock.js", b"stock\n")
        self.kept = b"// pinkie-kept:v1\n"
        self.patched = b"// pinkie-dropped:v1\n"
        write(self.snapshot / "openclaw/dist/kept.js", self.kept)
        write(self.snapshot / "openclaw/dist/dropped.js", self.patched)
        self.sums = self.snapshot / "SHA256SUMS"
        self.sums.write_text(
            f"{hashlib.sha256(self.kept).hexdigest()}  openclaw/dist/kept.js\n"
            f"{hashlib.sha256(self.patched).hexdigest()}  openclaw/dist/dropped.js\n",
            encoding="utf-8",
        )
        write(self.mac / "openclaw/dist/kept.js", self.kept)
        self.tool = load_tool()
        for name, value in (("SNAPSHOT", self.snapshot), ("SUMS", self.sums),
                            ("MAC_EXTENSIONS", self.tmp / "no-extensions")):
            patcher = mock.patch.object(self.tool, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_tool(self, *extra):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.tool.main(["--mac-runtime", str(self.mac), "--pristine", str(self.pristine), *extra])
        return code, out.getvalue()

    def test_refresh_refuses_to_drop_without_allow_drop(self):
        before = self.sums.read_text(encoding="utf-8")
        with self.assertRaises(SystemExit) as stop:
            self.run_tool()
        self.assertIn("refusing to drop 1", str(stop.exception.code))
        self.assertEqual((self.snapshot / "openclaw/dist/dropped.js").read_bytes(), self.patched)
        self.assertEqual(self.sums.read_text(encoding="utf-8"), before)

    def test_check_still_reports_the_drop(self):
        code, out = self.run_tool("--check")
        self.assertEqual(code, 1)
        self.assertIn("drop   openclaw/dist/dropped.js", out)
        self.assertTrue((self.snapshot / "openclaw/dist/dropped.js").is_file())

    def test_allow_drop_removes_the_file_and_its_checksum(self):
        code, _ = self.run_tool("--allow-drop")
        self.assertEqual(code, 0)
        self.assertFalse((self.snapshot / "openclaw/dist/dropped.js").exists())
        self.assertNotIn("dropped.js", self.sums.read_text(encoding="utf-8"))
        self.assertIn("kept.js", self.sums.read_text(encoding="utf-8"))

    def test_refresh_without_drops_writes_normally(self):
        write(self.mac / "openclaw/dist/dropped.js", self.patched)
        write(self.mac / "openclaw/dist/added.js", b"// pinkie-added:v1\n")
        code, out = self.run_tool()
        self.assertEqual(code, 0)
        self.assertIn("1 added, 0 updated, 0 dropped", out)
        self.assertTrue((self.snapshot / "openclaw/dist/added.js").is_file())
        self.assertIn("openclaw/dist/added.js", self.sums.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
