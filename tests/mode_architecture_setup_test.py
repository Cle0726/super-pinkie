import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

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
            plugin = installed['plugins']['entries']['pinkie-mode-architecture']
            self.assertTrue(plugin['hooks']['allowPromptInjection'])
            self.assertTrue(plugin['hooks']['allowConversationAccess'])
            for mode, relative in setup.MODE_WORKSPACES.items():
                ws = home / relative
                self.assertEqual((ws / 'SOUL.md').read_text(), 'USER CUSTOM CONTEXT\n')
                self.assertTrue((ws / 'memory/INDEX.md').is_file())
                self.assertTrue((ws / 'memory/context/active.md').is_file())
                self.assertTrue((ws / 'skills/deep-think/SKILL.md').is_file())
                self.assertEqual((ws / 'persona').exists(), mode != 'none')
            none_identity = (home / setup.MODE_WORKSPACES['none'] / 'IDENTITY.md').read_text()
            self.assertIn('OPENCLAW_UR_INJECT', none_identity)
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


if __name__ == '__main__':
    unittest.main()
