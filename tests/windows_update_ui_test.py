"""The update must stay on screen: progress, failure window, admin repair, rescue panel."""

import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
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

    def test_progress_window_removes_its_shown_marker_when_it_closes(self):
        # B19：.shown 只在窗口弹出前写一次，以前关窗只删状态文件和脚本，updates\ 里每次更新多一个。
        closed = PROGRESS_WINDOW_PS.index("ShowDialog()")
        self.assertGreater(PROGRESS_WINDOW_PS.index("Remove-Item -LiteralPath ($Status + '.shown')"), closed)

    def test_app_cleanup_and_stale_sweep_remove_shown_markers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            token = "a" * 32
            for name in (f"progress-{token}.json", f"progress-{token}.json.shown", f"progress-{token}.ps1"):
                (root / name).write_text("1", encoding="ascii")
            WindowsUpdater._stop_progress_window(None, root, token)
            self.assertEqual(sorted(p.name for p in root.iterdir()), [])

            old, fresh, other = (root / f"progress-{c * 32}.json.shown" for c in "bcd")
            for marker in (old, fresh):
                marker.write_text("1", encoding="ascii")
            (root / "progress-x.json").write_text("{}", encoding="utf-8")  # not a marker: left alone
            now = time.time()
            os.utime(old, (now - 2 * 86400, now - 2 * 86400))
            self.assertEqual(WindowsUpdater._sweep_stale_progress_markers(root, now=now), 1)
            self.assertFalse(old.exists())
            self.assertTrue(fresh.exists())  # an update that is running right now keeps its marker
            self.assertFalse(other.exists())
            self.assertTrue((root / "progress-x.json").exists())
            self.assertEqual(WindowsUpdater._sweep_stale_progress_markers(root / "missing", now=now), 0)

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

    def test_bridge_does_not_elevate_when_the_user_says_no(self):
        updater = mock.Mock()
        updater.launch_replacer.return_value = {"started": False, "elevate": True, "message": "x"}
        bridge = NativeBridge(updater)
        bridge._window = mock.Mock()
        with mock.patch.object(NativeBridge, "_ask_elevated_install", return_value=False):
            self.assertFalse(bridge.apply_update()["started"])
        self.assertEqual(updater.launch_replacer.call_args_list, [mock.call()])


class ElevationEntryPointsTest(unittest.TestCase):
    """The App runs unelevated (no --uac-admin); UAC is asked for only here."""

    ALLOWED = {"app/windows_elevated.py", "app/windows_ps_templates.py"}

    def test_only_the_known_entry_points_ask_for_uac(self):
        pattern = re.compile(r"""lpVerb\s*=\s*["']runas|-Verb\s+RunAs|Verb\s*=\s*["']runas""", re.I)
        found = set()
        for folder in ("app", "services", "installer"):
            for path in (ROOT / folder).rglob("*"):
                if path.suffix not in (".py", ".ps1", ".mjs", ".js", ".cjs") or "node_modules" in path.parts:
                    continue
                if pattern.search(path.read_text(encoding="utf-8-sig", errors="replace")):
                    found.add(path.relative_to(ROOT).as_posix())
        self.assertEqual(found, self.ALLOWED)

    def test_the_updater_elevates_in_one_place_and_only_when_asked(self):
        lines = (ROOT / "app/windows_updater.py").read_text(encoding="utf-8").splitlines()
        self.assertTrue(any("def launch_replacer(self, elevated=False):" in line for line in lines))
        calls = [i for i, line in enumerate(lines) if "start_elevated(" in line and "def start_elevated" not in line]
        self.assertEqual(len(calls), 1)
        guard = next(lines[i] for i in range(calls[0] - 1, -1, -1) if lines[i].strip().startswith("if "))
        self.assertEqual(guard.strip(), "if elevated:")

    def test_repair_button_elevates_only_on_click_and_restarts_unelevated(self):
        from app.windows_ps_templates import __file__ as templates_file
        templates = Path(templates_file).read_text(encoding="utf-8")
        click = templates.index("$admin.Add_Click(")
        runas = templates.index("-Verb RunAs")
        self.assertLess(click, runas, "RunAs must sit inside the button's click handler")
        self.assertEqual(templates.count("-Verb RunAs"), 1)
        # The elevated repair hands the restart to Explorer, so the App comes back unelevated.
        self.assertIn("& explorer.exe $TargetExe", REPAIR_PS)


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

    def test_updated_marker_travels_in_the_fragment(self):
        # A "?" in a file URL becomes "%3F" in .NET's Uri, so the splash was never found after an update.
        source = (ROOT / "app/windows_desktop.py").read_text(encoding="utf-8")
        # B95: the fragment also carries a moved gateway port, so it is built up first.
        self.assertIn('splash_fragment["updated"] = version or "1"', source)
        self.assertIn('loading += "#" + urllib.parse.urlencode(splash_fragment)', source)
        self.assertNotIn('loading += "?"', source)
        page = (ROOT / "ui/launcher-loading.html").read_text(encoding="utf-8")
        self.assertIn("location.hash.slice(1) || location.search", page)


