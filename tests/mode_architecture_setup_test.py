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
            chat_core = (home / '.openclaw/workspace/persona/core.md').read_text(encoding='utf-8')
            self.assertIn('碧琪', chat_core)
            self.assertNotIn('公猫', chat_core)
            self.assertNotIn('雅叙', chat_core)
            collab_wrapper = (home / 'Library/Application Support/SuperPinkie/web-gpt-collab/pinkie-collab').read_text()
            self.assertIn('C2C_TUNNEL_PROTOCOL', collab_wrapper)
            self.assertIn('http2', collab_wrapper)
            manifest = json.loads((home / '.openclaw/extensions/pinkie-mode-architecture/openclaw.plugin.json').read_text())
            # The installed manifest is the shipped one; the core tools stay declared.
            shipped = json.loads((Path(setup.__file__).resolve().parent / 'openclaw.plugin.json').read_text())
            self.assertEqual(manifest['contracts']['tools'], shipped['contracts']['tools'])
            for tool in ('ask_user', 'clekk_memory', 'computer', 'delivery_guard', 'learning_activity', 'web_gpt_activity'):
                self.assertIn(tool, manifest['contracts']['tools'])
            for mode, relative in setup.MODE_WORKSPACES.items():
                ws = home / relative
                self.assertEqual((ws / 'SOUL.md').read_text(), 'USER CUSTOM CONTEXT\n')
                self.assertTrue((ws / 'memory/INDEX.md').is_file())
                self.assertTrue((ws / 'memory/context/active.md').is_file())
                self.assertTrue((ws / 'skills/deep-think/SKILL.md').is_file())
                self.assertTrue((ws / 'skills/web-gpt-collab/SKILL.md').is_file())
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

    def test_manual_size_limit_is_raised_and_never_lowered(self):
        data = {'agents': {'list': [{'id': 'project'}]}}
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        self.assertEqual(data['agents']['defaults']['bootstrapMaxChars'], 60_000)
        self.assertEqual(data['agents']['defaults']['bootstrapTotalMaxChars'], 200_000)
        data = {'agents': {'defaults': {'bootstrapMaxChars': 90_000, 'bootstrapTotalMaxChars': 1000}, 'list': []}}
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        self.assertEqual(data['agents']['defaults']['bootstrapMaxChars'], 90_000)
        self.assertEqual(data['agents']['defaults']['bootstrapTotalMaxChars'], 200_000)

    def test_unused_openclaw_tools_are_hidden_from_the_four_modes_only(self):
        data = {'agents': {'list': [
            {'id': 'main'}, {'id': 'project', 'tools': {'deny': ['browser'], 'exec': {'pathPrepend': ['/x']}}},
            {'id': 'thinking'}, {'id': 'learning'}, {'id': 'unrestricted'}, {'id': 'party-claude'}]}}
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        agents = {a['id']: a for a in data['agents']['list']}
        for mode in ('main', 'project', 'thinking', 'learning'):
            deny = agents[mode]['tools']['deny']
            for name in ('workboard_*', 'wiki_*', 'skill_workshop', 'canvas', 'llm-task', 'node_inference', 'web_search'):
                self.assertIn(name, deny)
            # A3: one search tool for the model; pinkie_search stays.
            # B1: zero calls in 60 sessions on both machines; gateway was used on Windows, so it stays.
            for name in ('nodes', 'agents_list', 'dir_fetch', 'dir_list', 'file_fetch', 'file_write'):
                self.assertIn(name, deny)
            for kept in ('cron', 'message', 'gateway', 'pinkie_search', 'web_fetch'):
                self.assertNotIn(kept, deny)
        self.assertEqual(agents['project']['tools']['deny'][0], 'browser')
        self.assertEqual(agents['project']['tools']['exec'], {'pathPrepend': ['/x']})
        self.assertNotIn('tools', agents['unrestricted'])
        self.assertNotIn('tools', agents['party-claude'])
        before = json.dumps(data, sort_keys=True)
        self.assertFalse(setup._configure_plugin(data, Path('/tmp/pinkie-mode-test')))
        self.assertEqual(json.dumps(data, sort_keys=True), before)

    def test_channel_tools_only_reach_modes_the_channel_lands_in(self):
        # B1: qq accounts idea*/proj* are routed to thinking/project; the top-level (default) account
        # is not, so its messages land in the default mode (first in the list: main). No feishu at all.
        def config():
            return {'channels': {'qqbot': {'appId': 'x', 'clientSecret': 'y', 'accounts': {'default': {}, 'idea1': {}, 'proj1': {}}}},
                    'bindings': [{'type': 'route', 'agentId': 'thinking', 'match': {'channel': 'qqbot', 'accountId': 'idea1'}},
                                 {'type': 'route', 'agentId': 'project', 'match': {'channel': 'qqbot', 'accountId': 'proj1'}}],
                    'agents': {'list': [{'id': 'main'}, {'id': 'project'}, {'id': 'thinking'}, {'id': 'learning'}, {'id': 'unrestricted'}]}}
        data = config()
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        deny = {a['id']: a.get('tools', {}).get('deny', []) for a in data['agents']['list']}
        self.assertEqual([m for m in ('main', 'project', 'thinking', 'learning') if 'qqbot_*' in deny[m]], ['learning'])
        for mode in ('main', 'project', 'thinking', 'learning'):
            self.assertIn('feishu_*', deny[mode])
        self.assertEqual(deny['unrestricted'], [])
        # Every account routed whole: the default mode no longer gets qq tools.
        data = config()
        data['channels']['qqbot'] = {'accounts': {'idea1': {}, 'proj1': {}}}
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        deny = {a['id']: a.get('tools', {}).get('deny', []) for a in data['agents']['list']}
        self.assertEqual([m for m in ('main', 'project', 'thinking', 'learning') if 'qqbot_*' not in deny[m]], ['project', 'thinking'])
        # Later the user routes qq into learning: the deny this code added is taken back, the user's own entries stay.
        data['bindings'].append({'agentId': 'learning', 'match': {'channel': 'qqbot', 'accountId': 'idea1'}})
        learning = next(a for a in data['agents']['list'] if a['id'] == 'learning')
        learning['tools']['deny'].append('browser')
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        self.assertNotIn('qqbot_*', learning['tools']['deny'])
        self.assertIn('browser', learning['tools']['deny'])
        # A binding narrowed to one peer still leaves the rest of that account to the default mode.
        data = config()
        data['channels']['qqbot'] = {'accounts': {'idea1': {}}}
        data['bindings'] = [{'agentId': 'thinking', 'match': {'channel': 'qqbot', 'accountId': 'idea1', 'peer': {'kind': 'group', 'id': 'g'}}}]
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        main = data['agents']['list'][0]
        self.assertNotIn('qqbot_*', main['tools']['deny'])
        # Feishu bound and disabled qq: feishu tools reach that mode, qq tools reach none.
        data = config()
        data['channels'] = {'qqbot': {'enabled': False, 'appId': 'x'}, 'feishu': {'accounts': {'work': {}}}}
        data['bindings'] = [{'agentId': 'project', 'match': {'channel': 'feishu', 'accountId': 'work'}}]
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        deny = {a['id']: a.get('tools', {}).get('deny', []) for a in data['agents']['list']}
        self.assertEqual([m for m in ('main', 'project', 'thinking', 'learning') if 'feishu_*' not in deny[m]], ['project'])
        self.assertTrue(all('qqbot_*' in deny[m] for m in ('main', 'project', 'thinking', 'learning')))

    def test_pdf_extraction_plugin_joins_an_allow_list_unless_denied(self):
        # A4 live (11-13): with plugins.allow = [three pinkie plugins], the bundled document-extract
        # plugin never loads and the pdf tool fails with "PDF extraction disabled or unavailable".
        data = {'plugins': {'allow': ['pinkie-project-scope', 'pinkie-mode-architecture']}}
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        self.assertIn('document-extract', data['plugins']['allow'])
        self.assertEqual(data['plugins']['allow'].count('document-extract'), 1)
        self.assertNotIn('document-extract', data['plugins']['entries'])  # no new entry, only the allow list
        before = json.dumps(data, sort_keys=True)
        self.assertFalse(setup._configure_plugin(data, Path('/tmp/pinkie-mode-test')))
        self.assertEqual(json.dumps(data, sort_keys=True), before)
        denied = {'plugins': {'allow': ['pinkie-mode-architecture'], 'deny': ['document-extract']}}
        setup._configure_plugin(denied, Path('/tmp/pinkie-mode-test'))
        self.assertNotIn('document-extract', denied['plugins']['allow'])

    def test_only_verified_gemini_model_gains_native_xhigh_without_changing_permissions(self):
        data = {
            'models': {'providers': {'mm': {'models': [
                {'id': 'gemini-3.8-flash-tiered', 'compat': {'supportedReasoningEfforts': ['minimal', 'low', 'medium', 'high']}},
                {'id': 'other-model', 'compat': {'supportedReasoningEfforts': ['low', 'high']}},
            ]}}},
            'agents': {'defaults': {}},
            'plugins': {'entries': {'pinkie-mode-architecture': {'enabled': True}}},
        }
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        models = data['models']['providers']['mm']['models']
        self.assertEqual(models[0]['compat']['supportedReasoningEfforts'], ['minimal', 'low', 'medium', 'high', 'xhigh'])
        self.assertEqual(models[1]['compat']['supportedReasoningEfforts'], ['low', 'high'])
        self.assertNotIn('max', models[0]['compat']['supportedReasoningEfforts'])
        self.assertNotIn('ultra', models[0]['compat']['supportedReasoningEfforts'])


if __name__ == '__main__':
    unittest.main()
