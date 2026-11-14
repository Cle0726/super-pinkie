import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import super_pinkie

# What `openclaw agents list --json` prints for a fresh profile: UTF-8 with
# Chinese and emoji.  Decoding it as cp936/cp1252 (subprocess text=True on
# Windows) raises UnicodeDecodeError, which used to be swallowed silently.
FRESH_LIST = json.dumps([{"id": "main", "identityName": "超級碧琪 🎈", "default": True}], ensure_ascii=False).encode("utf-8")


def completed(stdout=b"", returncode=0, stderr=b""):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


class FakeOpenClaw:
    """Answers agents list/add/set-identity and records what was added."""

    def __init__(self, listing=FRESH_LIST, list_code=0, add_code=0):
        self.listing = listing
        self.list_code = list_code
        self.add_code = add_code
        self.added = []
        self.calls = []

    def __call__(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if "text" in kwargs or "encoding" in kwargs:
            raise AssertionError("openclaw output must be read as bytes and decoded as UTF-8")
        arguments = [str(part) for part in command]
        if arguments[-3:] == ["agents", "list", "--json"]:
            return completed(self.listing, self.list_code, b"boom" if self.list_code else b"")
        if "add" in arguments:
            agent_id = arguments[arguments.index("add") + 1]
            if self.add_code == 0:
                self.added.append(agent_id)
            return completed(b"", self.add_code, b"add failed" if self.add_code else b"")
        return completed(b"")


class ModeAgentRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.home = root / "home"
        self.state = root / "state"
        self.resources = root / "resources"
        (self.home / ".openclaw").mkdir(parents=True)
        (self.resources / "personas/project/playbooks").mkdir(parents=True)
        (self.resources / "personas/project/SOUL.md").write_text("发行人格", encoding="utf-8")
        (self.resources / "personas/project/IDENTITY.md").write_text("- **Name:** 项目碧琪", encoding="utf-8")
        (self.resources / "personas/project/playbooks/review.md").write_text("手册", encoding="utf-8")
        (self.resources / "VERSION").write_text("9.9.9\n", encoding="utf-8")
        self.logs = []
        self.patches = [
            mock.patch.object(super_pinkie.Path, "home", return_value=self.home),
            mock.patch.object(super_pinkie, "prompts_dir", return_value=self.home / ".openclaw"),
            mock.patch.object(super_pinkie, "windows_state_root", return_value=self.state),
            mock.patch.object(super_pinkie, "resource_path", side_effect=lambda *parts: self.resources.joinpath(*parts)),
            mock.patch.object(super_pinkie, "install_runtime_service", return_value=False),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.directory.cleanup()

    def write_config(self, ids):
        config = {"agents": {"list": [{"id": agent_id} for agent_id in ids]}}
        (self.home / ".openclaw/openclaw.json").write_text(json.dumps(config), encoding="utf-8")

    def test_utf8_listing_with_chinese_and_emoji_registers_missing_modes(self):
        with self.assertRaises(UnicodeDecodeError):
            FRESH_LIST.decode("cp1252")
        fake = FakeOpenClaw()
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=fake):
            self.assertTrue(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertEqual(fake.added, ["project", "thinking", "learning", "unrestricted", "metre"])

    def test_log_lines_before_json_are_tolerated(self):
        fake = FakeOpenClaw(listing=b"[plugins] loading pinkie-mode-architecture\n" + FRESH_LIST + b"\n")
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=fake):
            self.assertTrue(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertEqual(len(fake.added), 5)

    def test_non_json_listing_is_logged_and_reported(self):
        fake = FakeOpenClaw(listing=b"Error: config invalid")
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=fake):
            self.assertFalse(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertEqual(fake.added, [])
        self.assertTrue(any("读取模式列表失败" in line for line in self.logs))

    def test_failed_list_and_failed_add_are_reported(self):
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw(list_code=1)):
            self.assertFalse(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertTrue(any("返回码 1" in line for line in self.logs))
        self.logs.clear()
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw(add_code=2)):
            self.assertFalse(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertTrue(any("补齐 project 模式失败" in line for line in self.logs))

    def test_cli_timeout_is_logged_not_raised(self):
        timeout = subprocess.TimeoutExpired(cmd="openclaw", timeout=60)
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=timeout):
            self.assertFalse(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertTrue(self.logs)

    def test_complete_config_skips_the_cli(self):
        self.write_config(["main", "project", "thinking", "learning", "unrestricted", "metre"])
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=AssertionError("CLI must not run")):
            self.assertTrue(super_pinkie.ensure_mode_agents(self.logs.append))

    def test_failed_first_launch_is_repaired_on_the_next_launch(self):
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw(list_code=1)):
            super_pinkie.prepare_bundled_desktop(self.logs.append)
        self.assertTrue((self.state / "bundled-setup-9.9.9").exists())
        fake = FakeOpenClaw()
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=fake):
            super_pinkie.prepare_bundled_desktop(self.logs.append)
        self.assertEqual(fake.added, ["project", "thinking", "learning", "unrestricted", "metre"])

    def test_main_is_added_first_ahead_of_the_party_agents(self):
        # What services/party leaves in a fresh profile: no main at all, so
        # OpenClaw picked pinkie-party as the default and 唠嗑 ran as it.
        self.write_config(["pinkie-party", "party-openclaw"])
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw()):
            self.assertTrue(super_pinkie.ensure_mode_agents(self.logs.append))
        ids = super_pinkie.configured_agent_ids()
        self.assertEqual(ids[:3], ["main", "pinkie-party", "party-openclaw"])
        config = json.loads((self.home / ".openclaw/openclaw.json").read_text(encoding="utf-8"))
        self.assertEqual(config["agents"]["list"][0]["workspace"], str(self.home / ".openclaw/workspace"))

    def test_existing_main_is_moved_back_to_the_default_position(self):
        self.write_config(["pinkie-party", "main", "project", "thinking", "learning", "unrestricted", "metre"])
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw()):
            self.assertTrue(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertEqual(super_pinkie.configured_agent_ids()[:2], ["main", "pinkie-party"])

    def test_main_is_repaired_even_when_the_cli_fails(self):
        self.write_config(["pinkie-party"])
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw(list_code=1)):
            self.assertFalse(super_pinkie.ensure_mode_agents(self.logs.append))
        self.assertEqual(super_pinkie.configured_agent_ids()[0], "main")

    def test_main_registration_does_not_overwrite_a_concurrent_config_edit(self):
        self.write_config(["pinkie-party"])
        config = self.home / ".openclaw/openclaw.json"
        original_read = Path.read_bytes
        reads = 0

        def read_bytes(path):
            nonlocal reads
            if path == config:
                reads += 1
                if reads == 2:
                    config.write_text('{"user_change": true}', encoding="utf-8")
            return original_read(path)

        with mock.patch.object(Path, "read_bytes", read_bytes):
            self.assertFalse(super_pinkie.ensure_main_agent(self.logs.append, config))
        self.assertEqual(json.loads(config.read_text(encoding="utf-8")), {"user_change": True})
        self.assertEqual(list(config.parent.glob(".pinkie-main-*")), [])
        self.assertTrue(any("没有覆盖" in message for message in self.logs))

    def test_manuals_follow_the_official_version_and_memory_is_kept(self):
        workspace = self.home / ".openclaw/workspace-project"
        (workspace / "playbooks").mkdir(parents=True)
        (workspace / "memory").mkdir()
        (workspace / "IDENTITY.md").write_bytes("旧版身份\r\n".encode("utf-8"))
        (workspace / "SOUL.md").write_text("本机改过的人格", encoding="utf-8")
        (workspace / "playbooks/review.md").write_text("旧手册\n", encoding="utf-8")
        (workspace / "MEMORY.md").write_text("长期记忆", encoding="utf-8")
        (workspace / "memory/2026-11-02.md").write_text("当天记忆", encoding="utf-8")
        (workspace / "USER.md").write_text("关于我", encoding="utf-8")
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw()):
            super_pinkie.install_personas(self.logs.append)
        self.assertEqual((workspace / "IDENTITY.md").read_text(encoding="utf-8"), "- **Name:** 项目碧琪")
        self.assertEqual((workspace / "SOUL.md").read_text(encoding="utf-8"), (self.resources / "personas/project/SOUL.md").read_text(encoding="utf-8"))
        self.assertEqual((workspace / "playbooks/review.md").read_text(encoding="utf-8"), "手册")
        self.assertEqual((workspace / "MEMORY.md").read_text(encoding="utf-8"), "长期记忆")
        self.assertEqual((workspace / "memory/2026-11-02.md").read_text(encoding="utf-8"), "当天记忆")
        self.assertEqual((workspace / "USER.md").read_text(encoding="utf-8"), "关于我")
        backups = list(self.state.glob("backups/personas-*/project/IDENTITY.md"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), "旧版身份\r\n".encode("utf-8"))
        self.assertEqual(list(self.state.glob("backups/personas-*/project/SOUL.md"))[0].read_text(encoding="utf-8"), "本机改过的人格")

    def test_unrestricted_and_dreams_are_never_replaced(self):
        (self.resources / "personas/neutral").mkdir(parents=True)
        (self.resources / "personas/neutral/IDENTITY.md").write_text("新身份", encoding="utf-8")
        (self.resources / "personas/project/DREAMS.md").write_text("新梦", encoding="utf-8")
        free = self.home / ".openclaw/workspace-unrestricted"
        project = self.home / ".openclaw/workspace-project"
        free.mkdir(parents=True)
        project.mkdir(parents=True)
        (free / "IDENTITY.md").write_text("旧身份", encoding="utf-8")
        (project / "DREAMS.md").write_text("旧梦", encoding="utf-8")
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw()):
            super_pinkie.install_personas(self.logs.append)
        self.assertEqual((free / "IDENTITY.md").read_text(encoding="utf-8"), "旧身份")
        self.assertEqual((project / "DREAMS.md").read_text(encoding="utf-8"), "旧梦")

    def test_metre_workspace_gets_its_three_files_and_empty_placeholders(self):
        # briefs/metre-mode-1113 A0-3：只放 AGENTS / IDENTITY / SOUL；TOOLS / USER / HEARTBEAT 是空占位，
        # 免得 `openclaw agents add` 写进英文模板。用户自己写过的同名文件不动。
        source = self.resources / "personas/metre"
        source.mkdir(parents=True)
        for name in ("AGENTS.md", "IDENTITY.md", "SOUL.md"):
            (source / name).write_text(f"metre {name}", encoding="utf-8")
        metre = self.home / ".openclaw/workspace-metre"
        metre.mkdir(parents=True)
        (metre / "USER.md").write_text("我自己写的", encoding="utf-8")
        with mock.patch.object(super_pinkie.subprocess, "run", side_effect=FakeOpenClaw()):
            super_pinkie.install_personas(self.logs.append)
        self.assertEqual(sorted(p.name for p in metre.iterdir()), ["AGENTS.md", "HEARTBEAT.md", "IDENTITY.md", "SOUL.md", "TOOLS.md", "USER.md"])
        self.assertEqual((metre / "AGENTS.md").read_text(encoding="utf-8"), "metre AGENTS.md")
        self.assertEqual((metre / "TOOLS.md").read_text(encoding="utf-8"), "")
        self.assertEqual((metre / "USER.md").read_text(encoding="utf-8"), "我自己写的")

    def test_missing_workspace_avatars_are_filled_but_user_images_are_kept(self):
        assets = self.resources / "ui/assets"
        assets.mkdir(parents=True)
        for mode in ("chat", "project", "thinking", "learning", "unrestricted"):
            (assets / f"laolao-mode-{mode}-hd.png").write_bytes(mode.encode())
        custom = self.home / ".openclaw/workspace-project/avatars/pinkie-pie.png"
        custom.parent.mkdir(parents=True)
        custom.write_bytes(b"my avatar")
        super_pinkie.ensure_workspace_avatars(self.logs.append)
        self.assertEqual(custom.read_bytes(), b"my avatar")
        self.assertEqual((self.home / ".openclaw/workspace/avatars/pinkie-pie.png").read_bytes(), b"chat")
        self.assertEqual((self.home / ".openclaw/workspace-learning/avatars/pinkie-pie.png").read_bytes(), b"learning")
        self.assertEqual((self.home / ".openclaw/workspace-unrestricted/avatars/unrestricted-mode.png").read_bytes(), b"unrestricted")
        self.assertFalse(self.logs)


