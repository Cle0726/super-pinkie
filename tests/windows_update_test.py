import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app.windows_desktop import (
    UPDATE_API_URL,
    WindowsUpdater,
    release_update,
    update_health_token_from_argv,
    version_tuple,
)


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class WindowsUpdateTests(unittest.TestCase):
    def test_versions_are_numeric_and_reject_non_release_tags(self):
        self.assertGreater(version_tuple("v2.10.0"), version_tuple("2.9.9"))
        self.assertEqual((2, 5, 0, 0), version_tuple("2.5"))
        with self.assertRaises(ValueError):
            version_tuple("main")

    def test_release_requires_matching_exe_and_checksum_assets(self):
        release = {
            "tag_name": "v2.6.0",
            "assets": [
                {"name": "super-pinkie-windows-2.6.0.exe", "browser_download_url": "https://github.com/Cle0726/super-pinkie/releases/download/v2.6.0/app.exe"},
                {"name": "super-pinkie-windows-2.6.0.exe.sha256", "browser_download_url": "https://github.com/Cle0726/super-pinkie/releases/download/v2.6.0/app.exe.sha256"},
            ],
        }
        selected = release_update(release, "2.5.1")
        self.assertEqual("2.6.0", selected["version"])
        release["assets"][1]["browser_download_url"] = "https://example.com/not-trusted"
        self.assertIsNone(release_update(release, "2.5.1"))

    def test_download_is_verified_and_staged_outside_user_content(self):
        payload = b"pinkie-update" * 90000
        digest = hashlib.sha256(payload).hexdigest()
        version = "9.8.7"
        name = f"super-pinkie-windows-{version}.exe"
        exe_url = f"https://github.com/Cle0726/super-pinkie/releases/download/v{version}/{name}"
        sum_url = exe_url + ".sha256"
        release = {
            "tag_name": f"v{version}",
            "assets": [
                {"name": name, "browser_download_url": exe_url},
                {"name": name + ".sha256", "browser_download_url": sum_url},
            ],
        }
        bodies = {
            UPDATE_API_URL: json.dumps(release).encode(),
            exe_url: payload,
            sum_url: f"{digest}  {name}".encode(),
        }

        def opener(request, timeout=0):
            self.assertGreater(timeout, 0)
            return Response(bodies[request.full_url])

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "VERSION").write_text("2.5.1", encoding="utf-8")
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            state = root / "state"
            with mock.patch.dict(os.environ, {"LOCALAPPDATA": str(state)}, clear=False):
                updater = WindowsUpdater(root, opener=opener, executable=executable)
                result = updater.prepare()
                self.assertTrue(result["ready"])
                staged = state / "SuperPinkie/updates" / version / name
                self.assertEqual(digest, hashlib.sha256(staged.read_bytes()).hexdigest())
                self.assertEqual(b"old", executable.read_bytes())

    def test_replacer_waits_for_health_and_rolls_back(self):
        helper = WindowsUpdater._helper_source()
        self.assertIn("new version did not become healthy", helper)
        self.assertIn("Restore-PreviousVersion", helper)
        self.assertIn("Get-FileHash", helper)
        self.assertIn("taskkill.exe", helper)

    def test_health_token_is_strictly_scoped(self):
        token = "a" * 32
        self.assertEqual(token, update_health_token_from_argv([f"--update-health-token={token}"]))
        self.assertIsNone(update_health_token_from_argv(["--update-health-token=../../bad"]))


if __name__ == "__main__":
    unittest.main()
