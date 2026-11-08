import ctypes
import unittest
from unittest import mock

from app import windows_desktop


class FakeUser32:
    """Just enough user32 for follow_native_resize: a cursor path and a button."""

    def __init__(self, rect, cursor_path, dpi=96, swapped=False):
        self.rect = rect
        self.cursor_path = list(cursor_path)
        self.cursor = self.cursor_path[0]
        self.dpi = dpi
        self.swapped = swapped
        self.moves = []
        self.polled_buttons = set()

    def GetWindowRect(self, handle, pointer):
        rect = pointer._obj
        rect.left, rect.top, rect.right, rect.bottom = self.rect
        return 1

    def GetCursorPos(self, pointer):
        point = pointer._obj
        point.x, point.y = self.cursor
        return 1

    def GetAsyncKeyState(self, button):
        self.polled_buttons.add(button)
        if not self.cursor_path:
            return 0
        self.cursor = self.cursor_path.pop(0)
        return -0x8000  # high bit set: still held

    def GetSystemMetrics(self, index):
        return 1 if index == 23 and self.swapped else 0

    def GetDpiForWindow(self, handle):
        return self.dpi

    def SetWindowPos(self, handle, after, x, y, width, height, flags):
        self.moves.append((x, y, width, height))
        return 1


class ResizeGeometryTests(unittest.TestCase):
    def test_each_edge_moves_only_its_own_sides(self):
        start, origin = (100, 100, 1100, 800), (0, 0)
        minimum = (760, 500)
        self.assertEqual(windows_desktop.resized_window_rect(start, origin, (50, 0), "e", minimum), (100, 100, 1150, 800))
        self.assertEqual(windows_desktop.resized_window_rect(start, origin, (-50, 0), "w", minimum), (50, 100, 1100, 800))
        self.assertEqual(windows_desktop.resized_window_rect(start, origin, (0, -30), "n", minimum), (100, 70, 1100, 800))
        self.assertEqual(windows_desktop.resized_window_rect(start, origin, (0, 40), "s", minimum), (100, 100, 1100, 840))
        self.assertEqual(windows_desktop.resized_window_rect(start, origin, (20, 30), "se", minimum), (100, 100, 1120, 830))
        self.assertEqual(windows_desktop.resized_window_rect(start, origin, (-20, -30), "nw", minimum), (80, 70, 1100, 800))

    def test_shrinking_stops_at_the_minimum_without_moving_the_opposite_edge(self):
        start, minimum = (100, 100, 1100, 800), (760, 500)
        self.assertEqual(windows_desktop.resized_window_rect(start, (0, 0), (900, 900), "nw", minimum), (340, 300, 1100, 800))
        self.assertEqual(windows_desktop.resized_window_rect(start, (0, 0), (-900, -900), "se", minimum), (100, 100, 860, 600))


class FollowNativeResizeTests(unittest.TestCase):
    def test_window_follows_the_pointer_until_the_button_is_released(self):
        user = FakeUser32((100, 100, 1100, 800), [(1100, 800), (1120, 810), (1120, 810), (1150, 850)])
        moved = windows_desktop.follow_native_resize(0x1234, "se", user=user, sleep=lambda _: None)
        self.assertTrue(moved)
        # Repeated cursor positions do not resend the same rectangle.
        self.assertEqual(user.moves, [(100, 100, 1020, 710), (100, 100, 1050, 750)])
        self.assertEqual(user.polled_buttons, {0x01})

    def test_minimum_size_follows_the_window_dpi(self):
        user = FakeUser32((0, 0, 1600, 1000), [(1600, 1000), (0, 0)], dpi=144)
        windows_desktop.follow_native_resize(1, "se", user=user, sleep=lambda _: None)
        self.assertEqual(user.moves, [(0, 0, 1140, 750)])

    def test_swapped_mouse_buttons_poll_the_physical_right_button(self):
        user = FakeUser32((0, 0, 1000, 800), [(1000, 800)], swapped=True)
        windows_desktop.follow_native_resize(1, "e", user=user, sleep=lambda _: None)
        self.assertEqual(user.polled_buttons, {0x02})

    def test_a_click_that_is_already_released_changes_nothing(self):
        user = FakeUser32((0, 0, 1000, 800), [(1000, 800)])
        user.cursor_path = []
        self.assertFalse(windows_desktop.follow_native_resize(1, "e", user=user, sleep=lambda _: None))
        self.assertEqual(user.moves, [])


class BeginResizeTests(unittest.TestCase):
    def bridge(self):
        bridge = windows_desktop.NativeBridge(updater=None)
        bridge._native_window_handle = lambda: 0x1234
        return bridge

    def test_resize_no_longer_relies_on_wm_nclbuttondown(self):
        # A frameless WinForms host has no WS_THICKFRAME, so DefWindowProc
        # ignores SC_SIZE: the old hand-off reported success and did nothing.
        bridge = self.bridge()
        with mock.patch.object(windows_desktop, "follow_native_resize") as follow, \
             mock.patch.object(bridge, "_begin_nonclient_action") as nonclient:
            self.assertTrue(bridge.begin_resize("SE"))
            for thread in [t for t in windows_desktop.threading.enumerate() if t.name == "pinkie-resize"]:
                thread.join(2)
        follow.assert_called_once_with(0x1234, "se")
        nonclient.assert_not_called()

    def test_unknown_edges_maximized_windows_and_missing_handles_are_refused(self):
        bridge = self.bridge()
        with mock.patch.object(windows_desktop, "follow_native_resize") as follow:
            self.assertFalse(bridge.begin_resize("middle"))
            bridge.maximized = True
            self.assertFalse(bridge.begin_resize("e"))
            bridge.maximized = False
            bridge._native_window_handle = lambda: None
            self.assertFalse(bridge.begin_resize("e"))
        follow.assert_not_called()

    def test_a_second_pointerdown_during_a_drag_does_not_start_another_loop(self):
        bridge = self.bridge()
        bridge._resize_active = True
        with mock.patch.object(windows_desktop.threading, "Thread") as thread:
            self.assertTrue(bridge.begin_resize("e"))
        thread.assert_not_called()


if __name__ == "__main__":
    unittest.main()
