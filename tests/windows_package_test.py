import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("clean_windows_ui", ROOT / "tools/windows-package/clean_ui.py")
cleaner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)


class WindowsPackageTests(unittest.TestCase):
    def test_separate_product_assets_are_removed_without_breaking_the_workbench_icon(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui, control, installer = root / "ui", root / "control-ui", root / "installer"
            for path in (ui / "injections", ui / "assets", control, installer):
                path.mkdir(parents=True, exist_ok=True)
            for path in (ui / "injections", control):
                for name in cleaner.STAGE_FILES:
                    (path / name).write_text("separate product", encoding="utf-8")
                (path / "laolao-workbench.css").write_text('mask: url("./laolao-cle-mark.svg")', encoding="utf-8")
                (path / "laolao-context-compact.js").write_text('icon.textContent = "C.le.";', encoding="utf-8")
                (path / "laolao-usage-stats.js").write_text('"今日 · C.le 本地统计"', encoding="utf-8")
            (ui / "assets/CLeAppIcon.icns").write_bytes(b"icon")
            (control / "CLeAppIcon.icns").write_bytes(b"icon")
            markup = '<link rel="stylesheet" href="/laolao-cle-stage.css?v=1">\n<script defer src="/laolao-cle-signature.js"></script>\n<script type="module" src="/laolao-cle-stage.js"></script>\n<script src="/pinkie.js"></script>\n'
            for file in (ui / "injections/laolao-head.fragment.html", control / "index.html"):
                file.write_text(markup, encoding="utf-8")
            script = installer / "apply-theme.ps1"
            script.write_text("$headTags = @(\n    '<script defer src=\"./laolao-cle-signature.js\"></script>',\n    '<script src=\"./pinkie.js\"></script>'\n)\n", encoding="utf-8-sig")
            cleaner.clean(ui, control, installer)
            for path in (ui / "injections", control):
                self.assertTrue(all(not (path / name).exists() for name in cleaner.STAGE_FILES))
                self.assertIn('url("./ProviderIcon-crossmodel.svg")', (path / "laolao-workbench.css").read_text())
                self.assertIn('icon.textContent = "碧琪"', (path / "laolao-context-compact.js").read_text())
                self.assertIn('碧琪本地统计', (path / "laolao-usage-stats.js").read_text())
            self.assertFalse((ui / "assets/CLeAppIcon.icns").exists())
            self.assertFalse((control / "CLeAppIcon.icns").exists())
            for file in (ui / "injections/laolao-head.fragment.html", control / "index.html"):
                result = file.read_text()
                self.assertNotIn("laolao-cle-", result)
                self.assertIn('/pinkie.js', result)
            self.assertNotIn("<script defer src=\"./laolao-cle-signature.js", script.read_text(encoding="utf-8-sig"))
            self.assertTrue(script.read_bytes().startswith(b"\xef\xbb\xbf"))
            self.assertEqual((control / "laolao-stats.json").read_text(), "null\n")
            self.assertEqual((control / "laolao-quota.json").read_text(), "null\n")

    def test_package_check_detects_the_other_products_installer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / "_internal/installer/windows/apply-theme.ps1"
            installer.parent.mkdir(parents=True)
            installer.write_text("safe")
            cleaner.check_package(root)
            forbidden = root / "_internal/installer/cle/overlay.json"
            forbidden.parent.mkdir(parents=True)
            forbidden.write_text("other product")
            with self.assertRaisesRegex(ValueError, "separate product asset"):
                cleaner.check_package(root)


if __name__ == "__main__":
    unittest.main()
