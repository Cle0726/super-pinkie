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
    "metre": {"name": "Metre", "theme": "Metre 模式"},
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
        (installer / "apply-theme.sh").write_text("#!/bin/bash\nexit 0\n")
        (installer / "apply-theme.sh").chmod(0o755)
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

    def write_config(self, agents=tuple(IDENTITIES)):
        self.config.write_text(json.dumps({"agents": {"list": [
            {"id": agent, "identity": IDENTITIES[agent]} for agent in agents
        ]}}, ensure_ascii=False))

    def plan(self, extra_env=None):
        with mock.patch.dict(os.environ, extra_env or {}, clear=True):
            return PLAN.unchanged_agents(self.home, self.package, self.cli)

    def run_setup(self, agents=tuple(IDENTITIES), extra_env=None):
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
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def test_only_unambiguously_matching_identities_are_skipped(self):
        self.assertEqual(self.plan(), ["project", "learning", "metre"])
        project = self.home / ".openclaw/workspace-project/IDENTITY.md"
        project.write_text(project.read_text() + "- Name: 不同的名字\n")
        self.assertEqual(self.plan(), ["learning", "metre"])
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

    def test_atomic_stage_keeps_existing_modes_preferences_and_identities(self):
        config = json.loads(self.config.read_text(encoding='utf-8'))
        config['models'] = {'providers': {'local': {'models': []}}}
        existing = config['agents']['list'][0]
        existing['workspace'] = '/existing/project'
        self.config.write_text(json.dumps(config, ensure_ascii=False), encoding='utf-8')
        self.assertTrue(PLAN.stage_bundled_agents(self.config))
        updated = json.loads(self.config.read_text(encoding='utf-8'))
        rows = updated['agents']['list']
        self.assertEqual(rows[0]['id'], 'main')
        self.assertEqual(set(row['id'] for row in rows), set(PLAN.BUNDLED_MODES))
        self.assertEqual(next(row for row in rows if row['id'] == 'project'), existing)
        self.assertEqual(updated['models'], config['models'])
        self.assertFalse(PLAN.stage_bundled_agents(self.config))

    @unittest.skipUnless(shutil.which("bash") and sys.platform != "win32", "requires bash on macOS/Linux")
    def test_fresh_profile_registers_all_six_modes_before_the_managed_gateway(self):
        self.write_config(())
        calls = self.run_setup(agents=())
        self.assertEqual(calls, [])
        rows = json.loads(self.config.read_text(encoding='utf-8'))['agents']['list']
        self.assertEqual([row['id'] for row in rows], list(PLAN.BUNDLED_MODES))
        for row in rows:
            self.assertEqual(row['workspace'], str(self.config.parent / PLAN.BUNDLED_MODES[row['id']]))

    @unittest.skipUnless(shutil.which("bash") and sys.platform != "win32", "requires bash on macOS/Linux")
    def test_existing_version_marker_does_not_hide_missing_registrations(self):
        self.state.mkdir()
        (self.state / 'bundled-personas-2.5.29').touch()
        self.assertEqual(self.run_setup(), [])
        rows = json.loads(self.config.read_text(encoding='utf-8'))['agents']['list']
        self.assertEqual(set(row['id'] for row in rows), set(PLAN.BUNDLED_MODES))

    @unittest.skipUnless(shutil.which("bash") and sys.platform != "win32", "requires bash on macOS/Linux")
    def test_manual_external_runtime_still_uses_the_cli_identity_commands(self):
        calls = self.run_setup(extra_env={"PINKIE_MANAGED_GATEWAY": "0"})
        self.assertEqual([call[3] for call in calls if call[1] == "set-identity"], list(IDENTITIES))


if __name__ == "__main__":
    unittest.main()
