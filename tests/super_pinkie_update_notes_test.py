"""bd71077d19: a packaged update must print each release note before download.

The dialog already received notes. The Windows launcher's pull_and_update
did not, so the log never said what changed. This only exercises the
packaged path: resource_path is a temp directory with no .git, so the
function does not fetch or pull.
"""
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

SCRATCH = Path(tempfile.mkdtemp(prefix='pinkie-update-notes-'))
(SCRATCH / 'claude').mkdir()
(SCRATCH / 'codex').mkdir()
os.environ['CLAUDE_CONFIG_DIR'] = str(SCRATCH / 'claude')
os.environ['CODEX_HOME'] = str(SCRATCH / 'codex')
os.environ.pop('OPENAI_API_KEY', None)

from app import super_pinkie


class PackagedUpdateNotesTests(unittest.TestCase):
    def test_each_release_note_is_logged_before_the_download(self):
        root = Path(tempfile.mkdtemp(prefix='pinkie-packaged-root-'))
        self.assertFalse((root / '.git').exists())
        calls = []

        class FakeUpdater:
            def __init__(self, repo_root):
                self.repo_root = repo_root

            def check(self, force=False):
                calls.append('check')
                return {
                    'available': True,
                    'version': '9.9.9',
                    'notes': '图标换成清晰的新图。\n名字统一写成碧琪。',
                }

            def prepare(self):
                calls.append('prepare')
                return {'ready': False}

        desktop = types.ModuleType('windows_desktop')
        desktop.WindowsUpdater = FakeUpdater
        logs = []
        with mock.patch.object(super_pinkie, 'resource_path', return_value=root), \
             mock.patch.dict(sys.modules, {'windows_desktop': desktop}):
            self.assertFalse(super_pinkie.pull_and_update(logs.append))
        text = '\n'.join(logs)
        self.assertEqual(calls, ['check', 'prepare'])
        self.assertIn('发现新版本 9.9.9', text)
        self.assertIn('    · 图标换成清晰的新图。', text)
        self.assertIn('    · 名字统一写成碧琪。', text)
        self.assertIn('新版本下载未完成', text)
        self.assertLess(text.index('    · 图标换成清晰的新图。'), text.index('    · 名字统一写成碧琪。'))
        self.assertLess(text.index('    · 名字统一写成碧琪。'), text.index('新版本下载未完成'))


if __name__ == '__main__':
    unittest.main()
