"""Offline smoke test across the installer, actual cards and board."""
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
BOARD_CHECK = """
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const extension = pathToFileURL(process.argv[1] + path.sep);
const {loadRoles} = await import(new URL('metre-roles.mjs', extension));
const {MetreBoard} = await import(new URL('metre-board.mjs', extension));
const catalogue = loadRoles();
assert.equal(catalogue.roles.length, 33, JSON.stringify(catalogue.invalid));
assert.equal(catalogue.invalid.length, 0);

const cards = path.join(process.env.OPENCLAW_STATE_DIR, 'workspace-metre', 'roles');
const user = path.join(cards, 'user');
fs.mkdirSync(user);
const official = fs.readFileSync(path.join(cards, 'researcher.md'), 'utf8');
fs.writeFileSync(path.join(user, 'researcher.md'), official.replace(/^name: .*$/m, 'name: 调研内测'));
fs.writeFileSync(path.join(user, 'broken.md'), 'not a role card');
const latest = loadRoles();
assert.equal(latest.byId.researcher.source, 'user');

const parent = 'agent:metre:main';
const key = 'agent:roles:pinkie-child:offline';
const lineage = {
  lineage: () => ({[key]: {parentKey: parent, title: '只读调研', metreRole: 'researcher',
    metreRoleSource: 'user', metreRoleName: '调研内测', model: 'fake-model'}}),
  state: () => ({}), familyRows: async () => new Map(), busy: () => false,
  metreLimits: () => ({maxRunning: 8, requestCap: 24}),
};
const board = new MetreBoard({root: process.env.PINKIE_STATE_ROOT, lineage});
const result = await board.board(parent);
const row = result.sessions[0];
assert.equal(row.roleName, '调研内测');
assert.equal(row.roleSource, 'user');
assert.equal(row.model, 'fake-model');
assert.deepEqual([result.runtime.metreRoles.valid, result.runtime.metreRoles.invalid], [33, 1]);
assert.equal(result.runtime.metreRoles.issues[0].file, 'broken.md');
"""


class MetreRolesInstallTests(unittest.TestCase):
    def setUp(self):
        self.setup = runpy.run_path(str(REPO / "services/mode-architecture/setup.py"))

    def test_existing_agents_kept_in_both_config_shapes(self):
        mode = {"model": "existing/model", "workspace": "existing/workspace"}
        for agents in ({"list": [{"id": "project", **mode}, {"id": "roles", "tools": {"deny": ["local-only"]}}]},
                       {"entries": {"project": mode.copy(), "roles": {"tools": {"deny": ["local-only"]}}}}):
            data = {"agents": agents}
            register = self.setup["_ensure_roles_agent"]
            register(data, Path("workspace-roles"))
            once = json.dumps(data)
            register(data, Path("workspace-roles"))
            self.assertEqual(json.dumps(data), once)
            if "list" in agents:
                self.assertEqual(agents["list"][0], {"id": "project", **mode})
                roles = agents["list"][1]
            else:
                self.assertEqual(agents["entries"]["project"], mode)
                roles = agents["entries"]["roles"]
            self.assertIn("local-only", roles["tools"]["deny"])
            self.assertEqual(roles["heartbeat"]["every"], "0m")
            self.assertFalse(roles["memorySearch"]["enabled"])

    @unittest.skipUnless(NODE, "requires Node to import the installed board")
    def test_fresh_install_loads_official_cards_and_board_reads_user_diagnostics(self):
        with tempfile.TemporaryDirectory(prefix="metre-roles-install-smoke-") as temporary:
            scratch = Path(temporary)
            home = scratch / "home"
            state = home / ".openclaw"
            state.mkdir(parents=True)
            config = state / "openclaw.json"
            config.write_bytes(b"{}\n")
            env = {"PINKIE_STATE_ROOT": str(scratch / "pinkie"), "PINKIE_APP_PATH": str(scratch / "no-app"),
                    "OPENAI_API_KEY": "", "OPENCLAW_STATE_DIR": str(state), "OPENCLAW_CONFIG_PATH": str(config)}
            with patch.dict(os.environ, env):
                self.assertTrue(self.setup["install"](home))
                first = config.read_bytes()
                self.setup["install"](home)
                self.assertEqual(config.read_bytes(), first)
                settings = json.loads(first)
                main, roles = settings["agents"]["list"]
                self.assertEqual((main["id"], roles["id"]), ("main", "roles"))
                # The release guard rewrites a bare main entry and tells the user
                # their settings were tampered with; setup must write it out.
                self.assertEqual(Path(main["workspace"]), state / "workspace")
                self.assertEqual(Path(roles["workspace"]), state / "workspace-roles")
                self.assertEqual(roles["contextInjection"], "never")
                self.assertFalse((state / "workspace-roles/memory").exists())
                extension = state / "extensions/pinkie-mode-architecture"
                result = subprocess.run([NODE, "--input-type=module", "-e", BOARD_CHECK, str(extension)],
                                        capture_output=True, text=True, encoding="utf-8", timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
