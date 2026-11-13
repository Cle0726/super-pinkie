import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import super_pinkie

SERVICES = ['party', 'context', 'project-scope', 'mode-architecture', 'first-person-renderer']


class PrepareSkipTests(unittest.TestCase):
    """Windows reran every setup step in front of the gateway on each start."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.home = self.root / 'home'
        self.config = self.home / '.openclaw' / 'openclaw.json'
        self.config.parent.mkdir(parents=True)
        self.config.write_text('{}\n', encoding='utf-8')
        self.extension = self.home / '.openclaw' / 'extensions' / 'pinkie-mode-architecture'
        self.extension.mkdir(parents=True)
        (self.extension / 'index.mjs').write_text('export default {}\n', encoding='utf-8')
        self.state = self.root / 'state'
        self.state.mkdir()
        (self.state / 'bundled-setup-2.5.41').write_text('preserved\n', encoding='utf-8')
        self.resources = self.root / 'resources'
        self.resources.mkdir()
        (self.resources / 'VERSION').write_text('2.5.41\n', encoding='utf-8')
        self.system_proxy = {'server': '127.0.0.1:8080', 'bypass': ''}
        self.messages = []

    def prepare(self, failing_message=None, agents=None):
        def install(name, log):
            if failing_message and name == 'mode-architecture':
                log(failing_message)
            return False

        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, {
                'UR_PROMPTS_DIR': str(self.config.parent), 'PINKIE_PRESERVE_EXISTING_PROFILE': '0'}))
            stack.enter_context(mock.patch.object(super_pinkie.Path, 'home', return_value=self.home))
            stack.enter_context(mock.patch.object(super_pinkie, 'windows_state_root', return_value=self.state))
            stack.enter_context(mock.patch.object(
                super_pinkie, 'resource_path', side_effect=lambda *parts: self.resources.joinpath(*parts)))
            self.agents = stack.enter_context(mock.patch.object(super_pinkie, 'ensure_mode_agents', side_effect=agents))
            stack.enter_context(mock.patch.object(super_pinkie, 'repair_provider_models'))
            stack.enter_context(mock.patch.object(super_pinkie, 'ensure_gateway_auth_none'))
            stack.enter_context(mock.patch.object(super_pinkie, 'ensure_workspace_avatars'))
            stack.enter_context(mock.patch.object(super_pinkie, 'apply_browser_proxy'))
            stack.enter_context(mock.patch.dict(sys.modules, {
                'browser_proxy': SimpleNamespace(system_proxy=lambda: self.system_proxy)}))
            installed = stack.enter_context(mock.patch.object(super_pinkie, 'install_runtime_service', side_effect=install))
            super_pinkie.prepare_bundled_desktop(self.messages.append)
        return [call.args[0] for call in installed.call_args_list]

    def test_modes_are_registered_again_after_a_half_installed_plugin_is_repaired(self):
        # Upgrading over a broken earlier install: the CLI cannot load the half-copied
        # plugin until install_runtime_service puts it back. The first failure must not
        # reach setup.log (the smoke test reads every warning there) when the retry works.
        calls = []

        def agents(log):
            calls.append(len(calls))
            if len(calls) == 1:
                log('  ⚠️ 补齐 project 模式失败（返回码 1）：Could not start the CLI.')
                return False
            log('  已补齐 project 模式')
            return True

        (self.state / 'bundled-prepare.json').write_text('{}', encoding='utf-8')
        self.assertEqual(self.prepare(agents=agents), SERVICES)
        self.assertEqual(len(calls), 2)
        self.assertIn('  已补齐 project 模式', self.messages)
        self.assertFalse([m for m in self.messages if '失败' in m])

    def test_a_new_version_registers_once_with_the_retry_and_no_early_warning(self):
        # A new version also reinstalls the personas; that step must not register the
        # modes on its own (it logged the CLI failure straight into setup.log).
        (self.state / 'bundled-setup-2.5.41').unlink()
        calls = []

        def agents(log):
            calls.append(1)
            if len(calls) == 1:
                log('  ⚠️ 补齐 project 模式失败（返回码 1）：Could not start the CLI.')
                return False
            return True

        with mock.patch.object(super_pinkie, 'ensure_prompts'):
            self.assertEqual(self.prepare(agents=agents), SERVICES)
        self.assertEqual(len(calls), 2)
        self.assertFalse([m for m in self.messages if '失败' in m])

    def test_a_retry_that_still_fails_logs_both_attempts(self):
        def agents(log):
            log('  ⚠️ 补齐 project 模式失败（返回码 1）：Could not start the CLI.')
            return False

        self.assertEqual(self.prepare(agents=agents), SERVICES)
        self.assertEqual(self.agents.call_count, 2)
        self.assertEqual(len([m for m in self.messages if '失败' in m]), 2)

    def test_second_start_with_unchanged_inputs_skips_the_whole_setup(self):
        self.assertEqual(self.prepare(), SERVICES)
        self.assertEqual(self.prepare(), [])
        self.assertIn('启动准备：输入没有变化，跳过重复部署', self.messages)

    def test_any_changed_input_runs_setup_again(self):
        changes = (
            lambda: self.config.write_text('{"browser": {}}\n', encoding='utf-8'),
            lambda: (self.extension / 'index.mjs').write_text('export default {changed: true}\n', encoding='utf-8'),
            lambda: setattr(self, 'system_proxy', None),
            lambda: (self.state / 'browser-proxy.json').write_text('{"mode": "off"}\n', encoding='utf-8'),
            lambda: (self.resources / 'VERSION').write_text('2.5.42\n', encoding='utf-8')
            or (self.state / 'bundled-setup-2.5.42').write_text('preserved\n', encoding='utf-8'),
        )
        self.assertEqual(self.prepare(), SERVICES)
        for change in changes:
            with self.subTest(change=change):
                change()
                self.assertEqual(self.prepare(), SERVICES)
                self.assertEqual(self.prepare(), [])

    def test_a_failed_step_is_retried_on_the_next_start(self):
        self.assertEqual(self.prepare(failing_message='  [mode-architecture] 安装失败：boom'), SERVICES)
        self.assertFalse((self.state / 'bundled-prepare.json').exists())
        self.assertEqual(self.prepare(), SERVICES)
        self.assertEqual(self.prepare(), [])


if __name__ == '__main__':
    unittest.main()


class StartupOrderTests(unittest.TestCase):
    def test_local_services_no_longer_sit_in_front_of_the_gateway(self):
        import inspect

        from app import windows_desktop

        source = inspect.getsource(windows_desktop.run_desktop)
        bootstrap = source[source.index('    def bootstrap():'):source.index('    def sync_window_state')]
        services = bootstrap.index('target=start_services')
        self.assertLess(services, bootstrap.index('prepare('))
        self.assertLess(bootstrap.index('prepare('), bootstrap.index('gateway.start()'))
        self.assertNotIn('services.start()', bootstrap)

    def test_startup_timing_lines_report_total_and_phase(self):
        from app import windows_desktop

        with mock.patch.object(windows_desktop, 'PROCESS_STARTED', 10.0), \
             mock.patch.object(windows_desktop, 'append_log') as log:
            message = windows_desktop.startup_timing('setup', 12.5, now=13.25)
        self.assertEqual(message, 'startup timing: setup at +3.25s took=0.75s')
        log.assert_called_once_with('launcher', message)
