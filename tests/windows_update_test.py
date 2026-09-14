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


class SizedResponse(io.BytesIO):
    """像 urllib 的响应一样带 status 和 headers，用来模拟 Content-Length。"""

    def __init__(self, body, status=200, content_length=None):
        super().__init__(body)
        self.status = status
        self.headers = {} if content_length is None else {"Content-Length": str(content_length)}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class WindowsUpdateTests(unittest.TestCase):
    def setUp(self):
        # The updater resolves the state root from the process environment, both
        # for the staged package and for its log.  Left alone that is the live
        # profile, so the tests that fail a download on purpose used to append
        # "update package download was cut short" to the real updater.log, where
        # it is indistinguishable from an outage.  The service suites isolate
        # themselves the same way.
        self.temporary = tempfile.TemporaryDirectory(prefix="pinkie-update-unit-")
        self.state = Path(self.temporary.name) / "state"
        self.environment = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.state)})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.temporary.cleanup()

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
            updater = WindowsUpdater(root, opener=opener, executable=executable)
            result = updater.prepare()
            self.assertTrue(result["ready"])
            staged = self.state / "updates" / version / name
            self.assertEqual(digest, hashlib.sha256(staged.read_bytes()).hexdigest())
            # Staged under the state root, never inside the directory that is
            # about to be replaced -- the replacer has to be free to wipe it.
            self.assertNotIn(root, staged.parents)
            self.assertEqual(b"old", executable.read_bytes())

    def test_onedir_is_detected_by_layout_not_by_folder_name(self):
        """装在 F:\\SuperPinkie 这类自定义目录里的 onedir 包必须仍被认成便携目录。

        旧实现要求父目录必须叫「超級碧琪」，于是误判成 onefile，更新时会去下单文件
        exe，把同级 _internal 变成孤儿。
        """
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "SuperPinkie"
            (root / "_internal").mkdir(parents=True)
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            self.assertTrue(WindowsUpdater(root, executable=executable).portable)

            onefile_root = Path(temporary) / "Somewhere"
            onefile_root.mkdir()
            onefile = onefile_root / "super-pinkie-windows-9.8.7.exe"
            onefile.write_bytes(b"old")
            self.assertFalse(WindowsUpdater(onefile_root, executable=onefile).portable)

    def test_portable_release_selects_the_directory_package(self):
        release = {
            "tag_name": "v9.8.7",
            "assets": [
                {"name": "super-pinkie-windows-9.8.7.exe", "browser_download_url": "https://github.com/Cle0726/super-pinkie/releases/download/v9.8.7/app.exe"},
                {"name": "super-pinkie-windows-9.8.7.exe.sha256", "browser_download_url": "https://github.com/Cle0726/super-pinkie/releases/download/v9.8.7/app.exe.sha256"},
                {"name": "super-pinkie-windows-9.8.7-portable.zip", "browser_download_url": "https://github.com/Cle0726/super-pinkie/releases/download/v9.8.7/app-portable.zip"},
                {"name": "super-pinkie-windows-9.8.7-portable.zip.sha256", "browser_download_url": "https://github.com/Cle0726/super-pinkie/releases/download/v9.8.7/app-portable.zip.sha256"},
            ],
        }
        selected = release_update(release, "2.5.7", portable=True)
        self.assertEqual("super-pinkie-windows-9.8.7-portable.zip", selected["name"])
        self.assertTrue(selected["portable"])
        self.assertEqual("super-pinkie-windows-9.8.7.exe", release_update(release, "2.5.7")["name"])

    def test_truncated_download_is_rejected_instead_of_staged(self):
        """被掐断的下载必须抛错，不能当成下载完成（否则会报成 checksum mismatch）。"""
        total, sent = 3 * 1024 * 1024, 1024 * 1024

        def opener(request, timeout=0):
            return SizedResponse(b"x" * sent, content_length=total)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            updater = WindowsUpdater(root, opener=opener, executable=executable)
            destination = root / "payload.exe"
            with mock.patch("time.sleep"):
                with self.assertRaises(ValueError) as caught:
                    updater._download("https://github.com/Cle0726/super-pinkie/x.exe", destination, attempts=2)
            self.assertIn("cut short", str(caught.exception))
            self.assertFalse(destination.exists())
            # 半成品是故意留下的：它是下一次的续传起点。删掉它等于把「下到一半断了」
            # 变成「下次从零再来」，而 404MB 的包经代理几乎不可能一口气跑完。
            self.assertEqual(sent, (root / "payload.exe.download").stat().st_size)

    def test_a_failed_download_keeps_its_resume_point_for_the_next_call(self):
        """一次调用用尽重试后，已收到的字节必须留给下一次调用续传。

        这是更新在本机能否成功的分水岭：包有 404MB，代理中途掐断，4 次重试跑不完。
        """
        payload = b"p" * (3 * 1024 * 1024)
        first_chunk = 1024 * 1024
        seen = []

        def opener(request, timeout=0):
            header = request.headers.get("Range")
            seen.append(header)
            if header:
                start = int(header.split("=")[1].rstrip("-"))
                return SizedResponse(payload[start:], status=206, content_length=len(payload) - start)
            return SizedResponse(payload[:first_chunk], content_length=len(payload))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            updater = WindowsUpdater(root, opener=opener, executable=executable)
            destination = root / "payload.exe"
            with mock.patch("time.sleep"):
                with self.assertRaises(ValueError):
                    updater._download("https://github.com/Cle0726/super-pinkie/x.exe", destination, attempts=1)
            self.assertFalse(destination.exists())
            self.assertEqual(first_chunk, (root / "payload.exe.download").stat().st_size)
            # 下次启动：必须接着已经收到的 1MB 往下拿，而不是从 0 开始。
            with mock.patch("time.sleep"):
                updater._download("https://github.com/Cle0726/super-pinkie/x.exe", destination)
            self.assertEqual(payload, destination.read_bytes())
        self.assertEqual([None, "bytes=1048576-"], seen)

    def test_interrupted_download_resumes_with_range(self):
        """第一次被掐断后，第二次必须带 Range 续传，而不是从零重下。"""
        payload = b"p" * (3 * 1024 * 1024)
        first_chunk = 1024 * 1024
        seen = []

        def opener(request, timeout=0):
            header = request.headers.get("Range")
            seen.append(header)
            if header:
                start = int(header.split("=")[1].rstrip("-"))
                return SizedResponse(payload[start:], status=206, content_length=len(payload) - start)
            return SizedResponse(payload[:first_chunk], content_length=len(payload))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            updater = WindowsUpdater(root, opener=opener, executable=executable)
            destination = root / "payload.exe"
            with mock.patch("time.sleep"):
                updater._download("https://github.com/Cle0726/super-pinkie/x.exe", destination)
            self.assertEqual(payload, destination.read_bytes())
        self.assertEqual([None, f"bytes={first_chunk}-"], seen)

    def test_portable_replacer_verifies_the_package_before_swapping(self):
        """便携包必须先验哈希再展开/替换，坏包不能碰安装目录。"""
        helper = WindowsUpdater._directory_helper_source()
        self.assertIn("update package checksum mismatch", helper)
        verify = helper.index("Get-FileHash")
        self.assertLess(verify, helper.index("Expand-Archive"))
        self.assertLess(verify, helper.index("Move-Item -LiteralPath $TargetDir -Destination $Backup"))

    def test_replacer_waits_for_health_and_rolls_back(self):
        helper = WindowsUpdater._helper_source()
        self.assertIn("new version did not become healthy", helper)
        self.assertIn("Restore-PreviousVersion", helper)
        self.assertIn("Get-FileHash", helper)
        self.assertIn("taskkill.exe", helper)
        self.assertIn("UpdateRoot", helper)
        self.assertIn("Get-ChildItem -LiteralPath $UpdateRoot", helper)

    def test_health_token_is_strictly_scoped(self):
        token = "a" * 32
        self.assertEqual(token, update_health_token_from_argv([f"--update-health-token={token}"]))
        self.assertIsNone(update_health_token_from_argv(["--update-health-token=../../bad"]))


if __name__ == "__main__":
    unittest.main()
