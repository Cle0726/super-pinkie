"""碧琪口吻的更新说明：文件格式、发版检查、两端读法一致。"""
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))
import release_notes  # noqa: E402

SAMPLE = """## 2.6.0

碧琪学会了一件新本事，回话也更快啦。

- 第一件，**加粗**会去掉。
- 第二件
  - 小一点的事

<!-- pinkie-notes-end -->

## 2.5.9

碧琪以前的话。

- 旧的
"""


class ReleaseNotesTest(unittest.TestCase):
    def test_parse_current_section_only(self):
        parts = release_notes.parse(SAMPLE)
        self.assertEqual("2.6.0", parts["version"])
        self.assertEqual("碧琪学会了一件新本事，回话也更快啦。", parts["summary"])
        self.assertEqual(["第一件，加粗会去掉。", "第二件", "小一点的事"], parts["details"])
        self.assertEqual("碧琪以前的话。", release_notes.parse(SAMPLE, "2.5.9")["summary"])

    def test_github_body_and_old_style_bodies(self):
        body = release_notes.section_markdown(SAMPLE, "2.6.0")
        self.assertNotIn("2.5.9", body)
        self.assertEqual(release_notes.parse(SAMPLE), {**release_notes.parse(body)})
        legacy = release_notes.parse("- 图标换成清晰的新图。\n\n**Full Changelog**: x")
        self.assertEqual(("", ["图标换成清晰的新图。"]), (legacy["summary"], legacy["details"]))

    def test_lint_blocks_jargon_missing_summary_and_wrong_version(self):
        self.assertEqual([], release_notes.lint(SAMPLE, "v2.6.0"))
        self.assertTrue(release_notes.lint(SAMPLE, "2.6.1"))
        self.assertTrue(release_notes.lint("## 2.6.0\n\n- 只有细节\n", "2.6.0"))
        self.assertTrue(release_notes.lint("## 2.6.0\n\n新版本发布。\n", "2.6.0"))
        for jargon in ("修好 `x`", "修好 workboard_list", "改了 app/a.py", "修了网关", "合并 PR"):
            self.assertTrue(release_notes.lint(f"## 2.6.0\n\n碧琪{jargon}。\n", "2.6.0"), jargon)
        many = "## 2.6.0\n\n碧琪变了。\n\n" + "".join(f"- 第{i}件\n" for i in range(release_notes.DETAILS_MAX + 1))
        self.assertTrue(release_notes.lint(many, "2.6.0"))

    def test_shipped_notes_are_ready_for_this_version(self):
        version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
        result = subprocess.run([sys.executable, str(ROOT / "tools/release/release_notes.py"), "check", version],
                                capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        parts = release_notes.parse((ROOT / "desktop/windows/release-notes.md").read_text(encoding="utf-8"), version)
        self.assertIn("碧琪", parts["summary"])
        self.assertGreater(len(parts["details"]), 2)  # 2.5.48 的样例：多条细节，界面要收起来

    def test_windows_and_mac_read_the_same_parts(self):
        import importlib.util
        import windows_desktop
        spec = importlib.util.spec_from_file_location("stage", ROOT / "installer/macos/stage-git-update.py")
        stage = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(stage)
        win = windows_desktop.release_notes_parts(SAMPLE)
        mac = stage.note_parts(SAMPLE)
        self.assertEqual(win["summary"], mac["summary"])
        self.assertEqual(win["details"], mac["details"])
        self.assertEqual(release_notes.as_text(win), windows_desktop.release_notes_text(SAMPLE))


if __name__ == "__main__":
    unittest.main()
