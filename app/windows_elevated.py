"""Elevated process execution, hidden subprocess kwargs, and native Windows window chrome helpers."""

from __future__ import annotations

import os
import subprocess
import sys
import time

def _desktop():
    return sys.modules.get("app.windows_desktop") or sys.modules.get("windows_desktop")

def append_log(*args, **kwargs):
    return _desktop().append_log(*args, **kwargs)


class ElevatedProcess:
    """Just enough of Popen for _wait_for_replacer, over a ShellExecuteEx handle."""

    def __init__(self, handle):
        import ctypes

        self._kernel = ctypes.windll.kernel32
        self._handle = handle
        self.pid = self._kernel.GetProcessId(handle)

    def poll(self):
        import ctypes

        if self._kernel.WaitForSingleObject(self._handle, 0) != 0:
            return None
        code = ctypes.c_ulong()
        self._kernel.GetExitCodeProcess(self._handle, ctypes.byref(code))
        return code.value

    def wait(self, timeout=None):
        self._kernel.WaitForSingleObject(self._handle, 0xFFFFFFFF if timeout is None else int(timeout * 1000))
        return self.poll()

    def terminate(self):
        self._kernel.TerminateProcess(self._handle, 1)


def start_elevated(command, cwd):
    """Run ``command`` through UAC ("runas"); OSError(winerror=1223) if declined."""
    import ctypes
    from ctypes import wintypes

    class ShellExecuteInfo(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD), ("fMask", ctypes.c_ulong), ("hwnd", wintypes.HWND),
            ("lpVerb", wintypes.LPCWSTR), ("lpFile", wintypes.LPCWSTR), ("lpParameters", wintypes.LPCWSTR),
            ("lpDirectory", wintypes.LPCWSTR), ("nShow", ctypes.c_int), ("hInstApp", wintypes.HINSTANCE),
            ("lpIDList", ctypes.c_void_p), ("lpClass", wintypes.LPCWSTR), ("hkeyClass", wintypes.HKEY),
            ("dwHotKey", wintypes.DWORD), ("hIconOrMonitor", wintypes.HANDLE), ("hProcess", wintypes.HANDLE),
        ]

    info = ShellExecuteInfo()
    info.cbSize = ctypes.sizeof(info)
    info.fMask = 0x00000040 | 0x00000100  # SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC
    info.lpVerb = "runas"
    info.lpFile = command[0]
    info.lpParameters = subprocess.list2cmdline(command[1:])
    info.lpDirectory = str(cwd)
    info.nShow = 7  # SW_SHOWMINNOACTIVE; never SW_HIDE (see Show-Foreground)
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    if not shell32.ShellExecuteExW(ctypes.byref(info)) or not info.hProcess:
        code = ctypes.get_last_error()
        raise OSError(0, ctypes.FormatError(code), None, code)
    return ElevatedProcess(info.hProcess)


def hidden_process_kwargs(hide_window=True):
    """Keep a helper's console out of sight, on the platforms that have one.

    creationflags is Windows-only; CREATE_NO_WINDOW does not exist elsewhere, so
    reading it unconditionally made every caller raise AttributeError off
    Windows instead of simply launching the helper.
    """
    if os.name != "nt":
        return {}
    flags = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}
    if not hide_window:
        return flags  # Explorer/control-center windows are intentional UI.
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    return {**flags, "startupinfo": startup}


def native_corner_geometry(width, height, dpi, maximized=False):
    if maximized or width <= 0 or height <= 0:
        return None
    # The shared HTML shell has a 22 CSS-pixel outer radius. HWND regions use
    # physical pixels; the real test machine is at 125%, not 96 DPI.
    diameter = round(44 * dpi / 96)
    return (0, 0, width + 1, height + 1, diameter, diameter)


