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
        return r, report.read_text()

    def test_full_cycle_is_green(self):
        r, text = self.run_acceptance()
        self.assertEqual(r.returncode, 0, text[-3000:])
        self.assertIn("结果：**通过**", text)
        for title in ("install-full.sh", "install 后第 1 次冒烟", "update 后第 2 次冒烟", "uninstall-full.sh"):
            self.assertIn(title, text)

    def test_break_turns_first_smoke_red(self):
        r, text = self.run_acceptance("--break", "remove-installed-file")
        self.assertNotEqual(r.returncode, 0, text[-3000:])
        self.assertIn("结果：**失败**", text)
        self.assertIn("第一个失败：install 后第 1 次冒烟 → prompts 已复制", text)
        self.assertIn("临时根已删除", text)


if __name__ == "__main__":
    unittest.main()
