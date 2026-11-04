import ctypes
from types import SimpleNamespace
import unittest
from unittest import mock

from app import windows_desktop as desktop


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self


class WindowsNativeUiPublishTests(unittest.TestCase):
    def test_maximize_and_restore_work_when_native_events_arrive_synchronously(self):
        bridge = desktop.NativeBridge(None)
        calls = []

        def maximize():
            calls.append('maximize')
            bridge.maximized = True  # The native maximized event already fired.

        def restore():
            calls.append('restore')
            bridge.maximized = False  # The native restored event already fired.

        bridge.attach(SimpleNamespace(maximize=maximize, restore=restore))
        self.assertEqual(bridge.toggle_maximize(), {'maximized': True})
        self.assertEqual(bridge.toggle_maximize(), {'maximized': False})
        self.assertEqual(calls, ['maximize', 'restore'])

    def test_maximize_state_is_optimistic_when_native_event_arrives_later(self):
        bridge = desktop.NativeBridge(None)
        window = SimpleNamespace(maximize=mock.Mock(), restore=mock.Mock())
        bridge.attach(window)
        self.assertEqual(bridge.toggle_maximize(), {'maximized': True})
        self.assertEqual(bridge.toggle_maximize(), {'maximized': False})
        window.maximize.assert_called_once_with()
        window.restore.assert_called_once_with()

    def test_failed_native_maximize_restores_the_previous_state(self):
        bridge = desktop.NativeBridge(None)
        window = SimpleNamespace(maximize=mock.Mock(side_effect=RuntimeError('native error')))
        bridge.attach(window)
        with self.assertRaisesRegex(RuntimeError, 'native error'):
            bridge.toggle_maximize()
        self.assertFalse(bridge.maximized)

    def test_native_radius_tracks_physical_dpi_and_maximized_window_has_no_round_crop(self):
        self.assertEqual(desktop.native_corner_geometry(1000, 700, 120), (0, 0, 1001, 701, 55, 55))
        self.assertEqual(desktop.native_corner_geometry(1000, 700, 96), (0, 0, 1001, 701, 44, 44))
        self.assertIsNone(desktop.native_corner_geometry(1000, 700, 120, True))


    def test_region_handles_are_64_bit_and_resize_maximize_restore_reapply_clipping(self):
        user = SimpleNamespace(**{n: mock.Mock() for n in ('GetClientRect','GetDpiForWindow','IsZoomed','SetWindowRgn')})
        gdi = SimpleNamespace(CreateRoundRectRgn=mock.Mock(return_value=0x345678901), DeleteObject=mock.Mock())
        def get_rect(handle, pointer):
            self.assertEqual(handle, 0x123456789)
            values = ctypes.cast(pointer, ctypes.POINTER(ctypes.c_int32 * 4)).contents
            values[:] = [0, 0, 1000, 700]
            return 1
        user.GetClientRect.side_effect = get_rect
        user.GetDpiForWindow.return_value = 120
        user.IsZoomed.return_value = 0
        user.SetWindowRgn.return_value = 1
        native = SimpleNamespace(Handle=SimpleNamespace(ToInt64=lambda:0x123456789), Resize=Event(), DpiChanged=Event(), Opacity=1)
        window = SimpleNamespace(native=native)
        with mock.patch.object(desktop.os, 'name', 'nt'), \
             mock.patch.object(ctypes, 'WinDLL', create=True, side_effect=lambda name, **_:user if name=='user32' else gdi), \
             mock.patch.object(desktop, 'append_log'):
            desktop.configure_native_corners(window)
            gdi.CreateRoundRectRgn.assert_called_once_with(0, 0, 1001, 701, 55, 55)
            user.SetWindowRgn.assert_called_with(0x123456789, 0x345678901, True)
            user.IsZoomed.return_value = 1
            native.Resize.handlers[0]()
            user.SetWindowRgn.assert_called_with(0x123456789, None, True)
            user.IsZoomed.return_value = 0
            native.Resize.handlers[0]()
            self.assertEqual(gdi.CreateRoundRectRgn.call_count, 2)
        gdi.DeleteObject.assert_not_called()
        self.assertEqual(native.Opacity, 1)



if __name__ == '__main__':
    unittest.main()
