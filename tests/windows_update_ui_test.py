"""The update must stay on screen: progress, failure window, admin repair, rescue panel."""

import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import time
import unittest
from unittest import mock

from app import windows_desktop
from app.windows_desktop import (
    PROGRESS_WINDOW_PS,
    REPAIR_PS,
    NativeBridge,
    WindowsUpdater,
    take_pending_launch_token,
    update_health_token_from_argv,
)

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("update_probe", ROOT / "tools/windows-smoke/update_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class HelperVisibilityTest(unittest.TestCase):
    def helpers(self):
        return {"onefile": WindowsUpdater._helper_source(), "portable": WindowsUpdater._directory_helper_source()}

    def test_no_window_is_started_with_sw_hide(self):
        for name, helper in self.helpers().items():
            with self.subTest(name):
                self.assertNotIn("#@@", helper)
                code = "\n".join(line for line in helper.splitlines() if not line.lstrip().startswith("#"))
                self.assertNotRegex(code, r"-WindowStyle\s+Hidden")
                self.assertIn("$info.CreateNoWindow = $true", helper)
                self.assertIn("$info.UseShellExecute = $false", helper)

    def test_both_helpers_show_progress_and_a_real_failure_window(self):
        for name, helper in self.helpers().items():
            with self.subTest(name):
                self.assertLess(helper.index("Start-UpdateProgressWindow\n"), helper.index("[IO.File]::WriteAllText($ReadyMarker, $Token"))
                self.assertIn("Show-Foreground $script:problemWindow", helper)
                self.assertIn("'用管理员权限修复'", helper)
                self.assertIn("-Verb RunAs -ArgumentList $script:RepairArguments", helper)
                self.assertIn("'打开文件夹'", helper)
                self.assertIn("'关闭'", helper)
                failed = helper.index('Write-UpdateLog "rollback failed')
                self.assertLess(failed, helper.index("Show-UpdateProblem (", failed))
                self.assertIn("Remove-UnusedRepairScript", helper)
                # The new version and the restored one are both started through
                # Start-AsUser, which uses Explorer when the helper is elevated.
                self.assertIn("$launched = Start-AsUser", helper)
                self.assertIn("& explorer.exe $full", helper)
                self.assertIn("pending-launch.json", helper)

    def test_progress_window_forces_itself_on_screen_and_waits_for_the_app(self):
        self.assertLess(PROGRESS_WINDOW_PS.index("($Status + '.shown')"), PROGRESS_WINDOW_PS.index("ShowDialog()"))
        self.assertIn("$window.Add_Loaded({ Show-Foreground $window })", PROGRESS_WINDOW_PS)
        self.assertIn("ShowWindow($handle, 1)", PROGRESS_WINDOW_PS)
        self.assertIn("SetForegroundWindow", PROGRESS_WINDOW_PS)
        self.assertIn("$_.MainWindowTitle -eq '超級碧琪'", PROGRESS_WINDOW_PS)
        self.assertIn("$data.state -eq 'problem'", PROGRESS_WINDOW_PS)
        self.assertIn("$script:ownerId = [int]$data.owner", PROGRESS_WINDOW_PS)

    def test_admin_repair_copies_back_in_backup_mode_and_restarts_unelevated(self):
        copy = REPAIR_PS.index("robocopy.exe $source $Target /E /B")
        self.assertLess(REPAIR_PS.index("Stop-Owned $root"), copy)
        self.assertLess(copy, REPAIR_PS.index("& explorer.exe $TargetExe"))
        self.assertNotIn("Start-Process -FilePath $TargetExe", REPAIR_PS)


class LaunchTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.environment = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.root / "state")})
        self.environment.start()
        self.exe = self.root / "app.exe"
        payload = self.root / "payload.exe"
        self.exe.write_bytes(b"old"); payload.write_bytes(b"new")
        self.updater = WindowsUpdater(self.root, executable=self.exe)
        self.updater.prepared = {"payload": payload, "sha256": self.updater._file_hash(payload), "version": "9.9.9"}

    def tearDown(self):
        self.environment.stop()
        self.temporary.cleanup()

    def ready(self, captured):
        process = mock.Mock(); process.poll.return_value = None

        def spawn(command, *args, **kwargs):
            captured.append((command, kwargs))
            Path(command[command.index("-ReadyMarker") + 1]).write_text(command[command.index("-Token") + 1], encoding="ascii")
            return process
        return spawn

    def test_the_app_opens_the_progress_window_before_it_closes(self):
        captured, progress = [], mock.Mock()
        with mock.patch.object(WindowsUpdater, "_start_progress_window", return_value=progress) as start, \
                mock.patch("app.windows_desktop.subprocess.Popen", side_effect=self.ready(captured)):
            self.assertTrue(self.updater.launch_replacer()["started"])
        start.assert_called_once()
        command, kwargs = captured[0]
        self.assertIn("-ProgressShown", command)
        self.assertIn("-RepairScript", command)
        self.assertNotIn("startupinfo", kwargs)  # no SW_HIDE for the replacer
        repair = Path(command[command.index("-RepairScript") + 1])
        self.assertIn("robocopy.exe", repair.read_text(encoding="utf-8-sig"))
        progress.terminate.assert_not_called()

    def test_progress_window_goes_away_when_the_helper_never_gets_ready(self):
        progress = mock.Mock()
        helper = mock.Mock(); helper.poll.return_value = 1
        with mock.patch.object(WindowsUpdater, "_start_progress_window", return_value=progress), \
                mock.patch("app.windows_desktop.subprocess.Popen", return_value=helper):
            self.assertFalse(self.updater.launch_replacer()["started"])
        progress.terminate.assert_called_once_with()

    def test_the_replacer_opens_the_progress_window_itself_as_a_fallback(self):
        captured = []
        with mock.patch.object(WindowsUpdater, "_start_progress_window", return_value=None), \
                mock.patch("app.windows_desktop.subprocess.Popen", side_effect=self.ready(captured)):
            self.updater.launch_replacer()
        command = captured[0][0]
        self.assertNotIn("-ProgressShown", command)
        self.assertTrue(Path(command[command.index("-ProgressScript") + 1]).is_file())

    def test_permission_denied_offers_the_elevated_install(self):
        helper = mock.Mock(); helper.poll.return_value = 1

        def denied(command, **_):
            Path(command[command.index("-ReadyMarker") + 1] + ".error").write_text(
                json.dumps({"kind": "UnauthorizedAccessException", "hresult": -2147024891}), encoding="utf-8")
            return helper
        with mock.patch.object(WindowsUpdater, "_start_progress_window", return_value=None), \
                mock.patch("app.windows_desktop.subprocess.Popen", side_effect=denied):
            result = self.updater.launch_replacer()
        self.assertTrue(result["elevate"])
        captured = []
        with mock.patch.object(WindowsUpdater, "_start_progress_window", return_value=None), \
                mock.patch("app.windows_desktop.start_elevated", side_effect=lambda command, cwd: self.ready(captured)(command)) as elevated:
            self.assertTrue(self.updater.launch_replacer(elevated=True)["started"])
        command = elevated.call_args.args[0]
        self.assertIn("-LaunchAsUser", command)
        self.assertEqual(command[1:3], ["-WindowStyle", "Hidden"])

    def test_declined_uac_keeps_the_app_open(self):
        error = OSError(0, "cancelled", None, 1223)
        with mock.patch.object(WindowsUpdater, "_start_progress_window", return_value=None), \
                mock.patch("app.windows_desktop.start_elevated", side_effect=error):
            result = self.updater.launch_replacer(elevated=True)
        self.assertFalse(result["started"])
        if os.name == "nt":
            self.assertIn("管理员权限", result["message"])

    def test_bridge_asks_before_elevating(self):
        updater = mock.Mock()
        updater.launch_replacer.side_effect = [{"started": False, "elevate": True, "message": "x"}, {"started": True}]
        bridge = NativeBridge(updater)
        bridge._window = mock.Mock()
        with mock.patch.object(NativeBridge, "_ask_elevated_install", return_value=True), \
                mock.patch("app.windows_desktop.threading.Timer"):
            self.assertTrue(bridge.apply_update()["started"])
        self.assertEqual(updater.launch_replacer.call_args_list[-1], mock.call(elevated=True))


class PendingLaunchTokenTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.token = "ab" * 16
        (self.root / "updates/health").mkdir(parents=True)
        self.file = self.root / "updates/health/pending-launch.json"

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, token=None):
        self.file.write_text(json.dumps({"token": token or self.token}), encoding="utf-8")

    def test_explorer_start_after_an_elevated_swap_reports_health(self):
        (self.root / f"updates/apply-{self.token}.ps1").write_text("x", encoding="utf-8")
        self.write()
        self.assertEqual(take_pending_launch_token(self.root), self.token)
        self.assertFalse(self.file.exists())
        self.assertIsNone(take_pending_launch_token(self.root))

    def test_stale_or_orphaned_tokens_are_ignored(self):
        self.write()
        self.assertIsNone(take_pending_launch_token(self.root))  # no live helper script
        (self.root / f"updates/apply-{self.token}.ps1").write_text("x", encoding="utf-8")
        self.write()
        self.assertIsNone(take_pending_launch_token(self.root, now=time.time() + 3600))
        self.write("not-a-token")
        self.assertIsNone(take_pending_launch_token(self.root))

    def test_command_line_wins_and_explicit_arguments_never_read_the_file(self):
        (self.root / f"updates/apply-{self.token}.ps1").write_text("x", encoding="utf-8")
        self.write()
        self.assertIsNone(update_health_token_from_argv([], root=self.root))
        self.assertTrue(self.file.exists())
        with mock.patch.object(windows_desktop.sys, "argv", ["app.exe"]):
            self.assertEqual(update_health_token_from_argv(root=self.root), self.token)


