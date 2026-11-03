import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("clean_windows_ui", ROOT / "tools/windows-package/clean_ui.py")
cleaner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)


class WindowsPackageTests(unittest.TestCase):
    def test_retired_product_is_removed_and_the_author_signature_stays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui, control, installer = root / "ui", root / "control-ui", root / "installer"
            for path in (ui / "injections", ui / "assets", control, installer):
                path.mkdir(parents=True, exist_ok=True)
            signature = ("laolao-cle-signature.js", "laolao-cle-stage.js", "laolao-cle-stage.css", "laolao-cle-space.js", "laolao-cle-mark.svg")
            for path in (ui / "injections", control):
                for name in signature:
                    (path / name).write_text("C.le.", encoding="utf-8")
                (path / "laolao-context-compact.js").write_text('icon.textContent = "C.le.";', encoding="utf-8")
            (ui / "assets/CLeAppIcon.icns").write_bytes(b"icon")
            (control / "CLeAppIcon.icns").write_bytes(b"icon")
            markup = '<link rel="stylesheet" href="/laolao-cle-stage.css?v=1">\n<script defer src="/laolao-cle-signature.js"></script>\n<script src="/pinkie.js"></script>\n'
            index = control / "index.html"
            index.write_text(markup, encoding="utf-8")
            cleaner.clean(ui, control, installer)
            for path in (ui / "injections", control):
                self.assertTrue(all((path / name).exists() for name in signature))
                self.assertIn('icon.textContent = "C.le."', (path / "laolao-context-compact.js").read_text())
            self.assertEqual(index.read_text(), markup)
            self.assertFalse((ui / "assets/CLeAppIcon.icns").exists())
            self.assertFalse((control / "CLeAppIcon.icns").exists())
            self.assertEqual((control / "laolao-stats.json").read_text(), "null\n")
            self.assertEqual((control / "laolao-quota.json").read_text(), "null\n")

    def test_rewrite_keeps_line_endings_so_inline_scripts_keep_their_csp_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            index = Path(directory) / "index.html"
            original = b"\xef\xbb\xbf<script>\n  boot();\n</script>\n<script src=\"/laolao-cle-stage.js\"></script>\n"
            index.write_bytes(original)
            cleaner.rewrite(index, lambda text: text.replace('<script src="/laolao-cle-stage.js"></script>\n', ""))
            self.assertEqual(index.read_bytes(), b"\xef\xbb\xbf<script>\n  boot();\n</script>\n")
            cleaner.check_inline_scripts(index)
            index.write_bytes(b"<script>\r\n  boot();\r\n</script>\r\n")
            with self.assertRaisesRegex(ValueError, "CRLF"):
                cleaner.check_inline_scripts(index)

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
