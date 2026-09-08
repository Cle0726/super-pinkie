import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mode_setup', ROOT / 'services/mode-architecture/setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ModeArchitectureSetupTests(unittest.TestCase):
    def test_scaffolds_four_isolated_modes_without_overwriting_context_or_agent_ids(self):
        with tempfile.TemporaryDirectory(prefix='pinkie-mode-setup-') as temp:
            home = Path(temp)
            config = home / '.openclaw/openclaw.json'
            config.parent.mkdir()
            original_agents = {'defaults': {'compaction': {'keepRecentTokens': 800000}}, 'list': [
                {'id': 'main'}, {'id': 'project'}, {'id': 'thinking'}, {'id': 'unrestricted'}]}
            config.write_text(json.dumps({'agents': original_agents, 'plugins': {'allow': []}}))
            for relative in setup.MODE_WORKSPACES.values():
                ws = home / relative
                ws.mkdir(parents=True)
                (ws / 'SOUL.md').write_text('USER CUSTOM CONTEXT\n')
                (ws / 'IDENTITY.md').write_text('CUSTOM IDENTITY\n')
            self.assertTrue(setup.install(home))
            installed = json.loads(config.read_text())
            self.assertEqual([x['id'] for x in installed['agents']['list']], ['main','project','thinking','unrestricted'])
            self.assertEqual(installed['agents']['defaults']['compaction']['keepRecentTokens'], 800000)
            self.assertEqual(installed['agents']['defaults']['subagents']['maxSpawnDepth'], 2)
            self.assertEqual(installed['agents']['defaults']['timeoutSeconds'], 43200)
            self.assertEqual(installed['agents']['defaults']['subagents']['runTimeoutSeconds'], 43200)
            self.assertEqual(installed['agents']['list'][3]['contextInjection'], 'never')
            self.assertFalse(installed['update']['checkOnStart'])
            plugin = installed['plugins']['entries']['pinkie-mode-architecture']
            self.assertTrue(plugin['hooks']['allowPromptInjection'])
            self.assertTrue(plugin['hooks']['allowConversationAccess'])
            manifest = json.loads((home / '.openclaw/extensions/pinkie-mode-architecture/openclaw.plugin.json').read_text())
            self.assertEqual(sorted(manifest['contracts']['tools']), ['clekk_memory', 'delivery_guard'])
            for mode, relative in setup.MODE_WORKSPACES.items():
                ws = home / relative
                self.assertEqual((ws / 'SOUL.md').read_text(), 'USER CUSTOM CONTEXT\n')
                self.assertTrue((ws / 'memory/INDEX.md').is_file())
                self.assertTrue((ws / 'memory/context/active.md').is_file())
                self.assertTrue((ws / 'skills/deep-think/SKILL.md').is_file())
                self.assertEqual((ws / 'persona').exists(), mode != 'none')
            none_identity = (home / setup.MODE_WORKSPACES['none'] / 'IDENTITY.md').read_text()
            self.assertEqual(none_identity, 'CUSTOM IDENTITY\n')
            self.assertFalse(setup.install(home))

    def test_existing_none_marker_and_custom_limits_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix='pinkie-mode-marker-') as temp:
            home=Path(temp);config=home/'.openclaw/openclaw.json';config.parent.mkdir()
            config.write_text(json.dumps({'agents':{'defaults':{'subagents':{'maxSpawnDepth':4,'maxConcurrent':12}}}}))
            none=home/setup.MODE_WORKSPACES['none'];none.mkdir(parents=True)
            (none/'IDENTITY.md').write_text('OPENCLAW_UR_INJECT CUSTOM\n')
            setup.install(home);data=json.loads(config.read_text())
            self.assertEqual(data['agents']['defaults']['subagents']['maxSpawnDepth'],4)
            self.assertEqual(data['agents']['defaults']['subagents']['maxConcurrent'],12)
            self.assertEqual((none/'IDENTITY.md').read_text(),'OPENCLAW_UR_INJECT CUSTOM\n')

    def test_older_app_bundle_cannot_downgrade_a_newer_live_runtime(self):
        with tempfile.TemporaryDirectory(prefix='pinkie-mode-no-downgrade-') as temp:
            home=Path(temp);config=home/'.openclaw/openclaw.json';config.parent.mkdir()
            config.write_text('{}\n')
            extension=home/'.openclaw/extensions/pinkie-mode-architecture';extension.mkdir(parents=True)
            (extension/'package.json').write_text(json.dumps({'version':'99.0.0'}))
            (extension/'index.mjs').write_text('NEWER LIVE RUNTIME\n')
            (extension/'openclaw.plugin.json').write_text('{}\n')
            setup.install(home)
            self.assertEqual((extension/'index.mjs').read_text(),'NEWER LIVE RUNTIME\n')
            self.assertEqual(json.loads((extension/'package.json').read_text())['version'],'99.0.0')

    def test_pinned_2026_7_repairs_only_newer_schema_fields(self):
        with tempfile.TemporaryDirectory(prefix='pinkie-mode-compat-') as temp:
            home=Path(temp);config=home/'.openclaw/openclaw.json';config.parent.mkdir()
            original={
                'models': {'catalogRefresh': {'enabled': False}, 'providers': {'mm': {'baseUrl': 'local'}}},
                'agents': {'defaults': {
                    'systemAgent': {'agentId': 'main'},
                    'heartbeat': {'agentId': 'main', 'every': '30m'},
                    'thinkingDefault': 'high',
                }},
                'talk': {'agentId': 'main', 'silenceTimeoutMs': 800},
            }
            config.write_text(json.dumps(original))
            with patch.dict(os.environ, {'PINKIE_RUNTIME_CONFIG_SCHEMA': '2026.7'}):
                self.assertTrue(setup.install(home))
            installed=json.loads(config.read_text())
            self.assertNotIn('catalogRefresh',installed['models'])
            self.assertEqual(installed['models']['providers'],original['models']['providers'])
            self.assertNotIn('systemAgent',installed['agents']['defaults'])
            self.assertEqual(installed['agents']['defaults']['heartbeat'],{'every':'30m'})
            self.assertEqual(installed['agents']['defaults']['thinkingDefault'],'high')
            self.assertNotIn('agentId',installed['talk'])
            self.assertEqual(installed['talk']['silenceTimeoutMs'],800)

    def test_newer_runtime_keeps_newer_schema_fields(self):
        data={'models':{'catalogRefresh':{'enabled':False}},'agents':{'defaults':{
            'systemAgent':{'agentId':'main'},'heartbeat':{'agentId':'main'}}},'talk':{'agentId':'main'}}
        with patch.dict(os.environ, {}, clear=True):
            setup._configure_plugin(data,Path('/tmp/pinkie-mode-test'))
        self.assertIn('catalogRefresh',data['models'])
        self.assertIn('systemAgent',data['agents']['defaults'])
        self.assertEqual(data['agents']['defaults']['heartbeat']['agentId'],'main')
        self.assertEqual(data['talk']['agentId'],'main')


if __name__ == '__main__':
    unittest.main()
