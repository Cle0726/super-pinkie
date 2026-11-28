"""app/windows_update_guard.py 热点复发测试（从 windows_desktop.py 拆出的更新元数据 / 设定保护）。

只锁现有测试抓不住的行为：windows_update_test.py、windows_update_metadata_test.py、
windows_guard_receipt_shape_test.py、guard_native_test.py、release_notes_test.py 已锁住的不重复。
每个测试类写明它锁的引入提交：只把那几行改回去，对应测试就会变红。
全部在 Linux 上跑：不起进程（guard.mjs / node 不会被调用）、不联网、不弹窗。
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import windows_update_guard as guard  # noqa: E402

VERSION, COMMIT, SHA = "2.5.99", "abc123", "ef" * 32


def _temp_dir(case):
    tmp = tempfile.TemporaryDirectory(prefix="pinkie-guard-hotspot-")
    case.addCleanup(tmp.cleanup)
    return Path(tmp.name)


class ReceiptIdentityMatchTest(unittest.TestCase):
    """b15ff741：保护回执只认同一个包——提交或清单 SHA 对不上就不算；
    回执里没写这一项（旧版回执）时不因此判不认识，免得误锁老用户。"""

    def setUp(self):
        root = _temp_dir(self)
        self.app_state, self.oc_dir = root / "state", root / ".openclaw"
        (self.app_state / "guard").mkdir(parents=True)
        self.oc_dir.mkdir()

    def has(self, **receipt):
        (self.oc_dir / "guard-receipt.json").write_text(
            json.dumps({"schema": 1, "version": VERSION, **receipt}), encoding="utf-8")
        return guard.has_guard_receipt(self.app_state, self.oc_dir, VERSION, COMMIT, SHA)

    def test_a_receipt_from_another_commit_or_manifest_is_not_ours(self):
        self.assertFalse(self.has(commit="other1", manifestSha=SHA))
        self.assertFalse(self.has(commit=COMMIT, manifestSha="00" * 32))

    def test_the_same_package_matches(self):
        self.assertTrue(self.has(commit=COMMIT, manifestSha=SHA))

    def test_an_older_receipt_without_commit_or_sha_still_matches(self):
        self.assertTrue(self.has())
        self.assertTrue(self.has(commit=COMMIT))

    def test_another_version_never_matches(self):
        (self.oc_dir / "guard-receipt.json").write_text(
            json.dumps({"schema": 1, "version": "2.5.98", "commit": COMMIT}), encoding="utf-8")
        self.assertFalse(guard.has_guard_receipt(self.app_state, self.oc_dir, VERSION, COMMIT, SHA))


class CounterReadRetryTest(unittest.TestCase):
    """b15ff741：计数器文件被安全软件 / 另一个进程短暂锁住（PermissionError）时稍等再读，
    最多 3 次；不能第一次读不到就当成被删，进而锁计数器、退出应用。"""

    def read_counter(self, failures):
        root = _temp_dir(self)
        app_state = root / "state"
        (app_state / "guard").mkdir(parents=True)
        reads, original = [], Path.read_text

        def read_text(path, *args, **kwargs):
            if path.name != "counter.json":
                return original(path, *args, **kwargs)
            reads.append(path)
            if len(reads) <= failures:
                raise PermissionError(13, "locked by another process")
            return "not json"

        with mock.patch.object(guard.Path, "read_text", autospec=True, side_effect=read_text), \
                mock.patch.object(guard.time, "sleep") as sleep:
            result = guard.verify_guard_counter(root, app_state)
        return result, len(reads), sleep.call_count

    def test_a_briefly_locked_counter_is_read_again(self):
        _, reads, sleeps = self.read_counter(failures=1)
        self.assertEqual((reads, sleeps), (2, 1), "第一次被锁就放弃，会把被锁当成被删")

    def test_it_gives_up_after_three_locked_reads(self):
        result, reads, _ = self.read_counter(failures=5)
        self.assertFalse(result)
        self.assertEqual(reads, 3)


class PendingAlertRepeatTest(unittest.TestCase):
    """b15ff741：同一条提醒只弹一次（seen_ids）；但「24 小时内次数到了要退出」那条即使见过也照弹照退。"""

    def setUp(self):
        root = _temp_dir(self)
        self.bundle, self.app_state = root / "bundle", root / "state"
        self.bundle.mkdir()
        (self.app_state / "guard").mkdir(parents=True)
        (self.bundle / "build-info.json").write_text(json.dumps({"guard": True, "version": VERSION}), encoding="utf-8")
        self.alert = self.app_state / "guard" / "pending-alert.json"

    def process(self, payload, seen):
        self.alert.write_text(json.dumps(payload), encoding="utf-8")
        shown = []
        result = guard.process_guard_alerts(
            self.bundle, app_state=self.app_state, openclaw_state=self.app_state / "oc", seen_ids=seen,
            presenter=lambda *args: shown.append(args), locker=lambda *_a: self.fail("没有被改的计数器不能上锁"),
            is_updating=lambda _dir: False)
        self.assertFalse(self.alert.exists(), "读过的提醒要删掉")
        return result, shown

    def test_a_seen_alert_is_not_shown_twice(self):
        seen = {"a1"}
        (should_exit, _), shown = self.process({"id": "a1", "categories": ["人格"], "count": 1}, seen)
        self.assertEqual((should_exit, shown), (False, []))

    def test_a_new_alert_is_shown_once_and_remembered(self):
        seen = set()
        (should_exit, _), shown = self.process({"id": "a2", "categories": ["人格"], "count": 1}, seen)
        self.assertFalse(should_exit)
        self.assertEqual(len(shown), 1)
        self.assertIn("a2", seen)

    def test_the_limit_alert_is_shown_and_exits_even_when_already_seen(self):
        (should_exit, _), shown = self.process({"id": "a3", "limitReached": True, "count": 3}, {"a3"})
        self.assertTrue(should_exit)
        self.assertEqual(len(shown), 1)
        self.assertIn("应用即将退出", shown[0][0])


class ReleaseNotesLimitsTest(unittest.TestCase):
    """9de89587：更新卡上的说明有长度上限——摘要 300 字、每条细节 240 字、最多 12 条、总量约 1600 字，
    写超了的发布说明不能把卡片撑出屏幕；包里没有 release-notes.md 时给空说明，不抛错。"""

    @staticmethod
    def body(summary, details):
        return "## 9.9.9\n\n" + summary + "\n\n" + "".join(f"- {item}\n" for item in details)

    def test_summary_and_each_detail_are_cut(self):
        parts = guard.release_notes_parts(self.body("碧" * 400, ["细" * 300]))
        self.assertEqual(len(parts["summary"]), 300)
        self.assertEqual([len(item) for item in parts["details"]], [240])

    def test_details_stop_once_the_total_runs_out(self):
        # 摘要 300 字 + 每条按原长 300 计：第 5 条时超过 1600，只留 4 条。
        parts = guard.release_notes_parts(self.body("碧" * 400, ["细" * 300] * 8))
        self.assertEqual(len(parts["details"]), 4)

    def test_at_most_twelve_details(self):
        parts = guard.release_notes_parts(self.body("碧琪换新衣服啦", [f"第{i}条" for i in range(20)]))
        self.assertEqual(parts["details"], [f"第{i}条" for i in range(12)])

    def test_bundled_notes_are_read_and_a_missing_file_gives_empty_notes(self):
        root = _temp_dir(self)
        self.assertEqual(guard.bundled_release_notes(root), {"summary": "", "details": []})
        (root / "release-notes.md").write_text("﻿" + self.body("碧琪更稳了", ["启动更快"]), encoding="utf-8")
        self.assertEqual(guard.bundled_release_notes(root, "9.9.9"), {"summary": "碧琪更稳了", "details": ["启动更快"]})


class MirrorSettingsTest(unittest.TestCase):
    """af4b6805：国内线路配置只认干净的 https 根地址（带查询串 / 片段的不要，免得拼出的下载地址被改向）；
    update-mirrors.json 不是 JSON 对象时退回内置加速代理，不抛错。"""

    def routes(self, settings):
        root = _temp_dir(self)
        (root / "update-mirrors.json").write_text(
            settings if isinstance(settings, str) else json.dumps(settings), encoding="utf-8")
        return guard.update_mirrors(root)

    def test_bases_with_a_query_or_fragment_are_dropped(self):
        routes = self.routes({"bucket": "https://b.example.cn/sp/?sig=1",
                              "proxies": ["https://p.example.cn/#x", "https://q.example.cn"]})
        self.assertEqual([route["manifest"] for route in routes],
                         ["https://q.example.cn/https://github.com/Cle0726/super-pinkie/releases/latest/download/latest.json"])

    def test_a_clean_bucket_comes_first_and_gets_a_trailing_slash(self):
        routes = self.routes({"bucket": "https://b.example.cn/sp", "proxies": ["https://q.example.cn/"]})
        self.assertEqual(routes[0]["label"], "国内服务器")
        self.assertEqual(routes[0]["manifest"], "https://b.example.cn/sp/latest.json")
        self.assertEqual(routes[0]["asset"]("9.9.9", "a.exe"), "https://b.example.cn/sp/v9.9.9/a.exe")

    def test_settings_that_are_not_an_object_fall_back_to_the_built_in_proxies(self):
        for raw in ("[]", '"https://b.example.cn/"', "1", "null"):
            with self.subTest(raw=raw):
                routes = self.routes(raw)
                self.assertEqual([route["label"] for route in routes], ["国内加速"] * len(guard.DEFAULT_UPDATE_PROXIES))


if __name__ == "__main__":
    unittest.main()
