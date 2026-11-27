import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUN = REPO / "tools/acceptance/mac/run.py"

spec = importlib.util.spec_from_file_location("acceptance_mac_run", RUN)
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)

OPENCLAW_SRC = os.environ.get("PINKIE_ACCEPT_OPENCLAW_SRC", run.DEFAULT_OPENCLAW_SRC)


def e2e_skip_reason():
    # 整套要真装一遍（几分钟，还会在 LaunchServices 里登记再注销临时 App），默认不跟着 unittest discover 跑
    if os.environ.get("PINKIE_ACCEPT_MAC") != "1":
        return "设 PINKIE_ACCEPT_MAC=1 才跑 Mac 一键验收"
    if sys.platform != "darwin":
        return "只在 macOS 上跑"
    if not shutil.which("xcrun"):
        return "缺 xcrun"
    if not os.path.isfile(os.path.join(OPENCLAW_SRC, "package.json")):
        return "缺干净的 OpenClaw 包：" + OPENCLAW_SRC
    return None


class ReportTest(unittest.TestCase):
    def test_report_names_first_failed_step_and_check(self):
        steps = [
            {"key": "install", "title": "install-full.sh", "start": "10:00:00", "secs": 1.0, "rc": 0,
             "checks": [], "tail": "", "ok": True},
            {"key": "smoke1", "title": "install 后第 1 次冒烟", "start": "10:00:01", "secs": 0.2, "rc": None,
             "checks": [("Bundle ID", True, ""), ("prompts 已复制", False, "缺或不一致：a.txt")], "tail": "", "ok": False},
        ]
        text = run.render_report(steps, {})
        self.assertIn("结果：**失败**", text)
        self.assertIn("第一个失败：install 后第 1 次冒烟 → prompts 已复制", text)
        self.assertIn("- [ ] prompts 已复制 — 缺或不一致：a.txt", text)

    def test_report_names_exit_code_when_no_check_failed(self):
        steps = [{"key": "update", "title": "update-full.sh", "start": "10:00:00", "secs": 1.0, "rc": 3,
                  "checks": [], "tail": "boom", "ok": False}]
        text = run.render_report(steps, {})
        self.assertIn("第一个失败：update-full.sh → 退出码 3", text)
        self.assertIn("boom", text)

    def test_report_all_green(self):
        steps = [{"key": "prepare", "title": "准备", "start": "10:00:00", "secs": 1.0, "rc": None,
                  "checks": [("垫片", True, "")], "tail": "", "ok": True}]
        text = run.render_report(steps, {})
        self.assertIn("结果：**通过**", text)
        self.assertNotIn("第一个失败", text)


@unittest.skipUnless(shutil.which("git") and (REPO / ".git").exists(), "不在 git 仓库里")
class RealPathRewriteTest(unittest.TestCase):
    def head_text(self, path):
        return subprocess.run(["git", "show", "HEAD:" + path], cwd=REPO, capture_output=True, text=True, check=True).stdout

    def test_rewrite_removes_every_real_path_from_entry_scripts(self):
        for path in run.REAL_PATH_REWRITES:
            text = self.head_text(path)
            out = run.rewrite_real_paths(path, text)
            for real in run.REAL_PATHS:
                self.assertNotIn(real, out, "%s 改写后还留着 %s" % (path, real))

    def test_rewrite_actually_has_something_to_rewrite(self):
        # 入口脚本若已不再写死这些路径，改写表就该跟着删，别留着假装在防
        hits = [real for path in run.REAL_PATH_REWRITES for real in run.REAL_PATHS if real in self.head_text(path)]
        self.assertTrue(hits)


class ProxyLogFingerprintTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="pinkie-fp-test-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.log = self.dir / "proxy.log"

    def test_append_only_passes(self):
        self.log.write_bytes(b"old line\n")
        before = run.file_fingerprint(str(self.log))
        with open(self.log, "ab") as f:
            f.write(b"proxy kept writing\n")
        ok, _ = run.log_untouched(before, run.file_fingerprint(str(self.log)))
        self.assertTrue(ok)

    def test_truncate_fails(self):
        self.log.write_bytes(b"old line\n")
        before = run.file_fingerprint(str(self.log))
        with open(self.log, "wb") as f:
            f.write(b"new")
        ok, detail = run.log_untouched(before, run.file_fingerprint(str(self.log)))
        self.assertFalse(ok, detail)

    def test_rewrite_back_same_bytes_still_fails_on_new_inode(self):
        self.log.write_bytes(b"old line\n")
        before = run.file_fingerprint(str(self.log))
        tmp = self.dir / "x"
        tmp.write_bytes(b"old line\n")
        os.replace(tmp, self.log)
        ok, detail = run.log_untouched(before, run.file_fingerprint(str(self.log)))
        self.assertFalse(ok, detail)

    def test_created_or_deleted_fails(self):
        self.assertFalse(run.log_untouched(None, (1, b""))[0])
        self.assertFalse(run.log_untouched((1, b"a"), None)[0])
        self.assertTrue(run.log_untouched(None, None)[0])


@unittest.skipIf(os.name == "nt" or not shutil.which("bash"), "需要 bash")
@unittest.skipIf(e2e_skip_reason() is not None, e2e_skip_reason() or "")
class AcceptanceMacTest(unittest.TestCase):
    def run_acceptance(self, *extra):
        out = Path(tempfile.mkdtemp(prefix="pinkie-accept-test-", dir="/private/tmp"))
        self.addCleanup(shutil.rmtree, out, True)
        report = out / "report.md"
        before = set(Path("/private/tmp").glob("pinkie-accept-*"))
        r = subprocess.run([sys.executable, str(RUN), "--report", str(report), *extra],
                           cwd=REPO, capture_output=True, text=True, timeout=3600)
        after = set(Path("/private/tmp").glob("pinkie-accept-*"))
        leftover = [p for p in after - before if p != out]
        self.assertEqual(leftover, [], "临时根没删干净")
        shim_copy = report.with_name(report.name + ".shim.log")
        self.assertTrue(shim_copy.is_file(), "垫片日志没留在报告旁边")
        text = report.read_text()
        self.assertIn(str(shim_copy), text)
        return r, text

    def assert_proxy_log_untouched(self, before):
        ok, detail = run.log_untouched(before, run.file_fingerprint(run.PROXY_LOG))
        self.assertTrue(ok, "正式代理日志被验收碰了：" + detail)

    def test_full_cycle_is_green(self):
        before = run.file_fingerprint(run.PROXY_LOG)
        r, text = self.run_acceptance()
        self.assert_proxy_log_untouched(before)
        self.assertEqual(r.returncode, 0, text[-3000:])
        self.assertIn("结果：**通过**", text)
        for title in ("install-full.sh", "install 后第 1 次冒烟", "update 后第 2 次冒烟", "uninstall-full.sh",
                      "没被改动（只读核对，不回写）", "真实 LaunchServices 里没有临时根下的 App"):
            self.assertIn(title, text)

    def test_keep_real_paths_refuses_to_run(self):
        before = run.file_fingerprint(run.PROXY_LOG)
        r, text = self.run_acceptance("--break", "keep-real-paths")
        self.assert_proxy_log_untouched(before)
        self.assertNotEqual(r.returncode, 0, text[-3000:])
        self.assertIn("拒绝开跑", text)
        self.assertNotIn("install 后第 1 次冒烟", text)
        self.assertIn("临时根已删除", text)

    def test_break_turns_first_smoke_red(self):
        r, text = self.run_acceptance("--break", "remove-installed-file")
        self.assertNotEqual(r.returncode, 0, text[-3000:])
        self.assertIn("结果：**失败**", text)
        self.assertIn("第一个失败：install 后第 1 次冒烟 → prompts 已复制", text)
        self.assertIn("临时根已删除", text)


if __name__ == "__main__":
    unittest.main()
