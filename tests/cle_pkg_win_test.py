"""tools/cle-pkg-win 三件套：全部在临时目录里跑，计划任务换成假 schtasks，注册表换成 JSON 文件。

真装的 App、真配置、真计划任务、真 HKCU 都不碰：子进程的 LOCALAPPDATA / USERPROFILE / HOME 也指到临时目录，
CLE_ISO_ROOT 打开隔离检查，假 schtasks 没拿到数据库路径就直接拒绝。
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "cle-pkg-win"

FAKE_SCHTASKS = r'''
import json, os, sys
db = os.environ.get("FAKE_SCHTASKS_DB")
log_path = os.environ.get("FAKE_SCHTASKS_LOG")
if not db or not log_path:
    sys.stderr.write("fake schtasks: no FAKE_SCHTASKS_DB, refusing\n")
    sys.exit(97)
args = sys.argv[1:]
with open(log_path, "a", encoding="utf-8") as log:
    log.write(" ".join(args) + "\n")
tasks = json.load(open(db, encoding="utf-8")) if os.path.exists(db) else {}
def opt(name):
    return args[args.index(name) + 1] if name in args else None
def save():
    json.dump(tasks, open(db, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
verb = args[0] if args else ""
tn = opt("/TN")
if verb == "/Query" and tn is None:
    out = "".join('"\\%s","N/A","Ready"\r\n' % name for name in tasks)
    sys.stdout.buffer.write(out.encode("utf-8"))
elif verb == "/Query":
    if tn not in tasks:
        sys.stderr.write("ERROR: The system cannot find the file specified.\n"); sys.exit(1)
    sys.stdout.buffer.write(tasks[tn]["xml"].encode("utf-16"))
elif verb == "/End":
    if tn not in tasks: sys.exit(1)
    tasks[tn]["ended"] = tasks[tn].get("ended", 0) + 1; save()
elif verb == "/Delete":
    if tn not in tasks: sys.exit(1)
    del tasks[tn]; save()
elif verb == "/Create":
    data = open(opt("/XML"), "rb").read()
    assert data[:2] == b"\xff\xfe", "schtasks /XML wants UTF-16 with BOM"
    tasks[tn] = {"xml": data.decode("utf-16")}; save()
else:
    sys.exit(2)
'''


def task_xml(command):
    return (
        '<?xml version="1.0" encoding="UTF-16"?>\r\n'
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
        f'  <Actions Context="Author"><Exec><Command>{command}</Command></Exec></Actions>\r\n'
        "</Task>\r\n"
    )


def make_app(root, channel, marker):
    (root / "_internal").mkdir(parents=True)
    (root / "_internal" / "build-info.json").write_text(
        json.dumps({"guard": channel == "release", "channel": channel, "version": "2.5.54", "commit": "cd5957f0"}),
        encoding="utf-8")
    (root / "超級碧琪.exe").write_bytes(b"MZ" + marker.encode())
    deep = root / "_internal" / "runtime" / "node_modules" / "openclaw" / "dist" / "control-ui" / "assets"
    deep.mkdir(parents=True)
    (deep / "index.js").write_text(f"// {marker}\n", encoding="utf-8")


def tree(root):
    """路径 → 内容，用来证明「没带 --yes 什么都没动」。"""
    out = {}
    for path in sorted(Path(root).rglob("*")):
        rel = path.relative_to(root).as_posix()
        out[rel] = path.read_bytes() if path.is_file() else None
    return out


class ClePkgWinTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cle-pkg-win 张 三-"))  # 中文 + 空格路径
        self.iso = self.root / "iso"
        self.local = self.iso / "AppData" / "Local"
        self.app = self.local / "Programs" / "SuperPinkie"
        self.config = self.iso / "home" / ".openclaw"
        self.backups = self.local / "SuperPinkie-cle-pkg" / "backups"
        self.reg = self.iso / "registry.json"
        self.db = self.iso / "schtasks.json"
        self.log = self.root / "schtasks.log"
        self.pkg = self.root / "out" / "超級碧琪"
        self.local.mkdir(parents=True)
        self.config.mkdir(parents=True)
        fake = self.root / "fake_schtasks.py"
        fake.write_text(FAKE_SCHTASKS, encoding="utf-8")
        make_app(self.pkg, "cle", "NEW-CLE")
        self.env = {
            "PATH": os.environ.get("PATH", ""),
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
            "LOCALAPPDATA": str(self.local),
            "USERPROFILE": str(self.iso / "home"),
            "HOME": str(self.iso / "home"),
            "CLE_ISO_ROOT": str(self.iso),
            "CLE_APP_DIR": str(self.app),
            "CLE_CONFIG_DIR": str(self.config),
            "CLE_BACKUP_DIR": str(self.backups),
            "CLE_PKG": str(self.pkg),
            "CLE_SCHTASKS": str(fake),
            "CLE_REG_FILE": str(self.reg),
            "FAKE_SCHTASKS_DB": str(self.db),
            "FAKE_SCHTASKS_LOG": str(self.log),
        }

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def run_tool(self, command, *args, env=None):
        result = subprocess.run(
            [sys.executable, "-I", "-X", "utf8", str(TOOL / f"{command}.py"), *args],
            env=env or self.env, capture_output=True, timeout=120)
        return result.returncode, result.stdout.decode("utf-8", "replace") + result.stderr.decode("utf-8", "replace")

    def calls(self):
        return self.log.read_text(encoding="utf-8") if self.log.exists() else ""

    def tasks(self):
        return json.loads(self.db.read_text(encoding="utf-8")) if self.db.exists() else {}

    def set_tasks(self, data):
        self.db.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def registry(self):
        return json.loads(self.reg.read_text(encoding="utf-8")) if self.reg.exists() else {}

    def set_registry(self, data):
        self.reg.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def channel(self):
        return json.loads((self.app / "_internal" / "build-info.json").read_text(encoding="utf-8"))["channel"]

    def only_backup(self):
        folders = [p for p in self.backups.iterdir() if p.is_dir()]
        self.assertEqual(len(folders), 1, folders)
        return folders[0]

    def assert_ok(self, command, *args):
        rc, out = self.run_tool(command, "--yes", *args)
        self.assertEqual(rc, 0, out)
        return out

    def seed_old_install(self):
        make_app(self.app, "release", "OLD-APP")
        (self.config / "openclaw.json").write_text('{"gateway": {"port": 18789}}\n', encoding="utf-8")
        self.set_tasks({"SuperPinkieGatewayWatchdog": {"xml": task_xml("old-watchdog.ps1")}})
        self.set_registry({"Run": {"SuperPinkieGatewayWatchdog": [1, "powershell old-watchdog"],
                                   "OneDrive": [1, "onedrive.exe"]}})

    # ── 不带 --yes 只打印 ──

    def test_without_yes_every_command_only_prints_and_changes_nothing(self):
        self.seed_old_install()
        self.assert_ok("backup-current")
        before = tree(self.iso)
        for command in ("backup-current", "install-cle", "restore"):
            rc, out = self.run_tool(command)
            self.assertEqual(rc, 2, out)
            self.assertIn("[计划]", out)
            self.assertNotIn("[执行]", out)
            self.assertIn("什么都没动", out)
        self.assertEqual(tree(self.iso), before)
        for verb in ("/End", "/Delete", "/Create"):
            self.assertNotIn(verb, self.calls())

    def test_install_without_backup_refuses_and_leaves_app(self):
        self.seed_old_install()
        rc, out = self.run_tool("install-cle", "--yes")
        self.assertEqual(rc, 1, out)
        self.assertIn("先跑 backup-current", out)
        self.assertEqual(self.channel(), "release")

    def test_install_refuses_a_package_that_is_not_channel_cle(self):
        self.seed_old_install()
        self.assert_ok("backup-current")
        shutil.rmtree(self.pkg)
        make_app(self.pkg, "dev", "DEV")
        rc, out = self.run_tool("install-cle", "--yes")
        self.assertEqual(rc, 1, out)
        self.assertIn("不是 'cle'", out)
        self.assertEqual(self.channel(), "release")
        self.assertFalse(self.app.with_name("SuperPinkie.cle-staging").exists())

    @unittest.skipUnless(os.name == "nt", "只有 Windows 会因为目录里有打开的文件拒绝改名")
    def test_locked_app_fails_before_stopping_tasks_or_unpacking(self):
        self.seed_old_install()
        self.assert_ok("backup-current")
        held = open(self.app / "_internal" / "build-info.json", "rb")  # 模拟 App 还在跑
        try:
            rc, out = self.run_tool("install-cle", "--yes")
        finally:
            held.close()
        self.assertEqual(rc, 1, out)
        self.assertIn("挪不动", out)
        self.assertEqual(self.channel(), "release")
        self.assertEqual(sorted(p.name for p in self.app.parent.iterdir()), ["SuperPinkie"])  # 没有 staging / probe 残留
        for verb in ("/End", "/Delete", "/Create"):
            self.assertNotIn(verb, self.calls())

    # ── A：原来没装 App ──

    def test_no_app_before_backup_install_restore_moves_new_app_aside(self):
        self.assert_ok("backup-current")
        manifest = json.loads((self.only_backup() / "manifest.json").read_text(encoding="utf-8"))
        self.assertFalse(manifest["app_present"])
        self.assertEqual(manifest["app_dir"], str(self.app))

        self.assert_ok("install-cle")
        self.assertEqual(self.channel(), "cle")
        self.assertFalse(self.app.with_name("SuperPinkie.cle-staging").exists())

        # 装完以后才出现的计划任务和启动项
        self.set_tasks({"SuperPinkieGatewayWatchdog": {"xml": task_xml("new-watchdog.ps1")}})
        self.set_registry({"Run": {"SuperPinkieGatewayWatchdog": [1, "powershell new-watchdog"]}})
        self.assert_ok("restore")

        self.assertFalse(self.app.exists())
        after = next((self.only_backup() / "after-install").iterdir())
        self.assertIn("NEW-CLE", (after / "app" / "超級碧琪.exe").read_bytes().decode())
        self.assertEqual(self.tasks(), {})
        saved_task = (after / "tasks" / "SuperPinkieGatewayWatchdog.xml").read_bytes().decode("utf-16")
        self.assertIn("new-watchdog.ps1", saved_task)
        self.assertEqual(self.registry().get("Run"), {})
        moved = json.loads((after / "registry.json").read_text(encoding="utf-8"))
        self.assertEqual(moved[0]["value"], "powershell new-watchdog")

    # ── B：原来有旧 App + 旧计划任务 + 旧启动项 + 配置 ──

    def test_old_install_comes_back_exactly_after_install_and_changes(self):
        self.seed_old_install()
        self.assert_ok("backup-current")
        backup = self.only_backup()
        manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["app_present"])
        self.assertEqual(manifest["app_build_info"]["channel"], "release")
        self.assertEqual(manifest["config_files"], ["openclaw.json"])
        self.assertEqual([(i["key"], i["name"]) for i in manifest["registry"]], [("Run", "SuperPinkieGatewayWatchdog")])
        self.assertIsNone(manifest["tasks"]["OpenClawGatewayWatchdog"])

        out = self.assert_ok("install-cle")
        self.assertEqual(self.channel(), "cle")
        self.assertIn("NEW-CLE", (self.app / "超級碧琪.exe").read_bytes().decode())
        self.assertEqual(self.tasks()["SuperPinkieGatewayWatchdog"].get("ended"), 1, out)
        replaced = [p for p in self.app.parent.iterdir() if ".cle-replaced-" in p.name]
        self.assertEqual(len(replaced), 1)  # 旧 App 改名留着，没删

        # 新版跑起来以后改了配置、改了任务、加了任务、改了启动项、加了 RunOnce
        (self.config / "openclaw.json").write_text('{"gateway": {"port": 1}}\n', encoding="utf-8")
        (self.config / "cle-only.json").write_text("{}\n", encoding="utf-8")
        self.set_tasks({"SuperPinkieGatewayWatchdog": {"xml": task_xml("cle-watchdog.ps1")},
                        "OpenClawGatewayWatchdog": {"xml": task_xml("extra.ps1")}})
        self.set_registry({"Run": {"SuperPinkieGatewayWatchdog": [1, "powershell cle"], "OneDrive": [1, "onedrive.exe"]},
                           "RunOnce": {"SuperPinkieRestore-abcd1234": [1, "restore.ps1"]}})
        self.assert_ok("restore")

        self.assertEqual(self.channel(), "release")
        self.assertIn("OLD-APP", (self.app / "超級碧琪.exe").read_bytes().decode())
        self.assertFalse([p for p in self.app.parent.iterdir() if ".cle-" in p.name])
        self.assertEqual((self.config / "openclaw.json").read_text(encoding="utf-8"), '{"gateway": {"port": 18789}}\n')
        self.assertFalse((self.config / "cle-only.json").exists())
        tasks = self.tasks()
        self.assertEqual(sorted(tasks), ["SuperPinkieGatewayWatchdog"])
        self.assertIn("old-watchdog.ps1", tasks["SuperPinkieGatewayWatchdog"]["xml"])
        self.assertEqual(self.registry(), {"Run": {"SuperPinkieGatewayWatchdog": [1, "powershell old-watchdog"],
                                                   "OneDrive": [1, "onedrive.exe"]}, "RunOnce": {}})
        after = next((backup / "after-install").iterdir())
        self.assertIn("NEW-CLE", (after / "app" / "超級碧琪.exe").read_bytes().decode())
        self.assertTrue((after / "config" / "cle-only.json").is_file())
        self.assertTrue((after / "tasks" / "OpenClawGatewayWatchdog.xml").is_file())

    def test_restore_skips_what_did_not_change_and_installs_from_a_zip(self):
        self.seed_old_install()
        self.assert_ok("backup-current")
        archive = self.root / "out" / "super-pinkie-windows-cle.zip"
        with zipfile.ZipFile(archive, "w") as z:
            for path in self.pkg.rglob("*"):
                if path.is_file():
                    z.write(path, "超級碧琪/" + path.relative_to(self.pkg).as_posix())
        self.assert_ok("install-cle", "--pkg", str(archive))
        self.assertEqual(self.channel(), "cle")
        out = self.assert_ok("restore")
        self.assertIn("跳过配置 openclaw.json", out)
        self.assertIn("跳过计划任务 SuperPinkieGatewayWatchdog", out)
        self.assertIn("跳过注册表 Run/SuperPinkieGatewayWatchdog", out)
        self.assertNotIn("/Delete", self.calls())
        self.assertEqual(self.channel(), "release")

    def test_unfinished_backup_is_ignored(self):
        self.seed_old_install()
        (self.backups / "20990101-000000.partial").mkdir(parents=True)
        rc, out = self.run_tool("install-cle", "--yes")
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.channel(), "release")

    # ── 安全检查 ──

    def test_isolation_mode_refuses_paths_outside_the_iso_root(self):
        env = dict(self.env, CLE_APP_DIR=str(self.root / "elsewhere" / "Programs" / "SuperPinkie"))
        rc, out = self.run_tool("backup-current", "--yes", env=env)
        self.assertEqual(rc, 3, out)
        self.assertIn("不在", out)
        self.assertFalse(self.backups.exists())

    def test_isolation_mode_refuses_the_real_schtasks(self):
        env = dict(self.env, CLE_SCHTASKS="schtasks.exe")
        rc, out = self.run_tool("restore", env=env)
        self.assertEqual(rc, 3, out)
        self.assertEqual(self.calls(), "")

    def test_isolation_mode_refuses_the_real_registry(self):
        env = dict(self.env)
        del env["CLE_REG_FILE"]
        rc, out = self.run_tool("backup-current", env=env)
        self.assertEqual(rc, 3, out)

    def test_rollback_directory_is_never_touched(self):
        rollback = self.local / "Programs" / "SuperPinkie.rollback-v2.5.27-20261120-191948"
        make_app(rollback, "release", "ROLLBACK")
        before = tree(rollback)
        for command in ("backup-current", "install-cle", "restore"):
            rc, out = self.run_tool(command, "--yes", "--app-dir", str(rollback))
            self.assertEqual(rc, 3, out)
            self.assertIn("rollback", out)
        self.assertEqual(tree(rollback), before)
        self.assertEqual(self.calls(), "")

    def test_registry_root_outside_hkcu_is_refused(self):
        env = dict(self.env)
        del env["CLE_REG_FILE"], env["CLE_ISO_ROOT"]
        env["CLE_REG_ROOT"] = "HKLM/Software/Microsoft/Windows/CurrentVersion"
        rc, out = self.run_tool("backup-current", env=env)
        self.assertEqual(rc, 3, out)


if __name__ == "__main__":
    unittest.main()
