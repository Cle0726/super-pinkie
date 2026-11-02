import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'tools/windows-package/activate_update_dialog.py'
spec = importlib.util.spec_from_file_location('activate_update_dialog', MODULE)
activate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activate)


class UpdateAssetsTests(unittest.TestCase):
    def test_legacy_update_entry_uses_the_complete_shared_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            control = Path(directory)
            index = control / 'index.html'
            original = '<html><head><script>\nboot();\n</script><script type="module" src="/assets/index-test.js"></script></head><body><openclaw-app></openclaw-app></body></html>'
            index.write_text(original)
            template = (ROOT / 'ui/control-ui.index.html').read_text()
            for name in re.findall(r'(?:src|href)=["\']\.?/(assets/[^?"\']+)', template):
                file = control / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('upstream fixture')
            result = activate.activate(ROOT / 'ui', control)
            self.assertIn('laolao-update-dialog.js', result['resources'])
            self.assertIn('laolao-deep-think-full.webm', result['resources'])
            self.assertIn('fonts/PinkieUI-NotoSansSC.woff2', result['resources'])
            html = index.read_bytes()
            inline = rb'<script\b(?![^>]*src=)[^>]*>(.*?)</script>'
            self.assertEqual(re.findall(inline, html, re.S), re.findall(inline, template.encode(), re.S))
            self.assertEqual(html.count(b'laolao-update-dialog.js'), 1)
            activate.activate(ROOT / 'ui', control)
            self.assertEqual(html, index.read_bytes())


if __name__ == '__main__':
    unittest.main()
