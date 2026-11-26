"""tools/cle-pkg-mac 三件套的隔离单测。

全部在临时目录里跑：临时 HOME / App 目录 / 备份目录 / LaunchAgents，
launchctl、pgrep、codesign、ditto 都换成只记录调用的假命令，并开着 CLE_ISO_ROOT，
绝不碰真实 /Applications 和 launchd。Linux 上也能跑（CI portable-checks）。
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "cle-pkg-mac"
APP_NAME = "超級碧琪.app"
BUILD_REL = Path("Contents/Resources/SuperPinkie/build-info.json")
WATCHDOG, GATEWAY, URPROXY = "ai.openclaw.watchdog", "ai.openclaw.gateway", "com.openclaw.urproxy"
TTS, REAPPLY = "com.super-pinkie.tts", "com.super-pinkie.reapply"
UNMANAGED = "com.example.self-built-gateway"
SCRIPTS = ("backup-current", "install-cle", "restore")


def _bash():
    if os.name == "nt":
        return None
    if os.path.exists("/bin/bash"):
        return "/bin/bash"
    return shutil.which("bash")


BASH = _bash()

FAKES = {
    "fake-launchctl": 'printf "%s\\n" "$*" >> "$FAKE_LOG/launchctl.log"\nexit 0\n',
    "fake-pgrep": 'printf "%s\\n" "$*" >> "$FAKE_LOG/pgrep.log"\n'
    'if [ -n "${FAKE_PGREP_HIT:-}" ]; then exit 0; fi\nexit 1\n',
    "fake-codesign": 'printf "%s\\n" "$*" >> "$FAKE_LOG/codesign.log"\n'
    'if [ -n "${FAKE_CODESIGN_FAIL:-}" ]; then exit 1; fi\nexit 0\n',
    "fake-ditto": 'printf "%s\\n" "$*" >> "$FAKE_LOG/ditto.log"\ncp -pR "$1" "$2"\n',
}


def make_app(path, version, channel):
    (path / "Contents" / "MacOS").mkdir(parents=True, exist_ok=True)
    (path / "Contents" / "MacOS" / "SuperPinkie").write_text(f"bin {version} {channel}\n")
    info = path / BUILD_REL
    info.parent.mkdir(parents=True, exist_ok=True)
    info.write_text(
        f'{{"guard": false, "channel": "{channel}", "version": "{version}", "commit": "c-{version}"}}\n'
    )


def channel_of(path):
    text = (path / BUILD_REL).read_text()
    return text.split('"channel": "')[1].split('"')[0]


def version_of(path):
    text = (path / BUILD_REL).read_text()
    return text.split('"version": "')[1].split('"')[0]


@unittest.skipIf(BASH is None, "需要 bash（Windows 上不跑）")
class ClePkgMacTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cle-pkg-mac-"))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        self.apps = self.root / "Applications"
        self.backups = self.root / "backups"
        self.agents = self.home / "Library" / "LaunchAgents"
        self.pkg = self.root / "out" / APP_NAME
        self.bin = self.root / "bin"
        self.log = self.root / "log"
        for d in (self.home, self.apps, self.agents, self.bin, self.log):
            d.mkdir(parents=True, exist_ok=True)
        for name, body in FAKES.items():
            p = self.bin / name
            p.write_text("#!/bin/sh\n" + body)
            p.chmod(0o755)
        self.app = self.apps / APP_NAME
        make_app(self.app, "2.5.54", "release")
        make_app(self.pkg, "3.0.0", "cle")
        self.domain = f"gui/{os.getuid()}"
        self.env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(self.home),
            "TMPDIR": str(self.root),
            "LC_ALL": "C",
            "CLE_ISO_ROOT": str(self.root),
            "CLE_APP_DIR": str(self.apps),
            "CLE_BACKUP_DIR": str(self.backups),
            "CLE_AGENTS_DIR": str(self.agents),
            "CLE_PKG": str(self.pkg),
            "CLE_LAUNCHCTL": str(self.bin / "fake-launchctl"),
            "CLE_PGREP": str(self.bin / "fake-pgrep"),
            "CLE_CODESIGN": str(self.bin / "fake-codesign"),
            "CLE_DITTO": str(self.bin / "fake-ditto"),
            "FAKE_LOG": str(self.log),
        }

    def run_tool(self, name, *args, unset=(), **extra):
        env = dict(self.env)
        env.update(extra)
        for key in unset:
            env.pop(key, None)
        return subprocess.run(
            [BASH, str(TOOL / f"{name}.sh"), *args],
            env=env, cwd=str(self.root), capture_output=True, text=True, encoding="utf-8", timeout=60,
        )

    def ok(self, name, *args, **extra):
        r = self.run_tool(name, "--yes", *args, **extra)
        self.assertEqual(r.returncode, 0, f"{name}\n{r.stdout}\n{r.stderr}")
        return r

    def snapshot(self):
        out = {}
        for p in sorted(self.root.rglob("*")):
            rel = p.relative_to(self.root)
            if rel.parts[0] == "log":
                continue
            out[str(rel)] = p.read_bytes() if p.is_file() else "dir"
        return out

    def backups_list(self):
        return sorted(p for p in self.backups.iterdir() if p.is_dir()) if self.backups.exists() else []

    def replaced_list(self):
        return sorted(self.apps.glob(APP_NAME + ".cle-replaced-*"))

    def logged(self, tool):
        p = self.log / f"{tool}.log"
        return p.read_text().splitlines() if p.exists() else []

    def plist(self, label, text):
        (self.agents / f"{label}.plist").write_text(text)

    def manifest(self, backup):
        lines = (backup / "manifest.txt").read_text().splitlines()
        return dict(line.split("=", 1) for line in lines)

    # ---- 门禁：不带 --yes 只列计划 ----

    def test_without_yes_plans_only_and_touches_nothing(self):
        self.plist(WATCHDOG, "w1")
        before = self.snapshot()
        r = self.run_tool("backup-current")
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("[计划]", r.stdout)
        self.assertIn("没带 --yes", r.stdout)
        self.assertEqual(self.snapshot(), before)

        self.ok("backup-current")
        before = self.snapshot()
        for name in ("install-cle", "restore"):
            r = self.run_tool(name)
            self.assertEqual(r.returncode, 2, f"{name}\n{r.stdout}\n{r.stderr}")
            self.assertIn("[计划]", r.stdout)
            self.assertNotIn("[执行]", r.stdout)
            self.assertEqual(self.snapshot(), before, name)
        self.assertEqual(self.logged("launchctl"), [])
        self.assertEqual(self.logged("codesign"), [])
        self.assertEqual(channel_of(self.app), "release")

    def test_usage_errors_exit_64(self):
        for name, args in (("backup-current", ["--bogus"]), ("install-cle", ["--backup", "x"]),
                           ("restore", ["--backup"]), ("restore", ["--backup", "../x"])):
            r = self.run_tool(name, *args)
            self.assertEqual(r.returncode, 64, f"{name} {args}\n{r.stderr}")
            self.assertIn("用法", r.stderr)

    # ---- 正例：备份 → 安装 → 还原 ----

    def test_full_cycle_backup_install_restore(self):
        self.plist(WATCHDOG, "w1")
        self.plist(GATEWAY, "g1")
        self.plist(TTS, "t1")
        self.plist(UNMANAGED, "x1")
        self.ok("backup-current")
        [backup] = self.backups_list()
        self.assertFalse(list(self.backups.glob("*.partial")))
        m = self.manifest(backup)
        self.assertEqual(m["app"], str(self.app))
        self.assertEqual(m["app.present"], "1")
        self.assertEqual(m["app.channel"], "release")
        self.assertEqual(m["app.version"], "2.5.54")
        self.assertEqual(
            tuple(m[f"plist.{label}"] for label in (WATCHDOG, TTS, REAPPLY, URPROXY, GATEWAY)),
            ("1", "1", "0", "0", "1"))
        self.assertNotIn(f"plist.{UNMANAGED}", m)
        self.assertFalse((backup / "LaunchAgents" / f"{UNMANAGED}.plist").exists())
        self.assertEqual(channel_of(backup / APP_NAME), "release")
        self.assertEqual((backup / "LaunchAgents" / f"{GATEWAY}.plist").read_text(), "g1")

        self.ok("install-cle")
        self.assertEqual(channel_of(self.app), "cle")
        [replaced] = self.replaced_list()
        self.assertEqual(channel_of(replaced), "release")
        self.assertFalse((self.apps / f".{APP_NAME}.cle-staging").exists())
        self.assertEqual(self.logged("codesign"), [f"--verify --deep {self.pkg}"])
        rows = (backup / "installs.tsv").read_text().splitlines()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].split("\t")[1], str(replaced))

        self.plist(GATEWAY, "g2")
        self.plist(URPROXY, "u1")
        r = self.ok("restore")
        self.assertIn("改名回", r.stdout)
        self.assertIn(f"跳过 {WATCHDOG}.plist：和备份一样", r.stdout)
        self.assertEqual(channel_of(self.app), "release")
        self.assertEqual(self.replaced_list(), [])
        [after] = sorted((backup / "after-install").iterdir())
        self.assertEqual(channel_of(after / "app"), "cle")
        self.assertTrue((after / "restore.txt").exists())
        self.assertEqual((self.agents / f"{WATCHDOG}.plist").read_text(), "w1")
        self.assertEqual((self.agents / f"{GATEWAY}.plist").read_text(), "g1")
        self.assertFalse((self.agents / f"{URPROXY}.plist").exists())
        self.assertEqual((after / "LaunchAgents" / f"{GATEWAY}.plist").read_text(), "g2")
        self.assertEqual((after / "LaunchAgents" / f"{URPROXY}.plist").read_text(), "u1")
        calls = self.logged("launchctl")
        self.assertIn(f"bootout {self.domain}/{GATEWAY}", calls)
        self.assertIn(f"bootstrap {self.domain} {self.agents}/{GATEWAY}.plist", calls)
        self.assertIn(f"bootout {self.domain}/{URPROXY}", calls)
        self.assertFalse([c for c in calls if WATCHDOG in c])
        self.assertIn(f"跳过 {TTS}.plist：和备份一样", r.stdout)
        self.assertIn(f"跳过 {REAPPLY}.plist：备份里和现在都没有", r.stdout)
        self.assertEqual((self.agents / f"{UNMANAGED}.plist").read_text(), "x1")
        self.assertFalse([c for c in calls if UNMANAGED in c])

    def test_cle_labels_replaces_defaults(self):
        self.plist(WATCHDOG, "w1")
        self.plist(UNMANAGED, "x1")
        self.ok("backup-current", CLE_LABELS=f" {UNMANAGED}\t")
        [backup] = self.backups_list()
        m = self.manifest(backup)
        self.assertEqual(m[f"plist.{UNMANAGED}"], "1")
        self.assertNotIn(f"plist.{WATCHDOG}", m)
        self.assertEqual((backup / "LaunchAgents" / f"{UNMANAGED}.plist").read_text(), "x1")
        self.assertFalse((backup / "LaunchAgents" / f"{WATCHDOG}.plist").exists())

    def test_restore_copies_back_when_replaced_app_is_gone(self):
        self.ok("backup-current")
        self.ok("install-cle")
        shutil.rmtree(self.replaced_list()[0])
        r = self.ok("restore")
        self.assertIn("从备份拷回", r.stdout)
        self.assertEqual(channel_of(self.app), "release")
        self.assertFalse(list(self.apps.glob("*.cle-restoring")) + list(self.apps.glob(".*.cle-restoring")))

    def test_second_install_leftover_is_moved_aside(self):
        self.ok("backup-current")
        self.ok("install-cle")
        make_app(self.pkg, "3.0.1", "cle")
        self.ok("install-cle")
        self.assertEqual(version_of(self.app), "3.0.1")
        self.assertEqual(len(self.replaced_list()), 2)
        self.ok("restore")
        self.assertEqual(channel_of(self.app), "release")
        self.assertEqual(self.replaced_list(), [])
        [backup] = self.backups_list()
        [after] = sorted((backup / "after-install").iterdir())
        self.assertEqual(version_of(after / "app"), "3.0.1")
        self.assertEqual(version_of(after / "replaced-1"), "3.0.0")

    def test_backup_without_app_then_restore_removes_installed(self):
        shutil.rmtree(self.app)
        r = self.ok("backup-current")
        self.assertIn("不存在，只记录状态", r.stdout)
        [backup] = self.backups_list()
        self.assertEqual(self.manifest(backup)["app.present"], "0")
        self.ok("install-cle")
        self.assertEqual(channel_of(self.app), "cle")
        self.assertEqual(self.replaced_list(), [])
        self.assertEqual((backup / "installs.tsv").read_text().split("\t")[1], "-")
        self.ok("restore")
        self.assertFalse(self.app.exists())
        [after] = sorted((backup / "after-install").iterdir())
        self.assertEqual(channel_of(after / "app"), "cle")

    def test_named_backup_and_incomplete_ones_ignored(self):
        self.ok("backup-current")
        make_app(self.app, "2.6.0", "release")
        self.ok("backup-current")
        first, second = self.backups_list()
        partial = self.backups / "zzzz.partial"
        partial.mkdir()
        (partial / "manifest.txt").write_text(f"app={self.app}\napp.present=0\n")
        other = self.backups / "zzzz-other"
        other.mkdir()
        (other / "manifest.txt").write_text("app=/elsewhere/超級碧琪.app\napp.present=0\n")
        self.ok("install-cle")
        self.assertTrue((second / "installs.tsv").exists())
        self.assertFalse((first / "installs.tsv").exists())
        self.ok("restore", "--backup", first.name)
        self.assertEqual(version_of(self.app), "2.5.54")
        r = self.run_tool("restore", "--yes", "--backup", partial.name)
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertEqual(version_of(self.app), "2.5.54")

    # ---- 反例：拒装、失败时不动现状 ----

    def test_install_refuses_wrong_channel_unless_expected(self):
        self.ok("backup-current")
        make_app(self.pkg, "2.5.54", "dev")
        r = self.run_tool("install-cle", "--yes")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("channel 是 'dev'，不是 'cle'", r.stderr)
        self.assertEqual(channel_of(self.app), "release")
        self.assertEqual(self.replaced_list(), [])
        self.assertEqual(self.logged("codesign"), [])
        r = self.run_tool("install-cle")
        self.assertEqual(r.returncode, 2)
        self.assertIn("[会失败]", r.stdout)
        self.ok("install-cle", CLE_EXPECT_CHANNEL="dev")
        self.assertEqual(channel_of(self.app), "dev")

    def test_install_needs_complete_backup(self):
        r = self.run_tool("install-cle", "--yes")
        self.assertEqual(r.returncode, 1)
        self.assertIn("先跑 backup-current.sh", r.stderr)
        self.ok("backup-current")
        [backup] = self.backups_list()
        shutil.rmtree(backup / APP_NAME)
        r = self.run_tool("install-cle", "--yes")
        self.assertEqual(r.returncode, 1)
        self.assertIn("不完整", r.stderr)
        self.assertEqual(channel_of(self.app), "release")

    def test_codesign_failure_keeps_old_app(self):
        self.ok("backup-current")
        r = self.run_tool("install-cle", "--yes", FAKE_CODESIGN_FAIL="1")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(channel_of(self.app), "release")
        self.assertEqual(self.replaced_list(), [])

    def test_running_app_blocks_every_command(self):
        self.ok("backup-current")
        before = self.snapshot()
        for name in SCRIPTS:
            r = self.run_tool(name, "--yes", FAKE_PGREP_HIT="1")
            self.assertEqual(r.returncode, 1, f"{name}\n{r.stdout}\n{r.stderr}")
            self.assertIn("正在运行", r.stderr)
            r = self.run_tool(name, FAKE_PGREP_HIT="1")
            self.assertEqual(r.returncode, 2, name)
            self.assertIn("[会失败]", r.stdout)
        self.assertEqual(self.snapshot(), before)
        self.assertIn(f"-f {self.app}/Contents/MacOS/", self.logged("pgrep"))

    def test_rollback_paths_refused(self):
        bad = self.root / "x.Rollback-20261126"
        before = self.snapshot()
        cases = [("backup-current", {"CLE_APP_DIR": str(bad / "Applications")}),
                 ("backup-current", {"CLE_BACKUP_DIR": str(bad / "backups")}),
                 ("restore", {"CLE_AGENTS_DIR": str(bad)}),
                 ("install-cle", {"CLE_PKG": str(bad / APP_NAME)})]
        for name, extra in cases:
            r = self.run_tool(name, "--yes", **extra)
            self.assertEqual(r.returncode, 3, f"{name} {extra}\n{r.stderr}")
            self.assertIn("rollback", r.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_iso_refuses_real_system_tools(self):
        for var, real in (("CLE_LAUNCHCTL", "launchctl"), ("CLE_PGREP", "pgrep"), ("CLE_CODESIGN", "codesign")):
            for name in SCRIPTS:
                for value in (real, f"/usr/bin/{real}"):
                    r = self.run_tool(name, "--yes", **{var: value})
                    self.assertEqual(r.returncode, 3, f"{name} {var}={value}\n{r.stderr}")
                    self.assertIn("不能用真的", r.stderr)
                r = self.run_tool(name, "--yes", unset=(var,))
                self.assertEqual(r.returncode, 3, f"{name} 不设 {var}")
        self.assertEqual(self.logged("ditto"), [])

    def test_iso_refuses_paths_outside_and_overlaps(self):
        outside = self.root.parent / (self.root.name + "-outside")
        for extra in ({"CLE_APP_DIR": "/Applications"}, {"CLE_AGENTS_DIR": str(outside)},
                      {"CLE_BACKUP_DIR": str(self.root / "x" / ".." / ".." / "elsewhere")}):
            r = self.run_tool("backup-current", "--yes", **extra)
            self.assertEqual(r.returncode, 3, f"{extra}\n{r.stderr}")
            self.assertIn("不在", r.stderr)
        r = self.run_tool("backup-current", "--yes", CLE_BACKUP_DIR=str(self.app / "backups"))
        self.assertEqual(r.returncode, 3)
        self.assertIn("互相包含", r.stderr)
        r = self.run_tool("install-cle", "--yes", CLE_PKG=str(self.app))
        self.assertEqual(r.returncode, 3)
        r = self.run_tool("backup-current", "--yes", CLE_LABELS="ok.label ../evil")
        self.assertEqual(r.returncode, 3)
        self.assertFalse(outside.exists())
        self.assertEqual(self.backups_list(), [])


class ClePkgMacStaticTest(unittest.TestCase):
    def test_no_local_paths_or_secrets_hardcoded(self):
        for f in sorted(TOOL.glob("*.sh")):
            text = f.read_text(encoding="utf-8")
            for needle in ("/Users/", "pinkie-mac", "/.openclaw", "18789", "token"):
                self.assertNotIn(needle, text, f"{f.name} 含 {needle}")

    def test_entry_scripts_are_strict_and_gated(self):
        for name in SCRIPTS:
            text = (TOOL / f"{name}.sh").read_text(encoding="utf-8")
            self.assertIn("set -euo pipefail", text)
            self.assertIn(f"cle_main {name} \"$@\"", text)
            self.assertNotIn("rm -rf \"$APP\"", text)


if __name__ == "__main__":
    unittest.main()
