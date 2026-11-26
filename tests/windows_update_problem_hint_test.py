"""1274296fc8: the failure card hint must not repeat the memory sentence.

The body passed to Show-UpdateProblem already says 记忆和设置都在，不受影响。
The hint under that body used to say the same line again. The fix (then in
app/windows_desktop.py, now in the PowerShell template the desktop shell
ships) changed only the hint.
"""
import os
from pathlib import Path
import tempfile
import unittest

SCRATCH = Path(tempfile.mkdtemp(prefix='pinkie-update-hint-'))
(SCRATCH / 'claude').mkdir()
(SCRATCH / 'codex').mkdir()
os.environ['CLAUDE_CONFIG_DIR'] = str(SCRATCH / 'claude')
os.environ['CODEX_HOME'] = str(SCRATCH / 'codex')
os.environ.pop('OPENAI_API_KEY', None)

from app.windows_ps_templates import UPDATE_UI_PS
from app.windows_updater import WindowsUpdater

HINT = "需要帮忙的话，把上面的详细记录发给我们。"
MEMORY = "记忆和设置都在，不受影响。"
HINT_ASSIGN = f"FindName('Hint').Text = '{HINT}'"
OLD_HINT_ASSIGN = f"FindName('Hint').Text = '{MEMORY}'"


class UpdateProblemHintTests(unittest.TestCase):
    def test_shipped_helper_hint_does_not_repeat_the_memory_line(self):
        self.assertIn(HINT_ASSIGN, UPDATE_UI_PS)
        self.assertNotIn(OLD_HINT_ASSIGN, UPDATE_UI_PS)
        updater = Path(__file__).resolve().parents[1].joinpath('app/windows_updater.py').read_text(encoding='utf-8')
        # The sentence still appears once, in the body. The hint is a different line.
        self.assertGreaterEqual(updater.count(MEMORY), 1)
        for script in (WindowsUpdater._helper_source(), WindowsUpdater._directory_helper_source()):
            self.assertEqual(script.count(HINT_ASSIGN), 1)
            self.assertEqual(script.count(OLD_HINT_ASSIGN), 0)
            self.assertGreaterEqual(script.count(MEMORY), 1)


if __name__ == '__main__':
    unittest.main()
