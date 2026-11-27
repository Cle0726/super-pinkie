import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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
            'ui/injections/laolao-head.fragment.html': '<script src="/laolao-night.js?v=@hash"></script>\n<!-- pinkie-native-assets -->\n<link rel="stylesheet" href="/laolao-new-surface.css?v=@hash">\n<script defer src="/vendor/nested/effect.js?v=@hash"></script>',
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

    def test_native_opening_movie_and_poster_stay_out_of_both_control_ui_bundles(self):
        names = (
            'laolao-splash.mp4', 'laolao-splash-release.mp4',
            'laolao-splash-video-poster.png', 'laolao-splash-video-poster-release.png',
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, windows = self.fixture(root)
            policy = (ROOT / 'ui/parity-policy.json').read_bytes()
            (root / 'ui/parity-policy.json').write_bytes(policy)
            for name in names:
                (root / 'ui/assets' / name).write_bytes(b'native startup asset')
                (windows / name).write_bytes(b'left over from the runtime overlay')
            for control in (mac, windows):
                manifest = bundle.install(root, control)
                for name in names:
                    with self.subTest(control=control.name, asset=name):
                        self.assertNotIn(name, manifest['resources'])
                        self.assertFalse((control / name).exists())
                        self.assertTrue((root / 'ui/assets' / name).is_file())

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

    def stamped_fixture(self, root):
        # Shared template, a CSS url() stamp and a patched chat chunk, so every
        # stamped_sources rewrite and every inspect check has something to do.
        mac, windows = self.fixture(root)
        (root / 'ui/control-ui.index.html').write_bytes((mac / 'index.html').read_bytes())
        (root / 'ui/injections/laolao-stamped.css').write_text('a { background: url(/laolao-avatar.png?v=@hash) }')
        runtime = root / 'ui/runtime'
        runtime.mkdir(parents=True)
        (runtime / 'chat-page-abc.js').write_text('patchedRenderer()')
        (runtime / 'index-abc.js').write_text('import("./chat-page-abc.js")')
        return mac, windows

    def test_install_reuses_its_stamped_sources_and_gets_the_same_manifest_as_a_fresh_inspect(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, windows = self.stamped_fixture(root)
            calls = []
            original = bundle.stamped_sources
            def counting(*args, **kwargs):
                calls.append(1)
                return original(*args, **kwargs)
            bundle.stamped_sources = counting
            try:
                installed = bundle.install(root, mac)
            finally:
                bundle.stamped_sources = original
            # One install stamps and hashes the sources once (it used to be seven times).
            self.assertEqual(len(calls), 1)
            # The old path: inspect recomputing everything on its own.
            fresh = bundle.inspect(root, mac)
            self.assertEqual(sorted(installed['resources']), sorted(fresh['resources']))
            for name, entry in fresh['resources'].items():
                self.assertEqual(installed['resources'][name], entry, name)
            self.assertEqual(installed, fresh)
            for name in ('laolao-stamped.css', 'assets/chat-page-abc.js', 'assets/index-abc.js', 'index.html'):
                self.assertIn(name, fresh['resources'])
            # Passing the pair in gives exactly what recomputing it gives.
            files = bundle.source_files(root)
            stamped = bundle.stamped_sources(root, files)
            self.assertEqual(stamped, bundle.stamped_sources(root, bundle.source_files(root)))
            self.assertEqual(bundle.inspect(root, mac, files, stamped), fresh)
            template = (root / 'ui/control-ui.index.html').read_text()
            self.assertEqual(bundle.normalize_index(template, root, files, mac, stamped),
                             bundle.normalize_index(template, root, files, mac))
            self.assertEqual(bundle.entry_tags(root, files, stamped), bundle.entry_tags(root, files))
            # A second package installed the same way ends up identical.
            self.assertEqual(bundle.install(root, windows), installed)

    def test_cli_install_inspects_the_package_once_after_stamping(self):
        # B17: install() used to inspect (read every package file back) and then
        # main() inspected again after stamp.mjs; only the second sees the final
        # bytes. The CLI must inspect exactly once, after stamping, and still fail
        # on a package file left stale.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, windows = self.stamped_fixture(root)
            for control, corrupt in ((mac, False), (windows, True)):
                events = []
                real_inspect = bundle.inspect

                def counting_inspect(*args, **kwargs):
                    events.append('inspect')
                    return real_inspect(*args, **kwargs)

                def fake_stamp(_root, ctl):
                    events.append('stamp')
                    if corrupt:
                        (Path(ctl) / 'laolao-stamped.css').write_bytes(b'left stale by stamping')

                output = root / f'{control.name}-manifest.json'
                argv = ['bundle.py', 'install', '--root', str(root), '--control-ui', str(control), '--output', str(output)]
                with mock.patch.object(bundle, 'inspect', counting_inspect), \
                     mock.patch.object(bundle, 'run_stamp_tool', fake_stamp), \
                     mock.patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()):
                    if corrupt:
                        with self.assertRaisesRegex(ValueError, 'stale/modified UI resource'):
                            bundle.main()
                    else:
                        bundle.main()
                self.assertEqual(events, ['stamp', 'inspect'], control.name)
                if not corrupt:
                    fresh = bundle.inspect(root, mac)
                    self.assertEqual(json.loads(output.read_text(encoding='utf-8')), fresh)
                    self.assertEqual(json.loads((mac / bundle.MANIFEST).read_text(encoding='utf-8')), fresh)
            # Library callers still get a verified manifest by default.
            self.assertEqual(bundle.install(root, mac), bundle.inspect(root, mac))
            self.assertIsNone(bundle.install(root, mac, verify=False))

    def test_reused_source_hashes_still_catch_package_files_changed_after_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, _ = self.stamped_fixture(root)
            bundle.install(root, mac)
            files = bundle.source_files(root)
            stamped = bundle.stamped_sources(root, files)
            for name, data, error in (
                    ('laolao-stamped.css', b'a { background: url(/laolao-avatar.png?v=0000000000) }', 'stale/modified'),
                    ('laolao-asset-manifest.js', b'window.__pinkieAssetManifest = {};', 'stale/modified'),
                    ('assets/chat-page-abc.js', b'oldRenderer()', 'stale/modified'),
                    ('index.html', None, 'entry HTML differs')):
                file = mac / name
                before = file.read_bytes()
                file.write_bytes(data if data is not None else before.replace(b'boot();', b'staleBoot();'))
                with self.assertRaisesRegex(ValueError, error, msg=name):
                    bundle.inspect(root, mac, files, stamped)
                with self.assertRaisesRegex(ValueError, error, msg=name):
                    bundle.inspect(root, mac)
                file.write_bytes(before)
            bundle.inspect(root, mac, files, stamped)
            (mac / 'laolao-stamped.css').unlink()
            with self.assertRaisesRegex(ValueError, 'missing UI resource'):
                bundle.inspect(root, mac, files, stamped)

    def test_a_ui_edit_gets_a_new_content_key_even_if_the_human_version_was_not_bumped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, _ = self.fixture(root)
            bundle.install(root, mac)
            first = (mac / 'index.html').read_bytes()
            (root / 'ui/injections/laolao-new-surface.css').write_text('new full glass')
            bundle.install(root, mac)
            self.assertNotEqual(first, (mac / 'index.html').read_bytes())
            self.assertIn(('?v=' + bundle.sha10(b'new full glass')).encode(), (mac / 'index.html').read_bytes())

    def test_native_cache_revision_preserves_independent_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac, _ = self.fixture(root)
            files = bundle.source_files(root)
            expected_entry_hash = bundle.sha10(b'assets/index-abc.js')
            for prefix in ('./', '/'):
                for suffix in ('', '?v=old&pinkie-drafts=1'):
                    html = f'<html><head><script type="module" src="{prefix}assets/index-abc.js{suffix}"></script></head><body><openclaw-app></openclaw-app></body></html>'
                    result = bundle.normalize_index(html, root, files)
                    self.assertEqual(result.count(f'v={expected_entry_hash}'), 1)
                    self.assertEqual('pinkie-drafts=1' in result, bool(suffix))
                    self.assertEqual(bundle.normalize_index(result, root, files), result)
            entry = mac / 'assets/index-abc.js'
            entry.parent.mkdir(exist_ok=True)
            entry.write_text('import("./chat-page-abc.js?v=old")')
            bundle.refresh_native_imports(mac)
            self.assertEqual(entry.read_text(), f'import("./chat-page-abc.js?v={bundle.sha10(b"./chat-page-abc.js")}")')

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

    def test_complete_visuals_are_not_disabled_by_memory_or_software_renderer(self):
        source = (ROOT / 'ui/injections/laolao-companion.js').read_text()
        self.assertNotIn('data-pinkie-lite', source)
        self.assertIn('requestAnimationFrame(draw)', source)
        # 30 fps by default on every machine; only 进阶调节 changes it.
        self.assertIn('fps === 30 ? now - last < 33', source)
        self.assertIn('tuned("effects.ambientFps", 30)', source)
        rig = (ROOT / 'ui/injections/laolao-buddy-rig.js').read_text()
        self.assertNotIn('data-pinkie-lite', rig)
        profile = (ROOT / 'ui/injections/laolao-platform-surface.js').read_text()
        self.assertIn('removeAttribute("data-pinkie-lite"', profile)
        self.assertNotIn('setAttribute("data-pinkie-lite"', profile)
        self.assertNotIn('backdrop-filter: none !important', profile)
        launcher = "\n".join(
            p.read_text() for p in sorted((ROOT / 'desktop/macos/pinkie/Sources').glob('Launcher*.swift'))
        )
        self.assertNotIn("setAttribute('data-pinkie-lite'", launcher)


if __name__ == '__main__':
    unittest.main()
