"""Recurrence locks for services/mode-architecture/setup.py fixes that the
tests shipped with those commits do not actually catch.

install() is pointed at a temporary home. No upstream probe: OPENAI_API_KEY
is removed so _choose_memory_search does not call the embeddings endpoint.
"""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

SCRATCH = Path(tempfile.mkdtemp(prefix='pinkie-setup-hotspot-'))
(SCRATCH / 'claude').mkdir()
(SCRATCH / 'codex').mkdir()
os.environ['CLAUDE_CONFIG_DIR'] = str(SCRATCH / 'claude')
os.environ['CODEX_HOME'] = str(SCRATCH / 'codex')
os.environ.pop('OPENAI_API_KEY', None)
os.environ.pop('PINKIE_STATE_ROOT', None)
os.environ.pop('PINKIE_MANAGED_GATEWAY', None)

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'mode_setup_hotspot', ROOT / 'services/mode-architecture/setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ModeArchitectureSetupHotspotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='pinkie-setup-hotspot-home-')
        cls.home = Path(cls.tmp.name)
        config = cls.home / '.openclaw/openclaw.json'
        config.parent.mkdir(parents=True)
        config.write_text('{}\n', encoding='utf-8')
        cls.changed = setup.install(cls.home)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_fresh_install_copies_the_deep_research_skill(self):
        # a2514d6e95 added the pinkie-deep-research copy. The older install
        # test only checks deep-think and web-gpt-collab, so deleting this
        # block still leaves that test green.
        source = (ROOT / 'skills/pinkie-deep-research/SKILL.md').read_text(encoding='utf-8')
        self.assertIn('pinkie-deep-research', source)
        for relative in setup.MODE_WORKSPACES.values():
            installed = self.home / relative / 'skills/pinkie-deep-research/SKILL.md'
            self.assertTrue(installed.is_file(), relative)
            self.assertEqual(installed.read_text(encoding='utf-8'), source)

    def test_role_payload_workspace_is_tidied_on_the_same_install(self):
        # 9b5453b3d5 moved _tidy_metre_workspace to after
        # _install_metre_role_assets. Role sync creates workspace-metre on
        # this pass. Tidying first leaves the new directory without the empty
        # placeholders, and OpenClaw then fills the English templates.
        workspace = self.home / '.openclaw/workspace-metre'
        self.assertTrue(workspace.is_dir())
        self.assertTrue(any(workspace.joinpath('roles').glob('*.md')))
        for name in ('TOOLS.md', 'USER.md', 'HEARTBEAT.md'):
            file = workspace / name
            self.assertTrue(file.is_file(), name)
            self.assertEqual(file.read_text(encoding='utf-8'), '', name)

    def test_fresh_install_copies_plugin_files_those_fixes_added(self):
        # e47f751ccc / a66da7865a / 3cc035bdae / a2514d6e95 extended the copy
        # list. A fresh profile must receive the files, not only the ones the
        # older scaffold test happens to open.
        extension = self.home / '.openclaw/extensions/pinkie-mode-architecture'
        for name in ('reply-hygiene.mjs', 'session-manage.mjs', 'nb_runner.py', 'nb_bootstrap.py'):
            self.assertTrue((extension / name).is_file(), name)
            self.assertEqual(
                (extension / name).read_bytes(),
                (ROOT / 'services/mode-architecture' / name).read_bytes(),
                name,
            )


if __name__ == '__main__':
    unittest.main()
