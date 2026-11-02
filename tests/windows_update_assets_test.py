import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).parents[1] / 'tools/windows-package/activate_update_dialog.py'
spec = importlib.util.spec_from_file_location('activate_update_dialog', MODULE)
activate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activate)


class UpdateAssetsTests(unittest.TestCase):
    def test_injects_once_preserving_inline_bytes_and_replaces_cache_key(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            src = root / 'ui/injections'
            control = root / 'control'
            src.mkdir(parents=True)
            control.mkdir()
            for asset in activate.ASSETS:
                (src / asset).write_bytes(b'__pinkieUpdateDialog')
            original = b'<html>\n<head>\n<script>\nconst x = 1;\n</script>\n<script src="./laolao-settings-user.js?v=settingsuser4"></script>\n</head></html>'
            (control / 'index.html').write_bytes(original)
            activate.activate(src.parent, control)
            html = (control / 'index.html').read_bytes()
            self.assertIn(b'<script>\nconst x = 1;\n</script>', html)
            self.assertIn(b'laolao-settings-user.js?v=settingsuser5', html)
            self.assertEqual(html.count(b'laolao-update-dialog.js'), 1)
            self.assertEqual(html.count(b'laolao-update-dialog.css'), 1)
            activate.activate(src.parent, control)
            self.assertEqual(html, (control / 'index.html').read_bytes())

    def test_missing_shared_assets_fails_before_touching_index(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'ui/injections').mkdir(parents=True)
            (root / 'control').mkdir()
            index = root / 'control/index.html'
            index.write_bytes(b'<head></head>')
            with self.assertRaises(ValueError):
                activate.activate(root / 'ui', root / 'control')
            self.assertEqual(index.read_bytes(), b'<head></head>')

if __name__ == '__main__':
    unittest.main()
