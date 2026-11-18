import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from app.windows_desktop import (  # noqa: E402
    format_guard_alert,
    process_guard_alerts,
    verify_guard_counter,
)


def _node_bin():
    for candidate in (
        shutil.which("node"),
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
    ):
        if candidate and Path(candidate).is_file():
            return candidate
    nvm_dir = Path.home() / ".nvm" / "versions" / "node"
    if nvm_dir.is_dir():
        for bin_path in sorted(nvm_dir.glob("*/bin/node"), reverse=True):
            if bin_path.is_file():
                return str(bin_path)
    return None


class GuardNativeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.node = _node_bin()
        self.temp = tempfile.TemporaryDirectory(prefix="pinkie-guard-native-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def _run_node(self, script_code, *args):
        if not self.node:
            self.skipTest("node binary not available")
        res = subprocess.run(
            [self.node, "--input-type=module", "-e", script_code, *args],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        return res.stdout.strip()

    def _setup_signed_bundle(self, guard=True):
        bundle = self.root / "bundle"
        home = self.root / "home"
        state = home / ".openclaw"
        app_state = self.root / "app-state"
        (bundle / "personas" / "chat").mkdir(parents=True, exist_ok=True)
        (bundle / "VERSION").write_text("2.5.50\n", encoding="utf-8")
        (bundle / "build-info.json").write_text(
            json.dumps({"guard": guard, "channel": "release" if guard else "dev", "version": "2.5.50"}),
            encoding="utf-8",
        )
        (bundle / "personas" / "chat" / "SOUL.md").write_text("official soul", encoding="utf-8")
        (state / "workspace").mkdir(parents=True, exist_ok=True)
        (state / "workspace" / "SOUL.md").write_text("tampered soul", encoding="utf-8")

        pub = self._run_node(
            """
            import crypto from 'node:crypto';
            import fs from 'node:fs';
            import path from 'node:path';
            import {buildManifest, signBytes} from './installer/guard/guard.mjs';
            const [bundle] = process.argv.slice(1);
            const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
            const keyPem = privateKey.export({type: 'pkcs8', format: 'pem'});
            const pub = publicKey.export({type: 'spki', format: 'der'}).toString('base64');
            const manifest = buildManifest(bundle, {commit: 'a'.repeat(40)});
            fs.writeFileSync(path.join(bundle, 'guard-manifest.json'), JSON.stringify(manifest));
            fs.writeFileSync(path.join(bundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(bundle, 'guard-manifest.json')), keyPem));
            process.stdout.write(pub);
            """,
            str(bundle),
        )
        return bundle, home, state, app_state, pub

    def _run_guard_startup(self, bundle, home, state, app_state, pub):
        return json.loads(
            self._run_node(
                """
                import {startup} from './installer/guard/guard.mjs';
                const [bundle, home, stateDir, appState, key] = process.argv.slice(1);
                const out = startup({bundle, home, stateDir, appState, key});
                process.stdout.write(JSON.stringify(out));
                """,
                str(bundle), str(home), str(state), str(app_state), pub,
            )
        )

    def test_windows_counter_hmac_matches_node_and_handles_strikes_and_tamper(self):
        bundle, home, state, app_state, pub = self._setup_signed_bundle(guard=True)
        run_startup = lambda: self._run_guard_startup(bundle, home, state, app_state, pub)

        # Strike 1: Node writes counter.json + pending-alert.json, Python verifies HMAC & shows non-exit dialog
        r1 = run_startup()
        self.assertEqual(r1["strikesIn24h"], 1)
        self.assertTrue(verify_guard_counter(bundle, app_state, key=pub))

        shown = []
        should_exit, verified = process_guard_alerts(
            bundle,
            startup=True,
            app_state=app_state,
            openclaw_state=state,
            seen_ids=set(),
            counter_verified=False,
            presenter=lambda title, body, crit: shown.append((title, body, crit)),
            locker=lambda *_: True,
            key=pub,
        )
        self.assertFalse(should_exit)
        self.assertTrue(verified)
        self.assertEqual(len(shown), 1)
        self.assertFalse(shown[0][2])
        self.assertIn("换回官方版本", shown[0][0])

        # Strike 2 & 3 -> should_exit becomes True
        (state / "workspace" / "SOUL.md").write_text("tampered 2", encoding="utf-8")
        run_startup()
        process_guard_alerts(
            bundle, startup=True, app_state=app_state, openclaw_state=state,
            seen_ids=set(), counter_verified=verified,
            presenter=lambda *args: None, locker=lambda *_: True, key=pub,
        )

        (state / "workspace" / "SOUL.md").write_text("tampered 3", encoding="utf-8")
        run_startup()
        shown.clear()
        should_exit, verified = process_guard_alerts(
            bundle,
            startup=True,
            app_state=app_state,
            openclaw_state=state,
            seen_ids=set(),
            counter_verified=verified,
            presenter=lambda title, body, crit: shown.append((title, body, crit)),
            locker=lambda *_: True,
            key=pub,
        )
        self.assertTrue(should_exit)
        self.assertTrue(shown[0][2])
        self.assertIn("即将退出", shown[0][0])

        # Tampering counter.json directly -> Python catches invalid HMAC, calls locker, returns should_exit=True
        counter_path = app_state / "guard" / "counter.json"
        tampered = json.loads(counter_path.read_text(encoding="utf-8"))
        tampered["events"] = []
        counter_path.write_text(json.dumps(tampered), encoding="utf-8")
        self.assertFalse(verify_guard_counter(bundle, app_state, key=pub))
        locked_calls = []
        shown.clear()
        should_exit, _ = process_guard_alerts(
            bundle,
            startup=False,
            app_state=app_state,
            openclaw_state=state,
            seen_ids=set(),
            counter_verified=True,
            presenter=lambda title, body, crit: shown.append((title, body, crit)),
            locker=lambda b, a: locked_calls.append((b, a)) or True,
            key=pub,
        )
        self.assertTrue(should_exit)
        self.assertEqual(len(locked_calls), 1)
        self.assertIn("删除或改动", shown[0][0])

    def test_dev_build_never_triggers_guard_alerts_and_setup_clears_stale_mark(self):
        bundle, home, state, app_state, pub = self._setup_signed_bundle(guard=False)
        (app_state / "guard").mkdir(parents=True, exist_ok=True)
        (app_state / "guard" / "pending-alert.json").write_text(
            json.dumps({"id": "x", "limitReached": True}), encoding="utf-8"
        )
        shown = []
        should_exit, verified = process_guard_alerts(
            bundle,
            startup=True,
            app_state=app_state,
            openclaw_state=state,
            presenter=lambda *args: shown.append(args),
            key=pub,
        )
        self.assertFalse(should_exit)
        self.assertFalse(verified)
        self.assertEqual(shown, [])

        # Verify setup.py clears stale guard-build.json across all 3 product plugins when installing from a dev tree
        stale_marks = []
        for plugin_name in ("pinkie-mode-architecture", "pinkie-project-scope", "pinkie-first-person-renderer"):
            ext = state / "extensions" / plugin_name
            ext.mkdir(parents=True, exist_ok=True)
            mark = ext / "guard-build.json"
            mark.write_text(json.dumps({"guard": True, "channel": "release"}), encoding="utf-8")
            stale_marks.append(mark)
        (state / "openclaw.json").write_text("{}\n", encoding="utf-8")
        env = os.environ.copy()
        env["HOME"] = str(home)
        env["OPENCLAW_STATE_DIR"] = str(state)
        env["PINKIE_STATE_ROOT"] = str(app_state)
        res = subprocess.run(
            [
                sys.executable,
                "-c",
                "import importlib.util,sys; s=importlib.util.spec_from_file_location('s', sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.install(sys.argv[2])",
                str(ROOT / "services" / "mode-architecture" / "setup.py"),
                str(home),
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        for mark in stale_marks:
            self.assertFalse(mark.exists(), f"stale {mark} must be removed in dev installs")

    def test_updating_suppresses_alerts_and_receipt_avoids_legacy_false_lockout(self):
        bundle, home, state, app_state, pub = self._setup_signed_bundle(guard=True)
        # Pre-Batch-D bundled-setup-9.9.9 alone must NOT be treated as a counter receipt
        app_state.mkdir(parents=True, exist_ok=True)
        (app_state / "bundled-setup-9.9.9").write_text("preserved\n", encoding="utf-8")
        shown = []
        should_exit, verified = process_guard_alerts(
            bundle,
            startup=True,
            app_state=app_state,
            openclaw_state=state,
            seen_ids=set(),
            counter_verified=False,
            presenter=lambda *args: shown.append(args),
            key=pub,
        )
        self.assertFalse(should_exit)
        self.assertFalse(verified)
        self.assertEqual(shown, [])

        # After first startup writes guard-receipt.json, wiping guard/ IS caught on startup
        self._run_guard_startup(bundle, home, state, app_state, pub)
        shutil.rmtree(app_state / "guard")
        locked = []
        should_exit, _ = process_guard_alerts(
            bundle,
            startup=True,
            app_state=app_state,
            openclaw_state=state,
            seen_ids=set(),
            counter_verified=False,
            presenter=lambda *args: shown.append(args),
            locker=lambda b, a: locked.append((b, a)) or True,
            key=pub,
        )
        self.assertTrue(should_exit)
        self.assertEqual(len(locked), 1)

        # Active update suppresses alerts and counter checks cleanly
        shown.clear()
        should_exit, verified = process_guard_alerts(
            bundle,
            startup=True,
            app_state=app_state,
            openclaw_state=state,
            seen_ids=set(),
            counter_verified=True,
            is_updating=lambda _: True,
            presenter=lambda *args: shown.append(args),
            key=pub,
        )
        self.assertFalse(should_exit)
        self.assertTrue(verified)
        self.assertEqual(shown, [])

    def test_alert_formatting_is_plain_language(self):
        for payload in (
            {"categories": ["人设和工作手册"], "count": 1, "limit": 3, "backup": "/tmp/bk"},
            {"categories": ["人设和工作手册"], "count": 3, "limit": 3, "limitReached": True, "backup": "/tmp/bk"},
            {"counterTampered": True, "limitReached": True},
            {"restoreFailed": True},
            {"nonOfficial": True},
        ):
            title, body, _crit, _exit = format_guard_alert(payload)
            combined = title + "\n" + body
            for tech in ("JSON", "SHA-256", "HMAC", "openclaw.json", "exec", "hook", "daemon"):
                self.assertNotIn(tech, combined)


if __name__ == "__main__":
    unittest.main()
