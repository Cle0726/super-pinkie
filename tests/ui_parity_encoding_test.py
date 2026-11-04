import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tests import ui_parity_test


class SharedUiEncodingTests(unittest.TestCase):
    def test_install_and_manifest_compare_use_explicit_utf8(self):
        # Force an error on implicit locale-dependent text I/O even on a
        # UTF-8 machine; production Windows locales need not default to UTF-8.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            control, _ = ui_parity_test.SharedUiBundleTests().fixture(root)
            body = root / 'ui/injections/laolao-body.fragment.html'
            body.write_bytes('<section id="laolao-splash">粉红玻璃</section>'.encode('utf-8'))
            (root / 'ui/assets/laolao-碧琪.png').write_bytes(b'fixture')
            manifest = root / 'manifest.json'
            original_read, original_write = Path.read_text, Path.write_text

            def strict_read(path, *args, **kwargs):
                self.assertEqual(kwargs.get('encoding'), 'utf-8', f'implicit encoding: {path}')
                return original_read(path, *args, **kwargs)

            def strict_write(path, data, *args, **kwargs):
                self.assertEqual(kwargs.get('encoding'), 'utf-8', f'implicit encoding: {path}')
                return original_write(path, data, *args, **kwargs)

            bundle = ui_parity_test.bundle
            install_argv = ['bundle.py', 'install', '--root', str(root), '--control-ui', str(control), '--output', str(manifest)]
            with mock.patch.object(Path, 'read_text', strict_read), \
                 mock.patch.object(Path, 'write_text', strict_write), \
                 mock.patch.object(sys, 'argv', install_argv), contextlib.redirect_stdout(io.StringIO()):
                bundle.main()
            self.assertIn('粉红玻璃', (control / 'index.html').read_bytes().decode('utf-8'))
            self.assertIn('laolao-碧琪.png', manifest.read_bytes().decode('utf-8'))
            with mock.patch.object(Path, 'read_text', strict_read), \
                 mock.patch.object(sys, 'argv', ['bundle.py', 'compare', str(manifest), str(manifest)]), \
                 contextlib.redirect_stdout(io.StringIO()):
                bundle.main()


if __name__ == '__main__':
    unittest.main()
