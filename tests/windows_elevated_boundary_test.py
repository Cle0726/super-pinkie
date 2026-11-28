"""app/windows_elevated.py 的异常权限、超时与窗口句柄失效边界单测（B143）。

补现有测试没覆盖的部分：
windows_resize_test.py 已覆盖 resized_window_rect 和 follow_native_resize 的正常拖动路径，
但没有补 ① 窗口句柄失效（GetWindowRect/GetCursorPos 返回 0）时是否在拖鼠标前就安全
退出，② 按住不放（释放信息丢失）时过期的 deadline 是否真能防止无限拖动；
start_elevated 只在 windows_update_ui_test.py 里被 mock 掉了本体，没有测过它自己对 ShellExecuteInfo
字段的填充（runas / 永远不用 SW_HIDE）与被拒绝提权、成功返回但空句柄两种失败形态；
ElevatedProcess（包装 Win32 句柄的 poll/wait/terminate）一行没测。

全用假 ctypes.WinDLL / 假 ctypes.windll.kernel32 对象与可控 sleep，不起真实窗口、不弹 UAC、
不依赖 Windows 平台（ctypes.windll / WinDLL / get_last_error / FormatError 在非 Windows 上本来不存在，
所以每处 mock.patch.object 都带 create=True，跟 windows_glass_test.py / windows_native_ui_publish_test.py
的写法一致）。
"""
import ctypes
import types
import unittest
from unittest import mock

from app import windows_elevated as elevated


class StartElevatedTests(unittest.TestCase):
    def fixture(self, exec_result=1, h_process=0xABCDEF):
        """假 shell32：ShellExecuteExW 把自己收到的 SHELLEXECUTEINFO 结构体记下来以便检查字段。"""
        shell32 = mock.Mock()
        info_holder = {}

        def shell_execute(byref_info):
            info = byref_info._obj
            info_holder["info"] = info
            if exec_result:
                info.hProcess = h_process
            return exec_result

        shell32.ShellExecuteExW.side_effect = shell_execute
        return shell32, info_holder

    def test_successful_elevation_sets_runas_verb_and_never_hides_the_window(self):
        shell32, info_holder = self.fixture()
        kernel = mock.Mock()
        kernel.GetProcessId.return_value = 4242
        windll_stub = types.SimpleNamespace(kernel32=kernel)
        with mock.patch.object(ctypes, "WinDLL", return_value=shell32, create=True), \
             mock.patch.object(ctypes, "windll", windll_stub, create=True):
            process = elevated.start_elevated(["tool.exe", "arg one", "arg two"], cwd="C:/work")
        info = info_holder["info"]
        self.assertEqual(info.lpVerb, "runas")
        self.assertEqual(info.lpFile, "tool.exe")
        self.assertEqual(info.lpParameters, '"arg one" "arg two"')
        self.assertEqual(info.lpDirectory, "C:/work")
        self.assertEqual(info.nShow, 7)  # SW_SHOWMINNOACTIVE，永远不用 SW_HIDE
        self.assertEqual(process.pid, 4242)

    def test_declined_uac_prompt_raises_oserror_with_the_real_winerror(self):
        # 用户在 UAC 弹窗里点「否」：ShellExecuteExW 返回 0，应该成为可辨别的 OSError，
        # 而不是被打成「启动成功」。winerror=1223 是 ERROR_CANCELLED。
        shell32, _ = self.fixture(exec_result=0)
        with mock.patch.object(ctypes, "WinDLL", return_value=shell32, create=True), \
             mock.patch.object(ctypes, "get_last_error", return_value=1223, create=True), \
             mock.patch.object(ctypes, "FormatError", return_value="The operation was canceled by the user.",
                               create=True):
            with self.assertRaises(OSError) as caught:
                elevated.start_elevated(["tool.exe"], cwd="C:/work")
        self.assertEqual(caught.exception.winerror, 1223)

    def test_a_true_return_with_a_null_process_handle_is_still_a_failure(self):
        # ShellExecuteExW 有时会返回非 0（成功）但 hProcess 仍为空：
        # SEE_MASK_NOCLOSEPROCESS 没真正拿到可等待的句柄。不能当成启动成功。
        shell32, _ = self.fixture(exec_result=1, h_process=0)
        with mock.patch.object(ctypes, "WinDLL", return_value=shell32, create=True), \
             mock.patch.object(ctypes, "get_last_error", return_value=5, create=True), \
             mock.patch.object(ctypes, "FormatError", return_value="Access is denied.", create=True):
            with self.assertRaises(OSError) as caught:
                elevated.start_elevated(["tool.exe"], cwd="C:/work")
        self.assertEqual(caught.exception.winerror, 5)


