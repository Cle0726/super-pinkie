"""Windows ships OpenClaw patches as a snapshot of the Mac app, not by running them.

The snapshot was frozen once, and Mac fixes made after that never reached
Windows: chat history lost the user's text and image, the context panel had no
breakdown, and 「帮我说清楚」 got plain text back while the shared UI waited for
the new structured answer.  tools/windows-package/refresh_mac_runtime.py
re-derives it; these checks keep the known fixes from silently dropping out.
"""
import hashlib
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "desktop/windows/mac-runtime"


def snapshot_text():
    return "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in (SNAPSHOT / "openclaw").rglob("*") if path.is_file()
    )


class MacSnapshotTest(unittest.TestCase):
    def test_mac_backend_fixes_are_in_the_snapshot(self):
        text = snapshot_text()
        for marker in (
            "pinkie-history-image-thumbnails:v1",  # user text + thumbnail survive in history
            "pinkie-oversized-user-record:v1",
            "pinkie-context-breakdown:v1",  # context panel per-category breakdown
            "pinkie-work-first-media-gate:v2",
        ):
            self.assertIn(marker, text)

    def test_shared_renderer_carries_the_work_first_chat_fix(self):
        chat = next((ROOT / "ui/runtime").glob("chat-page-*.js")).read_text(encoding="utf-8")
        self.assertIn("pinkie-work-first-chat:v1", chat)

    def test_companion_answers_in_the_format_the_shared_ui_reads(self):
        ui = (ROOT / "ui/injections/laolao-companion.js").read_text(encoding="utf-8")
        backend = (ROOT / "services/mode-architecture/companion.mjs").read_text(encoding="utf-8")
        if "understood" in ui:
            self.assertIn("export function normalizeClarify", backend)

    def test_snapshot_checksums_match(self):
        for line in (SNAPSHOT / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            value, rel = line.split("  ", 1)
            path = SNAPSHOT / rel.strip()
            self.assertTrue(path.is_file(), rel)
            self.assertEqual(value, hashlib.sha256(path.read_bytes()).hexdigest(), rel)

    def test_windows_ships_the_repository_services(self):
        # Windows fixes live in services/ now (workbench Explorer, app_browser
        # guide, party retry limit). Only the engine stays apart until plan A
        # merges it back.
        carried = sorted(path.relative_to(SNAPSHOT).as_posix()
                         for path in (SNAPSHOT / "services").rglob("*") if path.is_file())
        self.assertEqual(carried, ["services/mode-architecture/index.mjs"])

    def test_snapshot_services_only_carry_real_differences(self):
        # A byte-identical copy only goes stale later and shadows the repository fix.
        for path in (SNAPSHOT / "services").rglob("*"):
            if path.is_file():
                rel = path.relative_to(SNAPSHOT)
                repo = ROOT / rel
                self.assertFalse(repo.is_file() and repo.read_bytes() == path.read_bytes(), rel)


if __name__ == "__main__":
    unittest.main()
