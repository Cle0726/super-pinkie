import ctypes
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

from app import windows_desktop


class NativeGlassTests(unittest.TestCase):
    def fixture(self):
        colors = SimpleNamespace(Black=object(), Transparent=object())
        native = SimpleNamespace(BackColor='old pink', webview=SimpleNamespace(DefaultBackgroundColor='white'),
                                 Handle=SimpleNamespace(ToInt64=lambda: 0x123456789), Opacity=1)
        extend = mock.Mock(return_value=0)
        attributes = mock.Mock(return_value=0)
        library = SimpleNamespace(DwmExtendFrameIntoClientArea=extend, DwmSetWindowAttribute=attributes)
        return colors, native, extend, attributes, library

    def test_both_host_layers_are_clear_without_fading_text_or_truncating_64_bit_handle(self):
        colors, native, extend, attributes, library = self.fixture()
        margins = []
        def capture(handle, pointer):
            self.assertEqual(handle, 0x123456789)
            margins.extend(ctypes.cast(pointer, ctypes.POINTER(ctypes.c_int32 * 4)).contents)
            return 0
        extend.side_effect = capture
        with mock.patch.object(windows_desktop.os, 'name', 'nt'), \
             mock.patch.dict(sys.modules, {'System.Drawing': SimpleNamespace(Color=colors)}), \
             mock.patch.object(ctypes, 'WinDLL', return_value=library, create=True), \
             mock.patch.object(windows_desktop, 'append_log'):
            windows_desktop.configure_native_glass(SimpleNamespace(native=native))
        self.assertIs(native.BackColor, colors.Black)
        self.assertIs(native.webview.DefaultBackgroundColor, colors.Transparent)
        self.assertEqual(native.Opacity, 1)
        self.assertEqual(margins, [-1, -1, -1, -1])
        self.assertEqual(attributes.call_args.args[:2], (0x123456789, 38))

    def test_failed_dwm_setup_is_reported_instead_of_claiming_glass_is_ready(self):
        colors, native, extend, _, library = self.fixture()
        extend.return_value = -1
        with mock.patch.object(windows_desktop.os, 'name', 'nt'), \
             mock.patch.dict(sys.modules, {'System.Drawing': SimpleNamespace(Color=colors)}), \
             mock.patch.object(ctypes, 'WinDLL', return_value=library, create=True), \
             mock.patch.object(windows_desktop, 'append_log') as log:
            with self.assertRaisesRegex(OSError, 'DwmExtendFrameIntoClientArea failed'):
                windows_desktop.configure_native_glass(SimpleNamespace(native=native))
        log.assert_not_called()

    def test_other_platforms_do_not_load_windows_native_libraries(self):
        with mock.patch.object(windows_desktop.os, 'name', 'posix'):
            windows_desktop.configure_native_glass(None)


if __name__ == '__main__':
    unittest.main()
