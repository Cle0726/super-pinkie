"""Regression tests for tools/windows-smoke/smoke.py fixes the older smoke tests miss.

HOTSPOTS rank 34 (7 fix commits in the 2026-09-22..2026-11-20 window).
tests/windows_smoke_test.py already locks PAGE_STATE, the fresh identities,
the guard notice, service health and the Metre prompt retry.  This file locks:

1. 435632be: collect_files reports failure lines the launcher only writes to
   its own logs, and ignores ordinary lines.
2. 435632be: an upgrade run clears the older App's logs, so the new version is
   judged on its own log lines only.
3. a0ad8b2d: a console error (not a warning) fails the scenario.
4. c092fc4b: a failed packaged WebView2 capture fails the scenario.
5. 069a7fc3: seed_metre_user_data never replaces an existing user file and
   refuses a role specimen that lost its official id.

Nothing here starts the App, a browser or a gateway: the heavy steps of
scenario() are replaced by stubs that report a healthy run.
"""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("windows_smoke_hotspot", ROOT / "tools/windows-smoke/smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

PLUGIN_METHODS = ("usage", "workbench", "model_setup", "learning_desk", "metre_board")


def healthy_ui(console_errors=()):
    return {
        "modes": {mode: {"ok": True} for mode, _ in smoke.MODES},
        "plugin_methods": {name: {"ok": True} for name in PLUGIN_METHODS},
        "page_errors": [],
        "console_errors": list(console_errors),
    }


def healthy_agents():
    identities = {agent: "碧琪" for agent in smoke.AGENTS}
    identities["metre"] = "Metre"
    return {"ids": list(smoke.AGENTS), "identities": identities, "missing": []}


class CollectFilesLogProblemTests(unittest.TestCase):
    def test_launcher_only_failures_are_reported_and_ordinary_lines_are_not(self):
        with tempfile.TemporaryDirectory() as scratch:
            profile, out = Path(scratch) / "profile", Path(scratch) / "out"
            logs = profile / "local/SuperPinkie/logs"
            logs.mkdir(parents=True)
            out.mkdir()
            (logs / "setup.log").write_text("[t] 安装完成\n[t] 安装失败: 模式插件\n", encoding="utf-8")
            (logs / "launcher.log").write_text("[t] service started\n[t] gateway start failed: exit 1\n", encoding="utf-8")
            (logs / "gateway.log").write_text("[t] loaded 6 plugins\n[t] 1 plugin(s) failed to initialize\n", encoding="utf-8")
            problems = smoke.collect_files(profile, out, "fresh")["log_problems"]
        self.assertEqual(problems, [
            "gateway.log: [t] 1 plugin(s) failed to initialize",
            "launcher.log: [t] gateway start failed: exit 1",
            "setup.log: [t] 安装失败: 模式插件",
        ])

    def test_clean_logs_report_no_problem(self):
        with tempfile.TemporaryDirectory() as scratch:
            profile, out = Path(scratch) / "profile", Path(scratch) / "out"
            logs = profile / "local/SuperPinkie/logs"
            logs.mkdir(parents=True)
            out.mkdir()
            (logs / "launcher.log").write_text("[t] service started\n", encoding="utf-8")
            self.assertEqual(smoke.collect_files(profile, out, "fresh")["log_problems"], [])


class ScenarioVerdictTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        base = Path(self.scratch.name)
        self.profile, self.out = base / "profile", base / "out"
        self.out.mkdir()
        self.exe = base / "new/超級碧琪.exe"
        self.old_exe = base / "old/超級碧琪.exe"
        self.logs = self.profile / "local/SuperPinkie/logs"
        self.ui = healthy_ui()
        self.native = mock.Mock(return_value={"passed": True})
        self.old_launch_writes = ""

    def fake_launch(self, exe, env, out, label, timeout=480):
        if label.endswith("-old") and self.old_launch_writes:
            self.logs.mkdir(parents=True, exist_ok=True)
            (self.logs / "launcher.log").write_text(self.old_launch_writes, encoding="utf-8")
        process = mock.Mock(pid=4242)
        process.poll.return_value = 0
        return process, True, 1.0

    def run_scenario(self, label="fresh", old_exe=None):
        with mock.patch.multiple(
            smoke,
            release_info=mock.Mock(return_value=None),
            profile_env=mock.Mock(return_value={"LOCALAPPDATA": str(self.profile / "local")}),
            launch=self.fake_launch,
            runtime_dir=mock.Mock(return_value=self.exe.parent / "runtime"),
            agents_list=mock.Mock(return_value=healthy_agents()),
            drive_ui=mock.Mock(return_value=self.ui),
            service_health=mock.Mock(return_value={"party": True, "roundtable": True}),
            capture_native_ui=self.native,
            kill_app=mock.Mock(),
        ):
            return smoke.scenario(label, self.exe, self.profile, self.out, old_exe=old_exe)

    def test_healthy_stubbed_run_passes(self):
        summary = self.run_scenario()
        self.assertTrue(summary["passed"], summary)

    def test_upgrade_judges_the_new_version_on_its_own_log_lines(self):
        self.old_launch_writes = "[t] gateway start failed: old version\n"
        summary = self.run_scenario("upgrade", old_exe=self.old_exe)
        self.assertEqual(summary["old"]["files"]["log_problems"], ["launcher.log: [t] gateway start failed: old version"])
        self.assertEqual(summary["files"]["log_problems"], [], "the older App's logs leaked into the new verdict")
        self.assertTrue(summary["passed"], summary)

    def test_a_console_error_fails_the_scenario_but_a_warning_does_not(self):
        self.ui = healthy_ui([{"type": "warning", "text": "deprecated"}])
        self.assertTrue(self.run_scenario()["passed"])
        self.ui = healthy_ui([{"type": "error", "text": "Failed to load avatar"}])
        self.assertFalse(self.run_scenario()["passed"], "a console error must fail the smoke run")

    def test_a_failed_packaged_webview_capture_fails_the_scenario(self):
        self.native.side_effect = RuntimeError("packaged WebView2 UI capture failed: 1")
        summary = self.run_scenario()
        self.assertIn("packaged WebView2 UI capture failed", summary["error"])
        self.assertFalse(summary["passed"], "a failed native capture must fail the smoke run")


class SeedMetreUserDataTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        base = Path(self.scratch.name)
        self.exe = base / "app/超級碧琪.exe"
        self.profile = base / "profile"
        self.role = base / "app/personas/metre/roles/researcher.md"
        self.role.parent.mkdir(parents=True)
        self.state = self.profile / "home/.openclaw"
        patcher = mock.patch.object(smoke, "runtime_dir", return_value=base / "app/runtime")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_seeds_a_renamed_copy_of_the_official_role(self):
        self.role.write_text("﻿---\nid: researcher\nname: 研究员\n---\n", encoding="utf-8")
        files = smoke.seed_metre_user_data(self.exe, self.profile)
        seeded = (self.state / "workspace-metre/roles/user/upgrade-smoke-probe.md").read_bytes()
        self.assertEqual(seeded, files["workspace-metre/roles/user/upgrade-smoke-probe.md"])
        self.assertEqual(seeded.decode("utf-8"), "---\nid: upgrade-smoke-probe\nname: 研究员\n---\n")
        for name, data in files.items():
            self.assertEqual((self.state / name).read_bytes(), data, name)

    def test_never_replaces_a_file_the_user_already_has(self):
        self.role.write_text("---\nid: researcher\n---\n", encoding="utf-8")
        note = self.state / "workspace/metre-upgrade-user-note.txt"
        note.parent.mkdir(parents=True)
        note.write_text("用户自己的笔记\n", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            smoke.seed_metre_user_data(self.exe, self.profile)
        self.assertEqual(note.read_text(encoding="utf-8"), "用户自己的笔记\n")

    def test_refuses_a_role_specimen_without_its_official_id(self):
        self.role.write_text("---\nid: someone-else\n---\n", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "missing its official id"):
            smoke.seed_metre_user_data(self.exe, self.profile)
        self.assertFalse((self.state / "workspace-metre/roles/user/upgrade-smoke-probe.md").exists())


if __name__ == "__main__":
    unittest.main()
