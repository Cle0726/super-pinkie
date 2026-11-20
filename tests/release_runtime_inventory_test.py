import unittest

from tools.release.runtime_inventory import CORE_AGENTS, CORE_PLUGINS, activation_report


class ReleaseRuntimeInventoryTests(unittest.TestCase):
    def test_core_agents_and_loaded_plugins_are_required(self):
        plugins = [{'id': name, 'status': 'loaded', 'enabled': True,
                    'services': ['pinkie-model-sync'] if name == 'pinkie-mode-architecture' else []}
                   for name in CORE_PLUGINS]
        report = activation_report(CORE_AGENTS, plugins)
        self.assertTrue(report['ok'])
        self.assertTrue(report['model_sync_registered'])
        renderer = next(entry for entry in plugins if entry['id'] == 'pinkie-first-person-renderer')
        renderer.update(enabled=False, status='disabled')
        report = activation_report(CORE_AGENTS - {'roles'}, plugins)
        self.assertFalse(report['ok'])
        self.assertEqual(report['missing_agents'], ['roles'])
        self.assertEqual(report['unready_plugins'], ['pinkie-first-person-renderer'])
