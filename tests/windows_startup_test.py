import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import super_pinkie, windows_desktop


class WindowsStartupTests(unittest.TestCase):
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
            template = (Path(__file__).resolve().parents[1] / 'ui/control-ui.index.html').read_text()
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
            html = (control / 'index.html').read_text()
            self.assertIn('laolao-theme.css?v=composer1101&h=', html)
            self.assertEqual(html.count('laolao-handoff-bootstrap.js'), 1)
            self.assertTrue((control / 'laolao-deep-think-full.webm').exists())


if __name__ == '__main__':
    unittest.main()
