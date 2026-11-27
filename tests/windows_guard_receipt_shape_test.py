"""Guard receipt and bundle identity files that are valid JSON but not an object.

The guard state under the user's profile (guard/status.json,
.openclaw/guard-receipt.json, the plugins' guard-build.json) can be rewritten
by anyone with access to that profile. When one of them held `[]` or a bare
string, `.get` raised AttributeError, which has_guard_receipt did not catch. It
went up through process_guard_alerts, and startup only logged "startup guard
alert check failed": a tampered counter was neither locked nor reported.
"""

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import windows_update_guard as guard  # noqa: E402

NOT_OBJECTS = ("[]", '"x"', "1", "null")


class GuardReceiptShapeTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="pinkie-guard-shape-")
        self.root = Path(self._tmp.name)
        self.app_state = self.root / "state"
        (self.app_state / "guard").mkdir(parents=True)
        self.oc_dir = self.root / ".openclaw"
        self.oc_dir.mkdir()
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        (self.bundle / "build-info.json").write_text(
            json.dumps({"guard": True, "channel": "release", "version": "2.5.99", "commit": "abc123"}),
            encoding="utf-8",
        )

    def tearDown(self):
        self._tmp.cleanup()

    def status_file(self):
        return self.app_state / "guard" / "status.json"

    def receipt_file(self):
        return self.oc_dir / "guard-receipt.json"

    def mark_file(self, plugin="pinkie-mode-architecture"):
        path = self.oc_dir / "extensions" / plugin / "guard-build.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def has_receipt(self):
        return guard.has_guard_receipt(self.app_state, self.oc_dir, version="2.5.99", commit="abc123")

    def test_a_status_that_is_not_an_object_falls_through_to_the_receipt(self):
        self.receipt_file().write_text(json.dumps({"schema": 1, "version": "2.5.99", "commit": "abc123"}), encoding="utf-8")
        for raw in NOT_OBJECTS:
            with self.subTest(status=raw):
                self.status_file().write_text(raw, encoding="utf-8")
                self.assertTrue(self.has_receipt())

    def test_a_receipt_that_is_not_an_object_falls_through_to_the_plugin_mark(self):
        self.mark_file().write_text(
            json.dumps({"counterReady": True, "version": "2.5.99", "commit": "abc123"}), encoding="utf-8")
        for raw in NOT_OBJECTS:
            with self.subTest(receipt=raw):
                self.receipt_file().write_text(raw, encoding="utf-8")
                self.assertTrue(self.has_receipt())

    def test_plugin_marks_that_are_not_objects_mean_no_receipt(self):
        for raw in NOT_OBJECTS:
            with self.subTest(mark=raw):
                for plugin in ("pinkie-mode-architecture", "pinkie-project-scope", "pinkie-first-person-renderer"):
                    self.mark_file(plugin).write_text(raw, encoding="utf-8")
                self.assertFalse(self.has_receipt())

    def test_bundle_identity_survives_files_that_are_not_objects(self):
        manifest = self.bundle / "guard-manifest.json"
        for raw in NOT_OBJECTS:
            with self.subTest(manifest=raw):
                manifest.write_text(raw, encoding="utf-8")
                identity = guard.guard_bundle_identity(self.bundle)
                self.assertEqual(identity["version"], "2.5.99")
                self.assertEqual(identity["commit"], "abc123")
                self.assertEqual(len(identity["manifestSha"]), 64)
        manifest.unlink()
        for raw in NOT_OBJECTS:
            with self.subTest(build_info=raw):
                (self.bundle / "build-info.json").write_text(raw, encoding="utf-8")
                self.assertEqual(guard.guard_bundle_identity(self.bundle),
                                 {"channel": "release", "version": "", "commit": "", "manifestSha": ""})

    def test_a_tampered_counter_is_still_locked_when_the_status_file_is_not_an_object(self):
        # Release build, first counter check at startup, counter.json missing
        # (deleted), a matching receipt, and status.json replaced by [].
        self.receipt_file().write_text(json.dumps({"schema": 1, "version": "2.5.99", "commit": "abc123"}), encoding="utf-8")
        self.status_file().write_text("[]", encoding="utf-8")
        presented, locked = [], []
        should_exit, verified = guard.process_guard_alerts(
            self.bundle,
            startup=True,
            app_state=self.app_state,
            openclaw_state=self.oc_dir,
            seen_ids=set(),
            presenter=lambda *args: presented.append(args),
            locker=lambda *args: locked.append(args),
            is_updating=lambda _dir: False,
        )
        self.assertEqual(len(locked), 1, "the tampered counter must be locked")
        self.assertEqual(len(presented), 1)
        self.assertTrue(should_exit)
        self.assertFalse(verified)


if __name__ == "__main__":
    unittest.main()
