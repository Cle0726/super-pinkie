import hashlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PERSONAS = ROOT / "personas"
SYNC = ROOT / "installer/macos/sync-personas.sh"


class PersonaBundleTests(unittest.TestCase):
    def test_shipped_hash_list_covers_every_bundled_file(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/personas/shipped_hashes.py"), "--check"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_every_mode_gets_the_same_playbooks_and_their_references_exist(self):
        modes = ("chat", "project", "thinking", "learning")
        names = {mode: sorted(p.name for p in (PERSONAS / mode / "playbooks").iterdir()) for mode in modes}
        for mode in modes[1:]:
            self.assertEqual(names[mode], names["chat"], mode)
        for mode in modes:
            folder = PERSONAS / mode / "playbooks"
            for text in [p.read_text(encoding="utf-8") for p in folder.glob("*.md")] + [(PERSONAS / mode / "AGENTS.md").read_text(encoding="utf-8")]:
                for ref in set(__import__("re").findall(r"playbooks/([a-z-]+\.md)", text)):
                    self.assertTrue((folder / ref).is_file(), f"{mode}: playbooks/{ref}")

    def test_windows_machine_check_is_utf8_with_bom(self):
        data = (PERSONAS / "project/playbooks/machine-check.ps1").read_bytes()
        self.assertTrue(data.startswith(b"\xef\xbb\xbf"), "Windows PowerShell 5.1 needs the BOM to read Chinese text")

    @unittest.skipUnless(shutil.which("bash"), "needs bash")
    def test_mac_sync_updates_untouched_files_and_keeps_edited_ones(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            personas = tmp / "personas"
            (personas / "project/playbooks").mkdir(parents=True)
            (personas / "neutral").mkdir(parents=True)
            (personas / "project/AGENTS.md").write_text("新手册\n", encoding="utf-8")
            (personas / "project/SOUL.md").write_text("新人格\n", encoding="utf-8")
            (personas / "project/playbooks/new.md").write_text("新打法\n", encoding="utf-8")
            (personas / "neutral/IDENTITY.md").write_text("新身份\n", encoding="utf-8")
            old = {"project/AGENTS.md": "旧手册\n", "project/SOUL.md": "旧人格\n", "neutral/IDENTITY.md": "旧身份\n"}
            (personas / "shipped-hashes.txt").write_text(
                "".join(f"{hashlib.sha256(text.encode()).hexdigest()} {key}\n" for key, text in old.items()),
                encoding="utf-8",
            )
            home = tmp / "home"
            (home / "workspace-project").mkdir(parents=True)
            (home / "workspace-unrestricted").mkdir(parents=True)
            (home / "workspace-project/AGENTS.md").write_bytes("旧手册\r\n".encode())
            (home / "workspace-project/SOUL.md").write_text("我自己改的\n", encoding="utf-8")
            (home / "workspace-unrestricted/IDENTITY.md").write_text("旧身份\n", encoding="utf-8")
            subprocess.run(["bash", str(SYNC), str(personas), str(home), str(tmp / "backup")], check=True, capture_output=True)
            self.assertEqual((home / "workspace-project/AGENTS.md").read_text(encoding="utf-8"), "新手册\n")
            self.assertEqual((home / "workspace-project/SOUL.md").read_text(encoding="utf-8"), "我自己改的\n")
            self.assertEqual((home / "workspace-project/playbooks/new.md").read_text(encoding="utf-8"), "新打法\n")
            self.assertEqual((home / "workspace-unrestricted/IDENTITY.md").read_text(encoding="utf-8"), "旧身份\n")
            self.assertEqual((tmp / "backup/project/AGENTS.md").read_bytes(), "旧手册\r\n".encode())


if __name__ == "__main__":
    unittest.main()
