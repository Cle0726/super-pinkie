"""B134: WindowsUpdater.prepare()/_download() 的 Staging 权限与原子替换失败恢复单测。

补的是 prepare() 里两处目前没有专门用例锁住的失败路径（都只走 tempfile，不碰真实安装、
不起窗口）：

1. 临时 Staging 目录（state_root()/updates/<version>）创建时权限不足
   （directory.mkdir 抛 PermissionError）：异常必须原样往上抛，不能被这里吞掉悄悄
   当成“已下载”——调用方（windows_bridge.prepare_update）已经把通用异常接成
   temporaryError 展示给用户，这里只保证 prepare() 自己不多吞一层、且没有在
   mkdir 失败之后继续走到网络请求。

2. 下载完整后最终 os.replace(temporary, destination) 失败（目标在被杀毒软件或同
   一个 App 的另一个线程占用时常见）：已经收到的完整字节必须保留在 .download
   临时文件里，不能被这次失败顺手删掉——不然每次最后一步偏巧失败，就要从零
   重新下一遍几百 MB。

Stale update 锁残留（PID 已不存在）那一条已经由 windows_update_health_test.py 的
InProgressGuardTest.test_leftover_file_never_locks_the_user_out 锁住，这里不重复。
"""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app.windows_desktop import UPDATE_API_URL, WindowsUpdater


class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = dict(headers or {})

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _release(version, name, exe_url, sum_url):
    return {
        "tag_name": f"v{version}",
        "assets": [
            {"name": name, "browser_download_url": exe_url},
            {"name": name + ".sha256", "browser_download_url": sum_url},
        ],
    }


class StagingDirectoryPermissionTest(unittest.TestCase):
    """state_root()/updates/<version> 建不出来：权限不足、磁盘只读、或被安全软件拦截。"""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pinkie-update-staging-")
        self.state = Path(self.temporary.name) / "state"
        self.environment = mock.patch.dict(
            __import__("os").environ, {"PINKIE_STATE_ROOT": str(self.state)}
        )
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.temporary.cleanup()

    def _release_and_opener(self, version="9.9.1"):
        payload = b"pinkie-update" * 90000
        digest = hashlib.sha256(payload).hexdigest()
        name = f"super-pinkie-windows-{version}.exe"
        exe_url = f"https://github.com/Cle0726/super-pinkie/releases/download/v{version}/{name}"
        sum_url = exe_url + ".sha256"
        release = _release(version, name, exe_url, sum_url)
        bodies = {
            UPDATE_API_URL: json.dumps(release).encode(),
            exe_url: payload,
            sum_url: f"{digest}  {name}".encode(),
        }

        def opener(request, timeout=0):
            return Response(bodies[request.full_url])

        return opener, version, payload, digest

    def test_mkdir_permission_error_propagates_without_a_network_call(self):
        opener, version, _payload, _digest = self._release_and_opener()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "VERSION").write_text("2.5.1", encoding="utf-8")
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            updater = WindowsUpdater(root, opener=opener, executable=executable)

            fetch_called = []
            original_fetch = updater._fetch

            def spying_fetch(*args, **kwargs):
                fetch_called.append(True)
                return original_fetch(*args, **kwargs)

            updater._fetch = spying_fetch

            with mock.patch.object(
                Path, "mkdir", side_effect=PermissionError(13, "Access is denied", str(self.state))
            ):
                with self.assertRaises(PermissionError):
                    updater.prepare()

            self.assertEqual([], fetch_called, "must not touch the network before staging exists")
            self.assertFalse((self.state / "updates" / version).exists())
            self.assertIsNone(updater.prepared)
            self.assertEqual(b"old", executable.read_bytes())

    def test_retry_after_permission_restored_still_succeeds(self):
        """权限问题一次性的（比如安全软件短暂拦截）：下一次调用应当照常跑通，
        不会因为上一次半途失败留下任何挡路的残留状态。"""
        opener, version, _payload, digest = self._release_and_opener(version="9.9.2")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "VERSION").write_text("2.5.1", encoding="utf-8")
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            updater = WindowsUpdater(root, opener=opener, executable=executable)

            with mock.patch.object(
                Path, "mkdir", side_effect=PermissionError(13, "Access is denied", str(self.state))
            ):
                with self.assertRaises(PermissionError):
                    updater.prepare()

            result = updater.prepare()
            self.assertTrue(result["ready"])
            staged = self.state / "updates" / version / f"super-pinkie-windows-{version}.exe"
            self.assertEqual(digest, hashlib.sha256(staged.read_bytes()).hexdigest())


