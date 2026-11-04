import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import super_pinkie, windows_desktop


class WindowsStartupTests(unittest.TestCase):
    def test_preserve_existing_profile_never_runs_setup_or_changes_the_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'openclaw.json'
            original = b'{"sentinel": "keep exactly"}\n'
            config.write_bytes(original)
            messages = []
            with mock.patch.dict(os.environ, {
                    'UR_PROMPTS_DIR': str(root), 'PINKIE_PRESERVE_EXISTING_PROFILE': '1'}), \
                 mock.patch.object(super_pinkie, 'windows_state_root') as state, \
                 mock.patch.object(super_pinkie, 'install_runtime_service') as install, \
                 mock.patch.object(super_pinkie, 'ensure_mode_agents') as agents, \
                 mock.patch.object(super_pinkie, 'repair_provider_models') as repair:
                super_pinkie.prepare_bundled_desktop(messages.append)
            state.assert_not_called()
            install.assert_not_called()
            agents.assert_not_called()
            repair.assert_not_called()
            self.assertEqual(config.read_bytes(), original)
            self.assertEqual(sorted(path.name for path in root.iterdir()), ['openclaw.json'])
            self.assertIn('跳过自动部署', messages[0])

    def test_preserve_existing_profile_rejects_missing_or_invalid_config_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with mock.patch.dict(os.environ, {
                    'UR_PROMPTS_DIR': str(root), 'PINKIE_PRESERVE_EXISTING_PROFILE': '1'}), \
                 mock.patch.object(super_pinkie, 'windows_state_root') as state:
                with self.assertRaisesRegex(RuntimeError, '需要已经存在的配置文件'):
                    super_pinkie.prepare_bundled_desktop(lambda _: None)
                self.assertEqual(list(root.iterdir()), [])
                config = root / 'openclaw.json'
                for invalid in (b'not json', b'[]'):
                    config.write_bytes(invalid)
                    with self.assertRaises(RuntimeError):
                        super_pinkie.prepare_bundled_desktop(lambda _: None)
                    self.assertEqual(config.read_bytes(), invalid)
                state.assert_not_called()

    def test_preserve_profile_argument_sets_the_desktop_process_environment(self):
        seen = []
        desktop = SimpleNamespace(
            run_desktop=lambda *_: seen.append(os.environ.get('PINKIE_PRESERVE_EXISTING_PROFILE')),
            update_health_token_from_argv=lambda: None,
        )
        with mock.patch.dict(os.environ, {'PINKIE_PRESERVE_EXISTING_PROFILE': '0'}), \
             mock.patch.dict(sys.modules, {'windows_desktop': desktop}), \
             mock.patch.object(super_pinkie.sys, 'argv', ['pinkie.exe', '--preserve-existing-profile']), \
             mock.patch.object(super_pinkie.sys, 'frozen', True, create=True), \
             mock.patch.object(super_pinkie.os, 'name', 'nt'), \
             mock.patch.object(super_pinkie, 'utf8_console'), \
             mock.patch.object(super_pinkie, 'relay_ports_from_argv', return_value=None), \
             mock.patch.object(super_pinkie, 'bundled_runtime_root', return_value=True), \
             mock.patch.object(super_pinkie, 'resource_path', return_value='root'):
            super_pinkie.main()
            self.assertEqual(os.environ['PINKIE_PRESERVE_EXISTING_PROFILE'], '1')
        self.assertEqual(seen, ['1'])

    @unittest.skipUnless(os.name == 'nt', 'Windows updater uses PowerShell Start-Process')
    def test_update_helper_start_process_inherits_the_profile_opt_in(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / 'child.py'
            result = root / 'result.txt'
            child.write_text(
                'import os\nfrom pathlib import Path\n'
                "Path(os.environ['TEST_RESULT']).write_text("
                "os.environ.get('PINKIE_PRESERVE_EXISTING_PROFILE', ''), encoding='ascii')\n",
                encoding='utf-8',
            )
            env = os.environ.copy()
            env.update(PINKIE_PRESERVE_EXISTING_PROFILE='1', TEST_RESULT=str(result),
                       TEST_CHILD=str(child), TEST_PYTHON=sys.executable)
            script = ('$p = Start-Process -FilePath $env:TEST_PYTHON '
                      '-ArgumentList (\'"\' + $env:TEST_CHILD + \'"\') '
                      '-WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode')
            subprocess.run(['powershell.exe', '-NoProfile', '-Command', script], env=env,
                           check=True, timeout=30, capture_output=True)
            self.assertEqual(result.read_text(encoding='ascii'), '1')

    def test_default_startup_still_runs_normal_setup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'profile' / 'openclaw.json'
            config.parent.mkdir()
            config.write_text('{}\n', encoding='utf-8')
            state = root / 'state'
            state.mkdir()
            (state / 'bundled-setup-2.5.27').write_text('preserved\n', encoding='utf-8')
            version = root / 'VERSION'
            version.write_text('2.5.27\n', encoding='utf-8')
            with mock.patch.dict(os.environ, {
                    'UR_PROMPTS_DIR': str(config.parent), 'PINKIE_PRESERVE_EXISTING_PROFILE': '0'}), \
                 mock.patch.object(super_pinkie, 'windows_state_root', return_value=state), \
                 mock.patch.object(super_pinkie, 'resource_path', return_value=version), \
                 mock.patch.object(super_pinkie, 'ensure_mode_agents') as agents, \
                 mock.patch.object(super_pinkie, 'repair_provider_models'), \
                 mock.patch.object(super_pinkie, 'ensure_gateway_auth_none'), \
                 mock.patch.object(super_pinkie, 'ensure_workspace_avatars'), \
                 mock.patch.object(super_pinkie, 'install_runtime_service') as install:
                super_pinkie.prepare_bundled_desktop(lambda _: None)
            agents.assert_called_once()
            self.assertEqual([call.args[0] for call in install.call_args_list],
                             ['party', 'context', 'project-scope', 'mode-architecture',
                              'first-person-renderer'])

    def test_probe_gateway_and_helper_flags_hide_windows_without_losing_existing_flags(self):
        for module in (super_pinkie, windows_desktop):
            startup = SimpleNamespace(dwFlags=0, wShowWindow=None)
            with mock.patch.object(module.os, 'name', 'nt'), \
                 mock.patch.object(module.subprocess, 'STARTUPINFO', return_value=startup, create=True), \
                 mock.patch.object(module.subprocess, 'STARTF_USESHOWWINDOW', 1, create=True), \
                 mock.patch.object(module.subprocess, 'SW_HIDE', 0, create=True), \
                 mock.patch.object(module.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), \
                 mock.patch.object(module.subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x200, create=True):
                flags = module.hidden_process_kwargs()
            self.assertTrue(flags['creationflags'] & 0x08000000)
            self.assertTrue(flags['startupinfo'].dwFlags & 1)
            self.assertEqual(flags['startupinfo'].wShowWindow, 0)
            if module is windows_desktop:
                self.assertTrue(flags['creationflags'] & 0x200)

    def test_non_windows_child_creation_stays_portable(self):
        for module in (super_pinkie, windows_desktop):
            with mock.patch.object(module.os, 'name', 'posix'):
                self.assertEqual(module.hidden_process_kwargs(), {})

    def test_explicit_explorer_and_control_center_windows_are_shown(self):
        with mock.patch.object(windows_desktop.os, 'name', 'nt'), \
             mock.patch.object(windows_desktop.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), \
             mock.patch.object(windows_desktop.subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x200, create=True):
            self.assertEqual(windows_desktop.hidden_process_kwargs(hide_window=False), {'creationflags': 0x08000200})

    def test_both_executable_formats_request_admin_through_the_manifest(self):
        build = (Path(__file__).resolve().parents[1] / 'build-win.ps1').read_text(encoding='utf-8-sig')
        self.assertIn('"--windowed", "--uac-admin"', build)
        self.assertIn('$pyInstallerCommonArgs', build)
        self.assertIn('--onedir', build)
        self.assertIn('--onefile', build)

    def test_first_launch_installs_the_shared_complete_ui_without_powershell(self):
        import re
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            control = Path(directory) / 'dist/control-ui'
            control.mkdir(parents=True)
            (control / 'index.html').write_text('<html><head><script type="module" src="/assets/index-test.js"></script></head><body><openclaw-app></openclaw-app></body></html>')
            # Model the pinned upstream package's entry resources. The shared
            # installer must now reject missing upstream chunks as well.
            template = (Path(__file__).resolve().parents[1] / 'ui/control-ui.index.html').read_text(encoding='utf-8')
            for name in re.findall(r'(?:src|href)=["\']\.?/(assets/[^?"\']+)', template):
                file = control / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('upstream fixture')
            # Source resources are read only; every write goes to this fixture.
            original = super_pinkie.resource_path
            def resource(*parts):
                if parts == ('ui', 'assets'):
                    return Path(directory) / 'no-avatars'
                return original(*parts)
            with mock.patch.object(super_pinkie, 'resolve_openclaw_root', return_value=directory), \
                 mock.patch.object(super_pinkie, 'resource_path', side_effect=resource), \
                 mock.patch.object(super_pinkie.subprocess, 'run') as process:
                super_pinkie.install_theme(lambda _: None)
            process.assert_not_called()
            html = (control / 'index.html').read_text(encoding='utf-8')
            self.assertIn('laolao-theme.css?v=composer1101&h=', html)
            self.assertEqual(html.count('laolao-handoff-bootstrap.js'), 1)
            self.assertTrue((control / 'laolao-deep-think-full.webm').exists())


if __name__ == '__main__':
    unittest.main()