class FirstLaunchRegistrationTests(unittest.TestCase):
    """A fresh download must register the modes on its very first launch.

    The old flow ran ensure_mode_agents only when the per-version marker already
    existed, so the first start registered nothing and every mode plugin looked
    like it "did not take effect" until the next launch.
    """

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.home = root / "home"
        self.state = root / "state"
        self.resources = root / "resources"
        (self.home / ".openclaw").mkdir(parents=True)
        (self.resources / "personas/project").mkdir(parents=True)
        (self.resources / "VERSION").write_text("9.9.9\n", encoding="utf-8")
        self.logs = []
        self.config = self.home / ".openclaw/openclaw.json"
        self.config.write_text('{"agents": {"list": [{"id": "main"}]}}\n', encoding="utf-8")
        self.calls = []
        self.patches = [
            mock.patch.object(super_pinkie.Path, "home", return_value=self.home),
            mock.patch.object(super_pinkie, "openclaw_config_path", return_value=self.config),
            mock.patch.object(super_pinkie, "prompts_dir", return_value=self.home / ".openclaw"),
            mock.patch.object(super_pinkie, "windows_state_root", return_value=self.state),
            mock.patch.object(super_pinkie, "resource_path", side_effect=lambda *parts: self.resources.joinpath(*parts)),
            mock.patch.object(super_pinkie, "install_runtime_service", return_value=False),
            mock.patch.object(super_pinkie, "ensure_prompts", return_value=None),
            mock.patch.object(super_pinkie, "install_personas", return_value=None),
            mock.patch.object(super_pinkie, "repair_provider_models", return_value=None),
            mock.patch.object(super_pinkie, "ensure_gateway_auth_none", return_value=None),
            mock.patch.object(super_pinkie, "apply_browser_proxy", return_value=None),
            mock.patch.object(super_pinkie, "ensure_workspace_avatars", return_value=None),
            mock.patch.object(super_pinkie, "bundled_prepare_fingerprint", return_value="fp"),
            mock.patch.object(super_pinkie, "read_prepare_fingerprint", return_value="fp"),
            mock.patch.object(super_pinkie, "write_prepare_fingerprint", return_value=None),
            mock.patch.object(
                super_pinkie, "ensure_mode_agents",
                side_effect=lambda log: self.calls.append("ensure_mode_agents") or True,
            ),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.directory.cleanup()

    def test_a_first_launch_registers_the_modes(self):
        # The regression this guards: the call used to sit in an `else` branch
        # keyed on the per-version marker, so a fresh download never ran it.
        # Assert only that a first launch (no marker on disk beforehand) calls
        # ensure_mode_agents exactly once.
        marker = self.state / "bundled-setup-9.9.9"
        self.assertFalse(marker.exists(), "this test must start without the marker")
        seen = []
        super_pinkie.ensure_mode_agents.side_effect = lambda log: seen.append(1) or True
        super_pinkie.prepare_bundled_desktop(self.logs.append)
        self.assertEqual(len(seen), 1, "a first launch must register the mode agents")

    def test_a_later_launch_still_registers_the_modes(self):
        # Pretend the version marker already exists (second start of this version).
        self.state.mkdir(parents=True, exist_ok=True)
        (self.state / "bundled-setup-9.9.9").write_text("preserved\n", encoding="utf-8")
        super_pinkie.prepare_bundled_desktop(self.logs.append)
        self.assertIn("ensure_mode_agents", self.calls)


class PluginAllowListTests(unittest.TestCase):
    """A fresh profile must end up with every bundled plugin allowlisted.

    The setup scripts appended to plugins.allow only when a list already
    existed, so a brand-new config (no allow key) left every plugin outside
    the allowlist -- installed on disk, enabled in entries, and silently
    inactive. That is the "some plugins do not take effect" report.
    """

    SERVICES = ("project-scope", "first-person-renderer", "mode-architecture")
    EXPECTED = {
        "project-scope": "pinkie-project-scope",
        "first-person-renderer": "pinkie-first-person-renderer",
        "mode-architecture": "pinkie-mode-architecture",
    }

    def test_a_fresh_config_gets_an_allow_list(self):
        import importlib.util

        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / ".openclaw").mkdir(parents=True)
            config = home / ".openclaw/openclaw.json"
            config.write_text("{}\n", encoding="utf-8")
            source_root = Path(super_pinkie.__file__).resolve().parent.parent
            for name in self.SERVICES:
                path = source_root / "services" / name / "setup.py"
                if not path.is_file():
                    self.skipTest(f"{name} setup.py is not present in this checkout")
                spec = importlib.util.spec_from_file_location(
                    "parity_" + name.replace("-", "_"), path
                )
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                module.install(home=home)
            data = json.loads(config.read_text(encoding="utf-8"))
            allow = data.get("plugins", {}).get("allow")
            self.assertIsInstance(allow, list, "plugins.allow must exist after a fresh install")
            for name in self.SERVICES:
                self.assertIn(self.EXPECTED[name], allow)


if __name__ == "__main__":
    unittest.main()
