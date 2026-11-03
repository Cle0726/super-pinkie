import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MirrorManifestTests(unittest.TestCase):
    def test_writes_latest_json_into_a_directory_that_does_not_exist_yet(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dist").mkdir()
            (root / "dist/app.zip").write_bytes(b"package")
            (root / "dist/app.zip.sha256").write_text("ignored")
            (root / "notes.md").write_text("﻿## 更新\n", encoding="utf-8")
            out = root / "mirror/latest.json"
            subprocess.run([sys.executable, str(ROOT / "tools/release/mirror_manifest.py"), "v1.2.3",
                            str(root / "notes.md"), str(root / "dist"), str(out)], check=True, capture_output=True)
            manifest = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(manifest["version"], "1.2.3")
            self.assertEqual(manifest["notes"], "## 更新\n")
            self.assertEqual(manifest["assets"], {"app.zip": {"sha256": hashlib.sha256(b"package").hexdigest(), "size": 7}})


if __name__ == "__main__":
    unittest.main()
