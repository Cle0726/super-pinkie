"""B128: UpdateHealthReporter._write() swallows OSError and only logs -- untested branch
(app/windows_updater.py, continuing B103/L98's hotspot sweep).

If the update-health marker directory cannot be created or written (a read-only
state root, a full disk, an antivirus lock on a freshly unpacked update), the
caller is ready()/start() running off pywebview's own thread, where a raised
exception is silently dropped and looks identical to success. _write() must
swallow the OSError and report False instead of raising, and ready() must
leave self.done unset on that False so a later retry can still land once the
obstruction clears -- marking done on a failed write would permanently stop
reporting health for an update that never actually told its helper it is ready.

All mocked: a tempdir stands in for the state root; no window, no real health
marker outside it, no registry.
"""
from pathlib import Path
import tempfile
import unittest

from app.windows_desktop import UpdateHealthReporter

TOKEN = "0123456789abcdef0123456789abcdef"


class WriteFailureTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def _reporter(self):
        return UpdateHealthReporter(TOKEN, "C:/new/_internal/runtime/bin/node.exe", listener=lambda: {}, root=self.root)

    def _block_updates_folder(self):
        # "updates" exists as a plain file, so "updates/health" can never be
        # created under it -- the real-world case is a read-only state root or
        # a full disk, without needing to actually fill a disk in a test.
        (self.root / "updates").write_text("blocking", encoding="utf-8")

    def test_write_failure_is_reported_and_does_not_raise(self):
        self._block_updates_folder()
        reporter = self._reporter()
        self.assertFalse(reporter._write(".started"))
        self.assertFalse(reporter._write(".ready"))

    def test_ready_leaves_done_unset_so_a_later_retry_can_still_land(self):
        self._block_updates_folder()
        reporter = self._reporter()
        reporter.ready()
        self.assertFalse(reporter.done.is_set(), "a write failure must not be mistaken for success")

        (self.root / "updates").unlink()  # the obstruction is gone
        reporter.ready()
        self.assertTrue(reporter.done.is_set())
        self.assertEqual((self.root / "updates" / "health" / f"{TOKEN}.ready").read_text(encoding="ascii"), "ready\n")

    def test_start_with_the_marker_protocol_does_not_raise_when_writing_fails(self):
        self._block_updates_folder()
        reporter = self._reporter()
        reporter.protocol = "marker"
        self.assertIsNone(reporter.start())  # must return normally, not raise
        self.assertFalse(reporter.done.is_set())


if __name__ == "__main__":
    unittest.main()