class StartupRescueTest(unittest.TestCase):
    def test_repair_button_forces_a_repair_and_restarts_a_dead_gateway(self):
        bridge = NativeBridge(mock.Mock())
        gateway = mock.Mock(); gateway.process = None
        gateway.repair_config.return_value = {"repaired": True, "step": "migration", "message": "已经自动修好"}
        bridge._gateway = gateway
        self.assertEqual(bridge.startup_repair(), {"ok": True, "message": "已经自动修好"})
        gateway.repair_config.assert_called_once_with(force=True)
        gateway.start.assert_called_once_with()

    def test_update_button_checks_downloads_and_installs(self):
        updater = mock.Mock()
        updater.check.return_value = {"available": True, "version": "2.5.37"}
        updater.prepare.return_value = {"ready": True}
        updater.launch_replacer.return_value = {"started": True}
        bridge = NativeBridge(updater)
        bridge._window = mock.Mock()
        with mock.patch("app.windows_desktop.threading.Timer"):
            result = bridge.startup_update()
        self.assertTrue(result["ok"])
        updater.launch_replacer.assert_called_once_with()

    def test_update_button_says_when_there_is_nothing_newer(self):
        updater = mock.Mock(); updater.check.return_value = {"available": False}
        result = NativeBridge(updater).startup_update()
        self.assertFalse(result["ok"])
        self.assertIn("最新版", result["message"])

    def test_status_carries_the_repair_notice(self):
        bridge = NativeBridge(mock.Mock(current_version="2.5.37"))
        bridge._gateway = mock.Mock(notice="碧琪发现设置文件有一处写错了，已经自动修好", exits=2)
        self.assertEqual(bridge.startup_status()["notice"], "碧琪发现设置文件有一处写错了，已经自动修好")

    def test_startup_page_offers_the_three_buttons_after_a_minute(self):
        page = (ROOT / "ui/launcher-loading.html").read_text(encoding="utf-8")
        for method, label in (("startup_repair", "自动修复设置"), ("startup_update", "检查更新并安装"), ("open_logs", "打开日志文件夹")):
            self.assertRegex(page, rf'data-rescue="{method}"[^>]*>{label}<')
            self.assertTrue(callable(getattr(NativeBridge, method)))
        self.assertIn("const rescueAfter = updated ? 150 : 60;", page)
        # macOS has no pywebview bridge; the panel only appears where it works.
        self.assertIn('typeof nativeApi()?.startup_repair === "function"', page)
        self.assertRegex(page, r'<section id="rescue" hidden')


