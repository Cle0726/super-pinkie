import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scope_setup', ROOT / 'services/project-scope/setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ScopeSetupTests(unittest.TestCase):
    def test_install_preserves_agents_personas_and_other_plugins_and_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix='pinkie-scope-setup-') as temp:
            home = Path(temp)
            config = home / '.openclaw/openclaw.json'
            config.parent.mkdir()
            original = {'agents': {'list': [{'id': 'main', 'model': 'keep-me'}]}, 'plugins': {'allow': ['existing'], 'entries': {'existing': {'enabled': True, 'config': {'keep': 1}}}}}
            config.write_text(json.dumps(original))
            persona = config.parent / 'workspace/SOUL.md'
            persona.parent.mkdir()
            persona.write_bytes(b'KEEP ORIGINAL PERSONA\n')
            self.assertTrue(setup.install(home))
            installed = json.loads(config.read_text())
            self.assertEqual(original['agents'], installed['agents'])
            self.assertEqual(original['plugins']['entries']['existing'], installed['plugins']['entries']['existing'])
            self.assertEqual(b'KEEP ORIGINAL PERSONA\n', persona.read_bytes())
            self.assertIn('pinkie-project-scope', installed['plugins']['allow'])
            self.assertTrue((config.parent / 'extensions/pinkie-project-scope/index.mjs').is_file())
            self.assertFalse(setup.install(home))

    def test_disabled_plugins_are_not_silently_bypassed(self):
        with tempfile.TemporaryDirectory(prefix='pinkie-scope-setup-') as temp:
            home = Path(temp)
            config = home / '.openclaw/openclaw.json'
            config.parent.mkdir()
            config.write_text('{"plugins":{"enabled":false}}')
            before = config.read_bytes()
            with self.assertRaises(RuntimeError):
                setup.install(home)
            self.assertEqual(before, config.read_bytes())
