"""uninstall-full.sh in an isolated HOME: real launchd, processes and /Applications stay untouched."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "uninstall-full.sh"
APP_NAME = "超級碧琪.app"
LOGGED = ("launchctl", "pkill", "killall", "osascript", "open", "node")
LOG_SHIM = """#!/bin/bash
echo "NAME $*" >> "$PINKIE_TEST_ROOT/shim.log"
exit 0
"""
# Refuses to move anything outside the test root, so a broken script can never trash the real App.
MV_GUARD = """#!/bin/bash
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    "$PINKIE_TEST_ROOT"/*) ;;
    *) echo "mv refused $*" >> "$PINKIE_TEST_ROOT/shim.log"; exit 97 ;;
  esac
done
echo "mv $*" >> "$PINKIE_TEST_ROOT/shim.log"
exec /bin/mv "$@"
"""


@unittest.skipIf(os.name == "nt" or not shutil.which("bash"), "needs bash")
class UninstallFullTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="pinkie-uninstall-")).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        self.state = self.root / "state"
        self.config = self.root / "config"
        self.agents = self.home / "Library" / "LaunchAgents"
        for path in (self.agents, self.state / "personas", self.config, self.root / "oc-empty"):
            path.mkdir(parents=True)
        (self.state / "personas" / "SOUL.md").write_text("keep me", encoding="utf-8")
        for label in ("com.super-pinkie.tts", "com.super-pinkie.reapply", "com.openclaw.urproxy"):
            (self.agents / f"{label}.plist").write_text("<plist/>", encoding="utf-8")
        shims = self.root / "shims"
        shims.mkdir()
        for name in LOGGED:
            (shims / name).write_text(LOG_SHIM.replace("NAME", name))
            (shims / name).chmod(0o755)
        (shims / "mv").write_text(MV_GUARD)
        (shims / "mv").chmod(0o755)
        self.app = self.make_app("apps")

    def make_app(self, folder):
        app = self.root / folder / APP_NAME
        (app / "Contents").mkdir(parents=True)
        (app / "Contents" / "Info.plist").write_text("<plist/>", encoding="utf-8")
        return app

    def write_install_env(self, app):
        (self.config / "install.env").write_text(f"""PINKIE_REPO='{REPO}'
PINKIE_PROVIDER=
PINKIE_APP_PATH='{app}'
""", encoding="utf-8")

    def run_uninstall(self, **extra):
        env = {
            "HOME": str(self.home),
            "PATH": f"{self.root / 'shims'}:/usr/bin:/bin:/usr/sbin:/sbin",
            "PINKIE_TEST_ROOT": str(self.root),
            "PINKIE_STATE_ROOT": str(self.state),
            "PINKIE_CONFIG_ROOT": str(self.config),
            "OPENCLAW_ROOT": str(self.root / "oc-empty"),
            "UR_PROMPTS_DIR": str(self.root / "prompts"),
            **extra,
        }
        result = subprocess.run(["bash", str(SCRIPT)], cwd=self.root, env=env,
                                capture_output=True, text=True, timeout=60)
        log = self.root / "shim.log"
        return result, log.read_text(encoding="utf-8") if log.exists() else ""

    def trashed(self):
        trash = self.home / ".Trash"
        return sorted(p.name for p in trash.iterdir()) if trash.exists() else []

    def assert_uninstalled(self, app, result, log):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr + log)
        self.assertNotIn("mv refused", log)
        self.assertFalse(app.exists())
        trashed = self.trashed()
        self.assertEqual(len(trashed), 1, trashed)
        self.assertRegex(trashed[0], r"^超級碧琪-[0-9]{8}-[0-9]{6}[.]app$")
        self.assertTrue((self.home / ".Trash" / trashed[0] / "Contents" / "Info.plist").is_file())
        self.assertEqual(list(self.agents.iterdir()), [])
        uid = os.getuid()
        for label in ("com.super-pinkie.tts", "com.super-pinkie.reapply"):
            self.assertIn(f"launchctl bootout gui/{uid}/{label}", log)
        self.assertIn("reapply-unrestricted-patch.mjs --remove", log)
        self.assertEqual((self.state / "personas" / "SOUL.md").read_text(encoding="utf-8"), "keep me")
        self.assertIn(str(self.state), result.stdout)

    def test_install_env_app_is_trashed_and_user_data_kept(self):
        self.write_install_env(self.app)
        result, log = self.run_uninstall()
        self.assert_uninstalled(self.app, result, log)

    def test_env_app_path_used_without_install_env(self):
        result, log = self.run_uninstall(PINKIE_APP_PATH=str(self.app))
        self.assert_uninstalled(self.app, result, log)

    def test_env_app_path_wins_over_install_env(self):
        recorded = self.make_app("recorded")
        self.write_install_env(recorded)
        result, log = self.run_uninstall(PINKIE_APP_PATH=str(self.app))
        self.assert_uninstalled(self.app, result, log)
        self.assertTrue((recorded / "Contents" / "Info.plist").is_file())

    def test_missing_app_is_not_an_error(self):
        self.write_install_env(self.root / "gone" / APP_NAME)
        result, log = self.run_uninstall()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr + log)
        self.assertNotIn("mv ", log)
        self.assertEqual(self.trashed(), [])
        self.assertTrue(self.app.exists())
        self.assertEqual(list(self.agents.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
