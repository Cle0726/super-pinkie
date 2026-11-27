"""update.sh / update-full.sh against a local fake origin: detached HEAD and stash-pop conflicts."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
STUB = '#!/bin/bash\necho "$(basename "$0") $*" >> "$PINKIE_TEST_LOG"\n'
NOTES = [f"line {i}\n" for i in range(1, 11)]


@unittest.skipIf(os.name == "nt" or not shutil.which("bash") or not shutil.which("git"), "needs bash and git")
class UpdateEntryTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="pinkie-update-")).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.log = self.root / "install.log"
        (self.root / "home").mkdir()
        self.env = {
            "HOME": str(self.root / "home"),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@example.invalid",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@example.invalid",
            "PINKIE_TEST_LOG": str(self.log),
            "PINKIE_CONFIG_ROOT": str(self.root / "config"),
        }
        self.upstream = self.root / "upstream"
        self.upstream.mkdir()
        self.git(self.upstream, "init", "-q", "-b", "main")
        for name in ("update.sh", "update-full.sh"):
            shutil.copy2(REPO / name, self.upstream / name)
        for name in ("install.sh", "install-full.sh"):
            (self.upstream / name).write_text(STUB, encoding="utf-8")
            (self.upstream / name).chmod(0o755)
        (self.upstream / "VERSION").write_text("1.0\n", encoding="utf-8")
        self.write_notes(self.upstream, {})
        self.commit("base")
        self.work = self.root / "work"
        self.git(self.root, "clone", "-q", str(self.upstream), str(self.work))

    def git(self, cwd, *args):
        return subprocess.run(["git", *args], cwd=cwd, env=self.env, check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, message):
        self.git(self.upstream, "add", "-A")
        self.git(self.upstream, "commit", "-q", "-m", message)

    def write_notes(self, repo, changes):
        lines = [changes.get(i, line) for i, line in enumerate(NOTES, 1)]
        (repo / "notes.txt").write_text("".join(lines), encoding="utf-8")

    def run_script(self, name):
        result = subprocess.run(["bash", str(self.work / name)], cwd=self.work, env=self.env,
                                capture_output=True, text=True, timeout=60)
        log = self.log.read_text(encoding="utf-8") if self.log.exists() else ""
        return result, log

    def head(self, repo):
        return self.git(repo, "rev-parse", "HEAD")

    def bump_version(self):
        (self.upstream / "VERSION").write_text("1.1\n", encoding="utf-8")
        self.commit("bump")

    def test_update_full_follows_main_from_detached_head(self):
        self.git(self.work, "switch", "-q", "--detach", "HEAD")
        self.bump_version()
        result, log = self.run_script("update-full.sh")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.head(self.work), self.head(self.upstream))
        self.assertIn("install-full.sh", log)
        self.assertIn("1.1", result.stdout)

    def test_update_full_on_branch_fast_forwards(self):
        self.bump_version()
        result, log = self.run_script("update-full.sh")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.head(self.work), self.head(self.upstream))
        self.assertIn("install-full.sh", log)

    def test_update_keeps_local_edit_that_merges_cleanly(self):
        self.write_notes(self.upstream, {1: "upstream 1\n"})
        self.commit("upstream edit")
        self.write_notes(self.work, {10: "local 10\n"})
        result, log = self.run_script("update.sh")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.head(self.work), self.head(self.upstream))
        notes = (self.work / "notes.txt").read_text(encoding="utf-8")
        self.assertIn("upstream 1", notes)
        self.assertIn("local 10", notes)
        self.assertEqual(self.git(self.work, "stash", "list"), "")
        self.assertIn("install.sh", log)

    def test_update_stops_when_stash_pop_conflicts(self):
        self.write_notes(self.upstream, {10: "upstream 10\n"})
        self.commit("upstream edit")
        self.write_notes(self.work, {10: "local 10\n"})
        result, log = self.run_script("update.sh")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertNotIn("install.sh", log)
        self.assertIn("super-pinkie-update-", self.git(self.work, "stash", "list"))
        self.assertIn("git stash", output)


if __name__ == "__main__":
    unittest.main()