class AtomicReplaceFailureTest(unittest.TestCase):
    """下载已经完整收到、校验也会通过，但最后把 .download 文件换成正式文件名那一步失败。"""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pinkie-update-replace-")
        self.state = Path(self.temporary.name) / "state"
        self.environment = mock.patch.dict(
            __import__("os").environ, {"PINKIE_STATE_ROOT": str(self.state)}
        )
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.temporary.cleanup()

    def test_completed_download_is_kept_on_disk_when_the_final_rename_fails(self):
        payload = b"pinkie-update" * 90000
        digest = hashlib.sha256(payload).hexdigest()
        version = "9.9.3"
        name = f"super-pinkie-windows-{version}.exe"
        exe_url = f"https://github.com/Cle0726/super-pinkie/releases/download/v{version}/{name}"
        sum_url = exe_url + ".sha256"
        release = _release(version, name, exe_url, sum_url)
        bodies = {
            UPDATE_API_URL: json.dumps(release).encode(),
            exe_url: payload,
            sum_url: f"{digest}  {name}".encode(),
        }

        def opener(request, timeout=0):
            return Response(bodies[request.full_url])

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "VERSION").write_text("2.5.1", encoding="utf-8")
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            updater = WindowsUpdater(root, opener=opener, executable=executable)

            with mock.patch(
                "app.windows_desktop.os.replace",
                side_effect=PermissionError(13, "being used by another process"),
            ):
                with self.assertRaises(PermissionError):
                    updater.prepare()

            staged_dir = self.state / "updates" / version
            temporary_file = staged_dir / (name + ".download")
            destination = staged_dir / name
            self.assertTrue(temporary_file.is_file(), "the fully-downloaded bytes must survive the failed rename")
            self.assertEqual(len(payload), temporary_file.stat().st_size)
            self.assertFalse(destination.exists())
            self.assertIsNone(updater.prepared)
            self.assertEqual(b"old", executable.read_bytes())

    def test_next_prepare_call_recovers_once_the_rename_is_unblocked(self):
        payload = b"pinkie-update" * 90000
        digest = hashlib.sha256(payload).hexdigest()
        version = "9.9.4"
        name = f"super-pinkie-windows-{version}.exe"
        exe_url = f"https://github.com/Cle0726/super-pinkie/releases/download/v{version}/{name}"
        sum_url = exe_url + ".sha256"
        release = _release(version, name, exe_url, sum_url)
        bodies = {
            UPDATE_API_URL: json.dumps(release).encode(),
            exe_url: payload,
            sum_url: f"{digest}  {name}".encode(),
        }
        def opener(request, timeout=0):
            return Response(bodies[request.full_url])

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "VERSION").write_text("2.5.1", encoding="utf-8")
            executable = root / "超級碧琪.exe"
            executable.write_bytes(b"old")
            updater = WindowsUpdater(root, opener=opener, executable=executable)

            with mock.patch(
                "app.windows_desktop.os.replace",
                side_effect=PermissionError(13, "being used by another process"),
            ):
                with self.assertRaises(PermissionError):
                    updater.prepare()

            # The real os.replace is back in place now (the mock only wrapped the
            # first call); a plain retry must land cleanly, picking the staged
            # bytes back up rather than being stuck on the earlier failure.
            result = updater.prepare()
            self.assertTrue(result["ready"])
            staged = self.state / "updates" / version / name
            self.assertEqual(digest, hashlib.sha256(staged.read_bytes()).hexdigest())
            self.assertEqual(str(staged), result and updater.prepared["payload"] and str(updater.prepared["payload"]))


if __name__ == "__main__":
    unittest.main()
