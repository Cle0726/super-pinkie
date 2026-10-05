import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "super_pinkie_windows_desktop",
    REPO_ROOT / "app" / "windows_desktop.py",
)
WINDOWS_DESKTOP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WINDOWS_DESKTOP)


class WindowsMaterialPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name) / "home"
        self.home.mkdir()
        self.bridge = WINDOWS_DESKTOP.NativeBridge(None)

    def tearDown(self):
        self.temp.cleanup()

    def call_bridge(self, action, path):
        with mock.patch.object(Path, "home", return_value=self.home):
            return self.bridge.preview_material({"action": action, "path": str(path)})

    def test_workspace_html_gets_network_blocking_policy(self):
        workspace = self.home / ".openclaw" / "workspace-unrestricted"
        workspace.mkdir(parents=True)
        html = workspace / "preview.html"
        html.write_text('<html><body><script>window.ready = true</script></body></html>', encoding="utf-8")

        result = self.call_bridge("open", html)

        self.assertTrue(result["ok"])
        content = base64.b64decode(result["src"].split(",", 1)[1])
        self.assertIn(b"Content-Security-Policy", content)
        self.assertIn(b"connect-src 'none'", content)
        self.assertIn(b"frame-src 'none'", content)
        self.assertIn(b"window.ready", content)

    def test_openclaw_configuration_is_denied_but_workspace_is_allowed(self):
        config = self.home / ".openclaw" / "config"
        config.mkdir(parents=True)
        credentials = config / "credentials.json"
        credentials.write_text("private", encoding="utf-8")
        self.assertFalse(self.call_bridge("check", credentials)["ok"])

        workspace = self.home / ".openclaw" / "workspace"
        workspace.mkdir()
        note = workspace / "notes.txt"
        note.write_text("visible output", encoding="utf-8")
        self.assertTrue(self.call_bridge("check", note)["ok"])

    def test_save_uses_downloads_and_avoids_overwriting_existing_files(self):
        source = self.home / "report.csv"
        source.write_text("new", encoding="utf-8")
        downloads = self.home / "Downloads"
        downloads.mkdir()
        (downloads / "report.csv").write_text("old", encoding="utf-8")

        result = self.call_bridge("save", source)

        self.assertTrue(result["ok"])
        saved = Path(result["path"])
        self.assertEqual(saved, downloads / "report (2).csv")
        self.assertEqual(saved.read_text(encoding="utf-8"), "new")
        self.assertEqual((downloads / "report.csv").read_text(encoding="utf-8"), "old")


if __name__ == "__main__":
    unittest.main()
