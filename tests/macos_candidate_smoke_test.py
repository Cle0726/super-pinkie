import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'tools/macos-package/smoke_launch.py'
spec = importlib.util.spec_from_file_location('macos_candidate_launch_smoke', SCRIPT)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class MacCandidateSmokeTests(unittest.TestCase):
    def test_follows_exact_descendants_without_claiming_reused_pids(self):
        owned = {50: 'launcher start'}
        self.assertEqual(smoke.owned_processes(owned, {
            50: (10, 'launcher start'), 70: (50, 'gateway start'),
            72: (70, 'helper start'), 80: (20, 'unrelated start'),
        }), {50, 70, 72})
        self.assertEqual(smoke.owned_processes(owned, {
            50: (15, 'reused launcher pid'), 70: (1, 'gateway start'),
            72: (70, 'helper start'), 90: (70, 'new descendant'),
            80: (20, 'unrelated start'), 100: (50, 'unrelated child'),
        }), {70, 72, 90})