class ProbeVisibilityTest(unittest.TestCase):
    def test_gaps_over_three_seconds_are_found(self):
        samples = [{"t": t, "titles": titles} for t, titles in (
            (0, ["超級碧琪"]), (1, []), (2, []), (3, ["超級碧琪更新"]),   # 2 s: fine
            (4, []), (5, []), (6, []), (7, []), (8, []), (9, ["超級碧琪"]),  # 5 s: a gap
            (10, []), (11, []), (12, []), (13, []), (14, []))]               # still open at the end
        self.assertEqual(probe.visibility_gaps(samples), [(4, 9, 5), (10, 14, 4)])
        self.assertEqual(probe.visibility_gaps(samples[:4]), [])

    def test_watch_samples_screenshots_and_spots_the_failure_window(self):
        frames = iter([[], [{"hwnd": 1, "title": "超級碧琪更新"}],
                       [{"hwnd": 2, "title": "超級碧琪更新 · 没有装上"}]])
        saved = []
        image = mock.Mock(); image.save.side_effect = lambda path: saved.append(Path(path).name)
        with tempfile.TemporaryDirectory() as folder:
            watch = probe.VisibilityWatch(folder, interval=0, shot_every=60,
                                          lister=lambda: next(frames, []), grab=lambda: image)
            watch.halt.wait = lambda _: watch.halt.set() if len(watch.samples) >= 3 else None
            watch.run()
        self.assertEqual(watch.failure_window["hwnd"], 2)
        self.assertEqual(len(saved), 3)  # first tick + two new windows
        self.assertTrue(all(re.match(r"\d{4}\.\ds-(tick|new-window)\.png", name) for name in saved))
        self.assertIn("超級碧琪更新 · 没有装上", watch.report()["titles_seen"])


class PinkieLookTest(unittest.TestCase):
    """Update windows carry 碧琪's own look, never a gray system dialog."""

    def xaml(self):
        text = windows_desktop.PINKIE_WPF_PS.split("@'\n", 1)[1].split("\n'@", 1)[0]
        return text.replace("@@TITLE@@", "t")

    def test_card_xaml_is_well_formed_and_borderless(self):
        import xml.dom.minidom
        xaml = self.xaml()
        xml.dom.minidom.parseString(xaml.encode("utf-8"))
        for needed in ('WindowStyle="None"', 'AllowsTransparency="True"', 'x:Name="Mascot"',
                       'x:Name="Fill"', 'x:Name="Buttons"', 'x:Key="PillPrimary"'):
            self.assertIn(needed, xaml)

    def test_progress_and_failure_windows_use_the_card_and_the_art(self):
        self.assertIn("New-PinkieWindow '超級碧琪更新' $heading", PROGRESS_WINDOW_PS)
        self.assertIn("Set-PinkieArt $mascot 'working'", PROGRESS_WINDOW_PS)
        for helper in (WindowsUpdater._directory_helper_source(), WindowsUpdater._helper_source()):
            self.assertIn("New-PinkieWindow '超級碧琪更新 · 没有装上'", helper)
            self.assertIn("$script:PinkieArtDir = Join-Path $UpdateRoot 'art'", helper)
            self.assertIn("'oops'", helper)

    def test_art_is_copied_out_of_the_install_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "app"
            (root / "ui/assets").mkdir(parents=True)
            for name in WindowsUpdater.UPDATE_ART:
                (root / f"ui/assets/laolao-pinkie-status-{name}.png").write_bytes(b"png-" + name.encode())
            (root / "VERSION").write_text("2.5.38", encoding="utf-8")
            updater = WindowsUpdater(root, executable=Path(folder) / "x.exe")
            updates = Path(folder) / "updates"
            updater._stage_update_art(updates)
            for name in WindowsUpdater.UPDATE_ART:
                self.assertEqual((updates / f"art/laolao-pinkie-status-{name}.png").read_bytes(), b"png-" + name.encode())

    def test_missing_splash_gets_a_built_in_page_with_a_way_out(self):
        page = windows_desktop.startup_fallback_html()
        self.assertNotIn("file:", page)
        self.assertNotIn("assets/", page)
        for call in ("startup_repair", "startup_update", "open_logs"):
            self.assertIn(f'data-call="{call}"', page)
        self.assertIn("http://127.0.0.1:18789/chat", page)


if __name__ == "__main__":
    unittest.main()