def configure_native_corners(window):
    """Clip the HWND as well as HTML, including resize/DPI/maximize changes."""
    if os.name != "nt":
        return
    import ctypes

    class Rect(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int32) for name in ("left", "top", "right", "bottom")]

    user = ctypes.WinDLL("user32", use_last_error=True)
    gdi = ctypes.WinDLL("gdi32", use_last_error=True)
    user.GetClientRect.argtypes = [ctypes.c_void_p, ctypes.POINTER(Rect)]
    user.GetClientRect.restype = ctypes.c_int32
    user.GetDpiForWindow.argtypes = [ctypes.c_void_p]
    user.GetDpiForWindow.restype = ctypes.c_uint32
    user.IsZoomed.argtypes = [ctypes.c_void_p]
    user.IsZoomed.restype = ctypes.c_int32
    user.SetWindowRgn.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int32]
    user.SetWindowRgn.restype = ctypes.c_int32
    gdi.CreateRoundRectRgn.argtypes = [ctypes.c_int32] * 6
    gdi.CreateRoundRectRgn.restype = ctypes.c_void_p
    gdi.DeleteObject.argtypes = [ctypes.c_void_p]
    gdi.DeleteObject.restype = ctypes.c_int32
    native = window.native
    handle = int(native.Handle.ToInt64())
    last = []

    def apply(*_):
        rect = Rect()
        if not user.GetClientRect(handle, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        geometry = native_corner_geometry(rect.right, rect.bottom, user.GetDpiForWindow(handle) or 96,
                                          bool(user.IsZoomed(handle)))
        if last == [geometry]:
            return
        region = gdi.CreateRoundRectRgn(*geometry) if geometry else None
        if geometry and not region:
            raise ctypes.WinError(ctypes.get_last_error())
        if not user.SetWindowRgn(handle, region, True):
            if region:
                gdi.DeleteObject(region)
            raise ctypes.WinError(ctypes.get_last_error())
        # Windows owns the region after SetWindowRgn succeeds. Deleting it
        # here would invalidate the active clipping mask.
        last[:] = [geometry]

    def changed(*_):
        try:
            apply()
        except Exception as error:
            append_log("launcher", f"native corner update failed: {error}")

    native.Resize += changed
    if hasattr(native, "DpiChanged"):
        native.DpiChanged += changed
    window._pinkie_corner_handler = changed  # Keep the managed event delegate alive.
    apply()
    append_log("launcher", "native corners enabled: 22 CSS px; physical-DPI HWND region; square only when maximized")


RESIZE_EDGES = ("n", "ne", "e", "se", "s", "sw", "w", "nw")
WINDOW_MIN_SIZE = (760, 500)


def resized_window_rect(start, origin, cursor, edge, minimum):
    """Return the (left, top, right, bottom) rectangle for an edge drag."""
    left, top, right, bottom = start
    dx, dy = cursor[0] - origin[0], cursor[1] - origin[1]
    min_width, min_height = minimum
    if "w" in edge:
        left = min(left + dx, right - min_width)
    if "e" in edge:
        right = max(right + dx, left + min_width)
    if "n" in edge:
        top = min(top + dy, bottom - min_height)
    if "s" in edge:
        bottom = max(bottom + dy, top + min_height)
    return left, top, right, bottom


def follow_native_resize(handle, edge, user=None, sleep=time.sleep, deadline=120.0):
    """Move one window edge with the cursor until the mouse button is released."""
    import ctypes

    class Point(ctypes.Structure):
        _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32)]

    class Rect(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int32) for name in ("left", "top", "right", "bottom")]

    if user is None:
        user = ctypes.WinDLL("user32", use_last_error=True)
        user.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.POINTER(Rect)]
        user.GetWindowRect.restype = ctypes.c_int32
        user.GetCursorPos.argtypes = [ctypes.POINTER(Point)]
        user.GetCursorPos.restype = ctypes.c_int32
        user.GetAsyncKeyState.argtypes = [ctypes.c_int32]
        user.GetAsyncKeyState.restype = ctypes.c_int16
        user.GetSystemMetrics.argtypes = [ctypes.c_int32]
        user.GetSystemMetrics.restype = ctypes.c_int32
        user.GetDpiForWindow.argtypes = [ctypes.c_void_p]
        user.GetDpiForWindow.restype = ctypes.c_uint32
        user.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p] + [ctypes.c_int32] * 4 + [ctypes.c_uint32]
        user.SetWindowPos.restype = ctypes.c_int32
    rect, point = Rect(), Point()
    if not user.GetWindowRect(handle, ctypes.byref(rect)) or not user.GetCursorPos(ctypes.byref(point)):
        return False
    start = (rect.left, rect.top, rect.right, rect.bottom)
    origin = (point.x, point.y)
    scale = (user.GetDpiForWindow(handle) or 96) / 96
    minimum = (round(WINDOW_MIN_SIZE[0] * scale), round(WINDOW_MIN_SIZE[1] * scale))
    # GetAsyncKeyState reads the physical button; honour swapped buttons.
    button = 0x02 if user.GetSystemMetrics(23) else 0x01  # SM_SWAPBUTTON
    flags = 0x0004 | 0x0010 | 0x0200  # NOZORDER | NOACTIVATE | NOOWNERZORDER
    last = start
    ends = time.monotonic() + deadline
    while user.GetAsyncKeyState(button) & 0x8000 and time.monotonic() < ends:
        if user.GetCursorPos(ctypes.byref(point)):
            target = resized_window_rect(start, origin, (point.x, point.y), edge, minimum)
            if target != last:
                left, top, right, bottom = target
                user.SetWindowPos(handle, None, left, top, right - left, bottom - top, flags)
                last = target
        sleep(1 / 120)
    return last != start


def configure_native_glass(window):
    """Make the host transparent too, before its first paint on the GUI thread.

    A transparent HTML body over an opaque WinForms background still renders
    as a solid pink sheet. Give WebView2 an alpha-zero base and extend DWM's
    glass over the whole client area. Keep the window/text alpha at 100%.
    """
    if os.name != "nt":
        return
    import ctypes
    from System.Drawing import Color

    class Margins(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int32) for name in ("left", "right", "top", "bottom")]

    native = window.native
    native.BackColor = Color.Black  # DWM's zero-alpha client canvas.
    native.webview.DefaultBackgroundColor = Color.Transparent
    dwm = ctypes.WinDLL("dwmapi", use_last_error=True)
    extend = dwm.DwmExtendFrameIntoClientArea
    extend.argtypes = [ctypes.c_void_p, ctypes.POINTER(Margins)]
    extend.restype = ctypes.c_int32
    margins = Margins(-1, -1, -1, -1)
    handle = int(native.Handle.ToInt64())
    result = extend(handle, ctypes.byref(margins))
    if result < 0:
        raise OSError(f"DwmExtendFrameIntoClientArea failed: 0x{result & 0xffffffff:08x}")
    # pywebview's dark-theme default requests Mica. That would fill the clear
    # canvas again. Use desktop transparency, matching Mac, in either theme.
    # Windows 10 does not implement this Windows 11 attribute; full glass
    # above remains in effect there.
    attribute = dwm.DwmSetWindowAttribute
    attribute.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
    attribute.restype = ctypes.c_int32
    backdrop_none = ctypes.c_int32(1)  # DWMWA_SYSTEMBACKDROP_TYPE / DWMSBT_NONE
    attribute(handle, 38, ctypes.byref(backdrop_none), ctypes.sizeof(backdrop_none))
    append_log("launcher", "native glass enabled: WebView2 alpha=0; DWM full client; window alpha=1")
