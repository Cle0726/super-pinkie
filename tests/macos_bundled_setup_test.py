import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


REPO = Path(__file__).resolve().parents[1]
INSTALLER = REPO / "installer/macos"
SPEC = importlib.util.spec_from_file_location("agent_setup_plan", INSTALLER / "agent-setup-plan.py")
PLAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PLAN)
IDENTITIES = {
    "project": {"name": "碧琪", "theme": "项目搭档", "emoji": "🎈", "avatar": "avatars/pinkie.png"},
    "learning": {"name": "碧琪", "theme": "学习搭档", "emoji": "🎈", "avatar": "avatars/pinkie.png"},
}


class BundledSetupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pinkie-mac-setup-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.state = self.root / "state"
        self.repo = self.root / "bundle"
        installer = self.repo / "installer/macos"
        installer.mkdir(parents=True)
        shutil.copy2(INSTALLER / "apply-bundled.sh", installer)
        shutil.copy2(INSTALLER / "agent-setup-plan.py", installer)
        (installer / "sync-personas.sh").write_text("#!/bin/bash\nexit 0\n")
        (self.repo / "VERSION").write_text("2.5.29\n")
        self.package = self.repo / "runtime/openclaw/package.json"
        self.package.parent.mkdir(parents=True)
        self.package.write_text('{"version":"2026.7.1-2"}')
        self.cli = self.package.parent / "openclaw.mjs"
        self.cli.write_text("placeholder")
        self.config = self.home / ".openclaw/openclaw.json"
        self.config.parent.mkdir(parents=True)
        self.write_config()
        for agent, identity in IDENTITIES.items():
            target = self.home / f".openclaw/workspace-{agent}/IDENTITY.md"
            target.parent.mkdir(parents=True)
            target.write_text("\n".join(f"- **{key.title()}:** {value}" for key, value in identity.items()) + "\n")

    def write_config(self, agents=("project", "learning")):
        self.config.write_text(json.dumps({"agents": {"list": [
            {"id": agent, "identity": IDENTITIES[agent]} for agent in agents
        ]}}, ensure_ascii=False))

    def plan(self, extra_env=None):
        with mock.patch.dict(os.environ, extra_env or {}, clear=True):
            return PLAN.unchanged_agents(self.home, self.package, self.cli)

    def run_setup(self, agents=("project", "learning"), extra_env=None):
        agent_state = self.root / "agents.json"
        agent_state.write_text(json.dumps(list(agents)))
        log = self.root / "calls.jsonl"
        executable = self.cli
        executable.write_text(f'''#!{sys.executable}
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ["FAKE_AGENT_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps(args) + "\\n")
path = pathlib.Path(os.environ["FAKE_AGENT_STATE"])
agents = json.loads(path.read_text())
if args[:2] == ["agents", "list"]:
    print(json.dumps([{{"id": agent}} for agent in agents]))
    if os.environ.get("FAKE_FAIL_LIST"):
        sys.exit(1)
elif args[:2] == ["agents", "add"]:
    agents.append(args[2]); path.write_text(json.dumps(agents))
''')
        executable.chmod(0o755)
        env = os.environ.copy()
        env.pop("OPENCLAW_CONFIG_PATH", None)
        env.pop("OPENCLAW_STATE_DIR", None)
        env.pop("OPENCLAW_HOME", None)
        env.pop("OPENCLAW_PROFILE", None)
        env.update({"HOME": str(self.home), "CFFIXED_USER_HOME": str(self.home),
                    "PINKIE_STATE_ROOT": str(self.state), "PINKIE_MANAGED_GATEWAY": "1",
                    "PINKIE_OPENCLAW_BIN": str(executable), "PINKIE_PYTHON_BIN": sys.executable,
                    "FAKE_AGENT_LOG": str(log), "FAKE_AGENT_STATE": str(agent_state)})
        env.update(extra_env or {})
        result = subprocess.run(["bash", str(self.repo / "installer/macos/apply-bundled.sh")],
                                env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [json.loads(line) for line in log.read_text().splitlines()]

    def test_only_unambiguously_matching_identities_are_skipped(self):
        self.assertEqual(self.plan(), ["project", "learning"])
        project = self.home / ".openclaw/workspace-project/IDENTITY.md"
        project.write_text(project.read_text() + "- Name: 不同的名字\n")
        self.assertEqual(self.plan(), ["learning"])
        self.assertEqual(self.plan({"OPENCLAW_CONFIG_PATH": "/custom/config.json"}), [])
        self.assertEqual(self.plan({"OPENCLAW_STATE_DIR": "/custom/state"}), [])
        self.assertEqual(self.plan({"OPENCLAW_HOME": "/custom/home"}), [])
        self.assertEqual(self.plan({"OPENCLAW_PROFILE": "custom"}), [])
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(PLAN.unchanged_agents(self.home, self.package, self.config), [])
        self.package.write_text('{"version":"2099.1.1"}')
        self.assertEqual(self.plan(), [])

    def test_includes_and_invalid_json_fall_back(self):
        self.config.write_text('{"$include":"elsewhere.json"}')
        self.assertEqual(self.plan(), [])
        self.config.write_text('{not-json}')
        self.assertEqual(self.plan(), [])

    @unittest.skipUnless(shutil.which("bash"), "requires bash")
    def test_existing_identities_reuse_one_validated_list(self):
        calls = self.run_setup()
        self.assertEqual(calls, [["agents", "list", "--json"]])

    @unittest.skipUnless(shutil.which("bash"), "requires bash")
    def test_changed_identity_still_uses_original_cli(self):
        path = self.home / ".openclaw/workspace-project/IDENTITY.md"
        path.write_text(path.read_text().replace("项目搭档", "新项目搭档"))
        calls = self.run_setup()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][:4], ["agents", "set-identity", "--agent", "project"])

    @unittest.skipUnless(shutil.which("bash"), "requires bash")
    def test_missing_project_refreshes_list_and_installs_identity(self):
        self.write_config(("learning",))
        calls = self.run_setup(agents=("learning",))
        self.assertEqual([call[:3] for call in calls], [
            ["agents", "list", "--json"], ["agents", "add", "project"],
            ["agents", "set-identity", "--agent"], ["agents", "list", "--json"],
        ])
        self.assertEqual(calls[2][3], "project")

    @unittest.skipUnless(shutil.which("bash"), "requires bash")
    def test_fresh_profile_adds_both_modes(self):
        self.write_config(())
        calls = self.run_setup(agents=())
        self.assertEqual([call[:3] for call in calls], [
            ["agents", "list", "--json"], ["agents", "add", "project"],
            ["agents", "set-identity", "--agent"], ["agents", "list", "--json"],
            ["agents", "add", "learning"], ["agents", "set-identity", "--agent"],
        ])

    @unittest.skipUnless(shutil.which("bash"), "requires bash")
    def test_failed_list_output_is_not_treated_as_valid(self):
        calls = self.run_setup(extra_env={"FAKE_FAIL_LIST": "1"})
        self.assertEqual([call[2] for call in calls if call[1] == "add"], ["project", "learning"])

    @unittest.skipUnless(shutil.which("bash"), "requires bash")
    def test_custom_config_uses_both_original_identity_commands(self):
        calls = self.run_setup(extra_env={"OPENCLAW_CONFIG_PATH": "/custom/config.json"})
        self.assertEqual([call[3] for call in calls if call[1] == "set-identity"], ["project", "learning"])


if __name__ == "__main__":
    unittest.main()