class ElevatedProcessTests(unittest.TestCase):
    """poll/wait/terminate 包装的 Win32 句柄行为，全用假 kernel32。"""

    def fake_kernel(self, pid=777):
        kernel = mock.Mock()
        kernel.GetProcessId.return_value = pid
        return kernel

    def make_process(self, kernel, handle=0x999):
        with mock.patch.object(ctypes, "windll", types.SimpleNamespace(kernel32=kernel), create=True):
            return elevated.ElevatedProcess(handle)

    def test_poll_returns_none_while_running_and_the_exit_code_once_signaled(self):
        kernel = self.fake_kernel()
        kernel.WaitForSingleObject.return_value = 0x102  # WAIT_TIMEOUT：还没结束
        process = self.make_process(kernel)
        self.assertIsNone(process.poll())
        kernel.GetExitCodeProcess.assert_not_called()  # 还没结束就不应该去查退出码

        kernel.WaitForSingleObject.return_value = 0  # WAIT_OBJECT_0：已结束

        def exit_code(_handle, pointer):
            pointer._obj.value = 3
            return 1

        kernel.GetExitCodeProcess.side_effect = exit_code
        self.assertEqual(process.poll(), 3)

    def test_wait_without_a_timeout_blocks_indefinitely(self):
        kernel = self.fake_kernel()
        kernel.WaitForSingleObject.return_value = 0
        kernel.GetExitCodeProcess.side_effect = lambda _h, pointer: setattr(pointer._obj, "value", 0) or 1
        process = self.make_process(kernel)
        process.wait()
        self.assertEqual(kernel.WaitForSingleObject.call_args_list[0].args[1], 0xFFFFFFFF)

    def test_wait_with_a_timeout_converts_seconds_to_milliseconds(self):
        kernel = self.fake_kernel()
        kernel.WaitForSingleObject.return_value = 0
        kernel.GetExitCodeProcess.side_effect = lambda _h, pointer: setattr(pointer._obj, "value", 0) or 1
        process = self.make_process(kernel)
        process.wait(timeout=2.5)
        self.assertEqual(kernel.WaitForSingleObject.call_args_list[0].args[1], 2500)

    def test_terminate_kills_the_handle_with_exit_code_1(self):
        kernel = self.fake_kernel()
        process = self.make_process(kernel, handle=0x999)
        process.terminate()
        kernel.TerminateProcess.assert_called_once_with(0x999, 1)


class FollowNativeResizeBoundaryTests(unittest.TestCase):
    """窗口句柄失效与超时边界：都必须在移动窗口之前安全让步。"""

    def fake_user(self, window_rect_ok=True, cursor_ok=True, held=True):
        user = mock.Mock()

        def get_window_rect(_handle, pointer):
            if not window_rect_ok:
                return 0
            rect = pointer._obj
            rect.left, rect.top, rect.right, rect.bottom = (100, 100, 1100, 800)
            return 1

        def get_cursor_pos(pointer):
            if not cursor_ok:
                return 0
            point = pointer._obj
            point.x, point.y = (1100, 800)
            return 1

        user.GetWindowRect.side_effect = get_window_rect
        user.GetCursorPos.side_effect = get_cursor_pos
        user.GetAsyncKeyState.return_value = -0x8000 if held else 0  # 按下位设置
        user.GetSystemMetrics.return_value = 0
        user.GetDpiForWindow.return_value = 96
        return user

    def test_a_dead_or_invisible_window_handle_is_refused_before_touching_the_mouse(self):
        user = self.fake_user(window_rect_ok=False)
        moved = elevated.follow_native_resize(0x1, "e", user=user, sleep=lambda _s: None)
        self.assertFalse(moved)
        user.GetAsyncKeyState.assert_not_called()
        user.SetWindowPos.assert_not_called()

    def test_a_cursor_position_query_failure_also_aborts_before_the_loop(self):
        user = self.fake_user(cursor_ok=False)
        moved = elevated.follow_native_resize(0x1, "e", user=user, sleep=lambda _s: None)
        self.assertFalse(moved)
        user.GetAsyncKeyState.assert_not_called()
        user.SetWindowPos.assert_not_called()

    def test_an_expired_deadline_stops_a_stuck_held_button_from_resizing_forever(self):
        # 按钮看上去永远没松开（释放消息被丢、或窗口失焦）：即使这样，一个已经过期的
        # deadline 仍必须拦下这次拖动，不能让窗口永久跟着鼠标移动。
        user = self.fake_user(held=True)
        moved = elevated.follow_native_resize(0x1, "e", user=user, sleep=lambda _s: None, deadline=-1.0)
        self.assertFalse(moved)
        # while 条件是 "GetAsyncKeyState(...) and time.monotonic() < ends"：
        # 第一个操作数会被评估一次，但已过期的 ends 让循环体不进入。
        self.assertEqual(user.GetAsyncKeyState.call_count, 1)
        user.SetWindowPos.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