class ProbeVisibilityTest(unittest.TestCase):
    def test_probe_uses_the_old_release_sibling_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old_app = root / "old-source" / "app"
            old_app.mkdir(parents=True)
            (old_app / "legacy_release_fixture.py").write_text("VERSION = 'old'\n", encoding="utf-8")
            old_source = old_app / "windows_desktop.py"
            old_source.write_text(
                "from legacy_release_fixture import VERSION\n"
                "class WindowsUpdater:\n"
                "    portable = True\n"
                "    def __init__(self, resource_root, executable): pass\n"
                "    def launch_replacer(self):\n"
                "        return {'started': True, 'from': VERSION, 'to': self.prepared['version']}\n",
                encoding="utf-8",
            )
            caller = root / "caller.py"
            caller.write_text(probe.CALLER, encoding="utf-8")
            result = root / "result.json"
            env = dict(os.environ)
            env.pop("PYTHONPATH", None)
            subprocess.run([sys.executable, str(caller), str(old_source), str(root / "app.exe"),
                            str(root / "payload.zip"), "digest", "new", str(result)],
                           cwd=root, env=env, capture_output=True, check=True)
            self.assertEqual(json.loads(result.read_text(encoding="utf-8")),
                             {"started": True, "from": "old", "to": "new"})

    def test_gaps_over_three_seconds_are_found(self):
        samples = [{"t": t, "titles": titles} for t, titles in (
            (0, ["超級碧琪"]), (1, []), (2, []), (3, ["超級碧琪更新"]),   # 2 s: fine
            (4, []), (5, []), (6, []), (7, []), (8, []), (9, ["超級碧琪"]),  # 5 s: a gap
            (10, []), (11, []), (12, []), (13, []), (14, []))]               # still open at the end
        self.assertEqual(probe.visibility_gaps(samples), [(4, 9, 5), (10, 14, 4)])
        self.assertEqual(probe.visibility_gaps(samples[:4]), [])

    def fake_clock(self, on_tick=None):
        now = [0.0]

        def sleep(seconds):
            now[0] += seconds
            if on_tick:
                on_tick(now[0])
        return (lambda: now[0]), sleep

    def test_note_wait_keeps_the_old_twenty_seconds_when_the_note_is_read_early(self):
        with tempfile.TemporaryDirectory() as folder:
            note = Path(folder) / "last-failure.json"
            note.write_text("{}", encoding="utf-8")
            # The restored window reads the note at 6 s: still never checked before 20 s.
            clock, sleep = self.fake_clock(lambda t: note.unlink() if t >= 6 and note.exists() else None)
            self.assertEqual(probe.wait_for_note(note, clock=clock, sleep=sleep), 20.0)
            self.assertFalse(note.exists())

    def test_note_wait_follows_a_slow_window_past_twenty_seconds(self):
        # 11-26 B19 on a busy machine: the restored dev build loaded its page at +32.6 s and read the
        # note at 28 s; the fixed 20 s wait reported "user was not told" for a window that did tell them.
        with tempfile.TemporaryDirectory() as folder:
            note = Path(folder) / "last-failure.json"
            note.write_text("{}", encoding="utf-8")
            clock, sleep = self.fake_clock(lambda t: note.unlink() if t >= 28 and note.exists() else None)
            self.assertEqual(probe.wait_for_note(note, clock=clock, sleep=sleep), 28.0)

    def test_note_wait_gives_up_at_the_limit_so_a_real_miss_is_still_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            note = Path(folder) / "last-failure.json"
            note.write_text("{}", encoding="utf-8")
            clock, sleep = self.fake_clock()
            self.assertEqual(probe.wait_for_note(note, clock=clock, sleep=sleep), 120.0)
            self.assertTrue(note.exists())  # the probe then reports the user was not told

    def test_probe_main_no_longer_sleeps_a_fixed_twenty_seconds_before_checking_the_note(self):
        source = (ROOT / "tools/windows-smoke/update_probe.py").read_text(encoding="utf-8")
        self.assertNotIn("time.sleep(20)", source)
        self.assertIn('summary["note_wait_seconds"] = wait_for_note(state / "updates/last-failure.json")', source)

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
