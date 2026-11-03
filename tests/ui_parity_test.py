import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('shared_ui_bundle', ROOT / 'tools/ui-parity/bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class SharedUiBundleTests(unittest.TestCase):
    def fixture(self, root):
        sources = {
            'ui/parity-policy.json': json.dumps({'native_only_assets': {}, 'platform_differences': []}),
            'ui/assets/laolao-avatar.png': 'avatar',
            'ui/assets/ProviderIcon-crossmodel.svg': '<svg/>',
            'ui/assets/deep-think/tier.webm': 'complete video bytes',
            'ui/assets/fonts/type.woff2': 'complete font bytes',
            'ui/injections/laolao-night.js': 'night()',
            'ui/injections/laolao-new-surface.css': 'body { color: pink }',
            'ui/injections/vendor/nested/effect.js': 'fullAnimation()',
            'ui/injections/laolao-handoff-bootstrap.js': 'handoff()',
            'ui/injections/laolao-head.fragment.html': '<script src="/laolao-night.js?v=one"></script>\n<!-- pinkie-native-assets -->\n<link rel="stylesheet" href="/laolao-new-surface.css?v=one">\n<script defer src="/vendor/nested/effect.js?v=one"></script>',
            'ui/injections/laolao-body.fragment.html': '<section id="laolao-splash"></section>',
        }
        for name, content in sources.items():
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content.encode())
        for platform in ('mac', 'windows'):
            control = root / platform
            control.mkdir()
            # Model an old runtime overlay and duplicate obsolete injections.
            (control / 'index.html').write_bytes(b'<html><head>\n<script>\n  boot();\n\n\n</script>\n<script src="./laolao-night.js?v=old"></script><script type="module" src="./assets/index-abc.js?pinkie-surface=6"></script><link href="./laolao-retired-stage.css?v=1" rel="stylesheet"></head><body><openclaw-app></openclaw-app></body></html>')
            (control / 'assets').mkdir()
            (control / 'assets/index-abc.js').write_text('upstreamEntry()')
            (control / 'laolao-retired-stage.css').write_bytes(b'obsolete injection')
            (control / 'CLeAppIcon.icns').write_bytes(b'cat app icon')
        return root / 'mac', root / 'windows'

    def test_both_overlaid_packages_have_the_same_complete_nested_resources_and_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, windows = self.fixture(root)
            left, right = bundle.install(root, mac), bundle.install(root, windows)
            self.assertEqual(left, right)
            self.assertIn('deep-think/tier.webm', left['resources'])
            self.assertIn('fonts/type.woff2', left['resources'])
            self.assertIn('vendor/nested/effect.js', left['resources'])
            self.assertFalse((windows / 'laolao-retired-stage.css').exists())
            self.assertFalse((windows / 'CLeAppIcon.icns').exists())
            self.assertNotIn('laolao-retired-stage', (windows / 'index.html').read_text())
            # Actual read-back detects both missing media and post-overlay edits.
            (windows / 'deep-think/tier.webm').unlink()
            with self.assertRaisesRegex(ValueError, 'missing UI resource'):
                bundle.inspect(root, windows)
            bundle.install(root, windows)
            (windows / 'laolao-new-surface.css').write_text('old css')
            with self.assertRaisesRegex(ValueError, 'stale/modified'):
                bundle.inspect(root, windows)

    def test_install_is_idempotent_and_does_not_change_csp_inline_script_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, _ = self.fixture(root)
            inline = bundle.inline_scripts((mac / 'index.html').read_text())
            bundle.install(root, mac)
            first = (mac / 'index.html').read_bytes()
            bundle.install(root, mac)
            self.assertEqual(first, (mac / 'index.html').read_bytes())
            self.assertEqual(inline, bundle.inline_scripts(first.decode()))
            self.assertEqual(first.count(b'laolao-handoff-bootstrap.js'), 1)
            self.assertIn(b'pinkie-surface=6', first)

    def test_native_chat_is_shared_and_other_upstream_chunks_are_compared_too(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, windows = self.fixture(root)
            renderer = root / 'ui/runtime/chat-page-abc.js'
            renderer.parent.mkdir(parents=True)
            renderer.write_text('completeMacRenderer()')
            for control in (mac, windows):
                (control / 'assets/upstream.css').write_text('same upstream skin')
                bundle.install(root, control)
                self.assertEqual((control / 'assets/chat-page-abc.js').read_bytes(), renderer.read_bytes())
            self.assertEqual(bundle.inspect(root, mac), bundle.inspect(root, windows))
            (windows / 'assets/upstream.css').write_text('old upstream skin')
            self.assertNotEqual(bundle.inspect(root, mac), bundle.inspect(root, windows))
            (windows / 'assets/chat-page-abc.js').write_text('oldRenderer()')
            with self.assertRaisesRegex(ValueError, 'stale/modified'):
                bundle.inspect(root, windows)

    def test_the_complete_entrypoint_cannot_drift_between_runtime_overlays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, windows = self.fixture(root)
            template = root / 'ui/control-ui.index.html'
            template.write_bytes((mac / 'index.html').read_bytes().replace(b'boot();', b'sharedBoot();'))
            (windows / 'index.html').write_text((windows / 'index.html').read_text().replace('boot();', 'oldWindowsBoot();'))
            left, right = bundle.install(root, mac), bundle.install(root, windows)
            self.assertEqual(left, right)
            self.assertIn('index.html', left['resources'])
            self.assertEqual((mac / 'index.html').read_bytes(), (windows / 'index.html').read_bytes())
            (windows / 'index.html').write_text((windows / 'index.html').read_text().replace('sharedBoot();', 'staleBoot();'))
            with self.assertRaisesRegex(ValueError, 'entry HTML differs'):
                bundle.inspect(root, windows)

    def test_a_ui_edit_gets_a_new_content_key_even_if_the_human_version_was_not_bumped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, _ = self.fixture(root)
            bundle.install(root, mac)
            first = (mac / 'index.html').read_bytes()
            (root / 'ui/injections/laolao-new-surface.css').write_text('new full glass')
            bundle.install(root, mac)
            self.assertNotEqual(first, (mac / 'index.html').read_bytes())
            self.assertIn(b'?v=one&h=', (mac / 'index.html').read_bytes())

    def test_native_cache_revision_preserves_independent_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, _ = self.fixture(root)
            files = bundle.source_files(root)
            for prefix in ('./', '/'):
                for suffix in ('', '?v=old&pinkie-drafts=1'):
                    html = f'<html><head><script type="module" src="{prefix}assets/index-abc.js{suffix}"></script></head><body><openclaw-app></openclaw-app></body></html>'
                    result = bundle.normalize_index(html, root, files)
                    self.assertEqual(result.count('v=clekk-history59'), 1)
                    self.assertEqual('pinkie-drafts=1' in result, bool(suffix))
                    self.assertEqual(bundle.normalize_index(result, root, files), result)
            entry = mac / 'assets/index-abc.js'
            entry.parent.mkdir(exist_ok=True)
            entry.write_text('import("./chat-page-abc.js?v=old")')
            bundle.refresh_native_imports(mac)
            self.assertEqual(entry.read_text(), 'import("./chat-page-abc.js?v=clekk-history59")')

    def test_checkout_case_collisions_and_unresolved_lfs_media_fail_before_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            # Use separate source directories so the fixture works on a
            # case-insensitive Mac filesystem as well as on Linux.
            (root / 'ui/injections/LAOLAO-avatar.png').write_text('different case')
            with self.assertRaisesRegex(ValueError, 'case-insensitive'):
                bundle.source_files(root)
            (root / 'ui/injections/LAOLAO-avatar.png').unlink()
            (root / 'ui/assets/deep-think/tier.webm').write_text('version https://git-lfs.github.com/spec/v1\n')
            with self.assertRaisesRegex(ValueError, 'LFS pointer'):
                bundle.source_files(root)

    def test_software_detection_never_disables_the_complete_mac_effects(self):
        source = (ROOT / 'ui/injections/laolao-companion.js').read_text()
        self.assertNotIn('data-pinkie-lite', source)
        self.assertNotIn('softwareRendering', source)
        self.assertIn('requestAnimationFrame(draw)', source)
        self.assertIn('if (now - last < 33)', source)
        profile = (ROOT / 'ui/injections/laolao-platform-surface.js').read_text()
        self.assertNotIn('ambientFps', profile)
        self.assertNotIn('setAttribute("data-pinkie-lite"', profile)


if __name__ == '__main__':
    unittest.main()
