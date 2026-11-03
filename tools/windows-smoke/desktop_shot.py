#!/usr/bin/env python3
"""Capture the real native window over two temporary desktop test surfaces.

The coloured surface is a separate HWND BEHIND the packaged App, never an
image injected into its HTML. Changing it must change pixels through the
chat surface. An opaque host cannot pass this check. No wallpaper is changed.
Run only in the isolated Windows smoke session.
"""
import argparse
import json
import time
from pathlib import Path


def prepare_desktop():
    import win32api
    import win32con
    mode = win32api.EnumDisplaySettings(None, win32con.ENUM_CURRENT_SETTINGS)
    if mode.PelsWidth < 1360 or mode.PelsHeight < 900:
        mode.PelsWidth, mode.PelsHeight = 1920, 1080
        result = win32api.ChangeDisplaySettings(mode, 0)
        if result != win32con.DISP_CHANGE_SUCCESSFUL:
            raise RuntimeError(f'Cannot create a desktop large enough for the full App: {result}')


def capture(pid, prefix, verify=False, maximize=False):
    import ctypes
    import psutil
    import win32api
    import win32con
    import win32gui
    import win32process
    from PIL import ImageChops, ImageGrab, ImageStat

    # Match ImageGrab's physical pixels on a high-DPI Windows desktop.
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    family = {pid}
    try:
        family.update(p.pid for p in psutil.Process(pid).children(recursive=True))
    except psutil.Error:
        pass
    windows = []
    def find(hwnd, _):
        if (win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd) == '超級碧琪'
                and win32process.GetWindowThreadProcessId(hwnd)[1] in family):
            windows.append(hwnd)
    win32gui.EnumWindows(find, None)
    if len(windows) != 1:
        raise RuntimeError(f'Expected one actual packaged App window, found {len(windows)}')
    app = windows[0]
    original_rect = win32gui.GetWindowRect(app)
    win32gui.ShowWindow(app, win32con.SW_MAXIMIZE if maximize else win32con.SW_RESTORE)
    # HWND_TOP cannot lift a background process's window over the foreground
    # one (the CI runner's console), which then covered the sampled regions.
    # Topmost is allowed; the test surface inserted right below inherits it.
    win32gui.SetWindowPos(app, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                          win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW | win32con.SWP_NOACTIVATE)
    left, top, right, bottom = win32gui.GetWindowRect(app)
    width, height = right - left, bottom - top
    screen = (win32api.GetSystemMetrics(0), win32api.GetSystemMetrics(1))
    if not maximize and (left < 0 or top < 0 or right > screen[0] or bottom > screen[1]):
        raise RuntimeError(f'App does not fit the desktop: {(left, top, right, bottom)} / {screen}')
    # Global window alpha must not be used to fake per-surface transparency.
    styles = win32gui.GetWindowLong(app, win32con.GWL_EXSTYLE)
    layered_alpha = None
    if styles & win32con.WS_EX_LAYERED:
        _, alpha, flags = win32gui.GetLayeredWindowAttributes(app)
        layered_alpha = alpha
        if flags & win32con.LWA_ALPHA and alpha != 255:
            raise RuntimeError(f'The entire window was faded to {alpha}/255')

    window_class = win32gui.WNDCLASS()
    window_class.hInstance = win32api.GetModuleHandle(None)
    window_class.lpszClassName = f'PinkieParityDesktop-{pid}'
    window_class.lpfnWndProc = win32gui.DefWindowProc
    atom = win32gui.RegisterClass(window_class)
    background = None
    frames = []
    try:
        background = win32gui.CreateWindowEx(
            win32con.WS_EX_TOOLWINDOW | win32con.WS_EX_NOACTIVATE,
            window_class.lpszClassName, 'UI parity desktop test surface', win32con.WS_POPUP | win32con.WS_VISIBLE,
            0, 0, screen[0], screen[1], 0, 0, window_class.hInstance, None)
        # Insert immediately below the App without stealing its focus.
        win32gui.SetWindowPos(background, app, 0, 0, screen[0], screen[1], win32con.SWP_NOACTIVATE)
        for name, rgb in [('blue', (18, 60, 105)), ('amber', (235, 182, 110))]:
            dc = win32gui.GetDC(background)
            brush = win32gui.CreateSolidBrush(win32api.RGB(*rgb))
            try:
                win32gui.FillRect(dc, (0, 0, *screen), brush)
                win32gui.SetTextColor(dc, win32api.RGB(255, 255, 255))
                win32gui.SetBkMode(dc, win32con.TRANSPARENT)
                win32gui.DrawText(dc, 'Desktop transparency verification / separate window behind Pinkie', -1,
                                  (20, 10, screen[0] - 20, 40), win32con.DT_LEFT)
            finally:
                win32gui.DeleteObject(brush)
                win32gui.ReleaseDC(background, dc)
            time.sleep(.3)
            frame = ImageGrab.grab(all_screens=True)
            frame.save(str(prefix) + f'-desktop-{name}.png')
            frames.append(frame)
    finally:
        if background:
            win32gui.DestroyWindow(background)
        win32gui.SetWindowPos(app, win32con.HWND_NOTOPMOST, 0, 0, 0, 0,
                              win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_NOACTIVATE)
        win32gui.UnregisterClass(window_class.lpszClassName, window_class.hInstance)
        if maximize:
            win32gui.ShowWindow(app, win32con.SW_RESTORE)
            x, y, r, b = original_rect
            win32gui.SetWindowPos(app, win32con.HWND_TOP, x, y, r - x, b - y, win32con.SWP_NOACTIVATE)

    # Sample broad chat regions; moving decorative pixels cannot pass a median
    # difference check. Learning cards may deliberately have opaque paper.
    differences = []
    for box in [(.30, .20, .43, .36), (.43, .39, .56, .53)]:
        region = tuple(int((left if i % 2 == 0 else top) + v * (width if i % 2 == 0 else height))
                       for i, v in enumerate(box))
        diff = ImageChops.difference(*(frame.crop(region).convert('RGB') for frame in frames))
        differences.append(round(sum(ImageStat.Stat(diff).median) / 3, 2))
    result = {'pid': pid, 'window': [left, top, right, bottom], 'screen': screen,
              'maximized': maximize,
              'background': 'separate temporary HWND behind the App', 'layered_alpha': layered_alpha,
              'median_pixel_changes': differences, 'verified': max(differences) >= 12}
    Path(str(prefix) + '-desktop.json').write_text(json.dumps(result, indent=2) + '\n')
    if verify and not result['verified']:
        raise RuntimeError(f'Desktop does not show through the real native chat window: {differences}')
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--pid', type=int)
    parser.add_argument('--prefix', type=Path)
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--maximize', action='store_true')
    args = parser.parse_args()
    if args.prepare:
        prepare_desktop()
    else:
        if args.pid is None or args.prefix is None:
            parser.error('--pid and --prefix are required for capture')
        capture(args.pid, args.prefix, args.verify, args.maximize)
