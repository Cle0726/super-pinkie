"""B35：Windows 更新流程出事时的复发测试（下载中断、校验失败、磁盘满、续传被拒 / 不认 Range）。

不真下包：opener 是假的，响应是内存里的字节；磁盘满用一个写到一定字节数就抛 ENOSPC 的
文件句柄模拟。替换和回滚在 PowerShell 里，已有 windows_update_test / windows_update_health_test /
windows_update_leftovers_test 锁住，这里只管 Python 一侧：下载、续传、校验、暂存。
"""
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app.windows_desktop import UPDATE_API_URL, WindowsUpdater

URL = "https://github.com/Cle0726/super-pinkie/releases/download/v9.8.7/x.exe"
MB = 1024 * 1024


class Reply(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = dict(headers or {})

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def ranged(payload, seen, *, cut_first=None, refuse_resume=False, ignore_range=False):
    """假的下载服务器：记下每次的 Range 头，按参数模拟各种不老实的回应。"""
    def opener(request, timeout=0):
        header = request.headers.get("Range")
        seen.append(header)
        if header:
            start = int(header.split("=")[1].rstrip("-"))
            if refuse_resume:
                return Reply(b"", status=416)
            if ignore_range:
                return Reply(payload, status=200, headers={"Content-Length": str(len(payload))})
            body = payload[start:]
            return Reply(body, status=206, headers={
                "Content-Length": str(len(body)),
                "Content-Range": f"bytes {start}-{len(payload) - 1}/{len(payload)}"})
        if cut_first is not None and len([s for s in seen if s is None]) == 1:
            return Reply(payload[:cut_first], headers={"Content-Length": str(len(payload))})
        return Reply(payload, headers={"Content-Length": str(len(payload))})
    return opener


class DiskFull:
    """让 *.download 文件写到 limit 字节后抛 ENOSPC，像盘满了一样。"""

    def __init__(self, limit):
        self.limit = limit
        self.full = True
        self._real_open = Path.open

    def __enter__(self):
        outer = self
        real_open = self._real_open

        def fake_open(path, mode="r", *args, **kwargs):
            handle = real_open(path, mode, *args, **kwargs)
            if not str(path).endswith(".download") or "b" not in mode or ("w" not in mode and "+" not in mode):
                return handle
            write = handle.write

            def limited(chunk):
                if outer.full and handle.tell() + len(chunk) > outer.limit:
                    room = max(0, outer.limit - handle.tell())
                    if room:
                        write(chunk[:room])
                    raise OSError(errno.ENOSPC, "No space left on device")
                return write(chunk)
            handle.write = limited
            return handle

        self._patch = mock.patch.object(Path, "open", fake_open)
        self._patch.start()
        return self

    def __exit__(self, *_):
        self._patch.stop()


class WindowsUpdateRecoveryTests(unittest.TestCase):
    def setUp(self):
        # 和 windows_update_test 一样把状态根隔离开，别往真 updater.log 里写「下载失败」。
        self.temporary = tempfile.TemporaryDirectory(prefix="pinkie-update-recovery-")
        self.root = Path(self.temporary.name) / "app"
        self.root.mkdir()
        (self.root / "VERSION").write_text("2.5.1", encoding="utf-8")
        self.executable = self.root / "超級碧琪.exe"
        self.executable.write_bytes(b"old")
        self.state = Path(self.temporary.name) / "state"
        self.environment = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.state)})
        self.environment.start()
        self.sleep = mock.patch("time.sleep")
        self.sleep.start()

    def tearDown(self):
        self.sleep.stop()
        self.environment.stop()
        self.temporary.cleanup()

    def updater(self, opener):
        return WindowsUpdater(self.root, opener=opener, executable=self.executable)

    # ---------- 下载中断 / 续传 ----------

    def test_refused_resume_drops_the_partial_and_restarts_from_zero_in_the_same_call(self):
        payload = b"a" * (3 * MB)
        seen = []
        destination = self.root / "payload.exe"
        (self.root / "payload.exe.download").write_bytes(b"stale" * 1000)
        opener = ranged(payload, seen, refuse_resume=True)
        self.updater(opener)._download(URL, destination)
        self.assertEqual(payload, destination.read_bytes())
        self.assertEqual(["bytes=5000-", None], seen, "416 之后下一次不带 Range、从 0 重下")
        self.assertFalse((self.root / "payload.exe.download").exists())

    def test_server_that_ignores_range_overwrites_the_partial_instead_of_appending(self):
        payload = b"b" * (3 * MB)
        seen = []
        destination = self.root / "payload.exe"
        (self.root / "payload.exe.download").write_bytes(b"b" * MB)
        self.updater(ranged(payload, seen, ignore_range=True))._download(URL, destination)
        self.assertEqual(payload, destination.read_bytes(), "回 200 就是整包：从头写，不接在半成品后面")
        self.assertEqual([f"bytes={MB}-"], seen)

    # ---------- 磁盘满 ----------

    def test_disk_full_raises_keeps_what_was_written_and_resumes_once_there_is_room(self):
        payload = b"c" * (3 * MB)
        seen = []
        destination = self.root / "payload.exe"
        updater = self.updater(ranged(payload, seen))
        with DiskFull(2 * MB) as disk:
            with self.assertRaises(OSError) as caught:
                updater._download(URL, destination, attempts=2)
            self.assertEqual(errno.ENOSPC, caught.exception.errno)
            self.assertFalse(destination.exists(), "没下完不能当成下好了")
            self.assertEqual(2 * MB, (self.root / "payload.exe.download").stat().st_size)
            disk.full = False
            updater._download(URL, destination)
        self.assertEqual(payload, destination.read_bytes())
        self.assertEqual(f"bytes={2 * MB}-", seen[-1], "腾出地方后接着已写的 2MB 往下拿")

    # ---------- 校验失败（走完整的 prepare） ----------

    def release(self, payload, checksum_text=None):
        version = "9.8.7"
        name = f"super-pinkie-windows-{version}.exe"
        exe_url = f"https://github.com/Cle0726/super-pinkie/releases/download/v{version}/{name}"
        sum_url = exe_url + ".sha256"
        release = {"tag_name": f"v{version}", "assets": [
            {"name": name, "browser_download_url": exe_url},
            {"name": name + ".sha256", "browser_download_url": sum_url}]}
        digest = hashlib.sha256(payload).hexdigest()
        bodies = {UPDATE_API_URL: json.dumps(release).encode(), sum_url: (checksum_text or f"{digest}  {name}").encode()}
        calls = []

        def opener(request, timeout=0):
            calls.append(request.full_url)
            if request.full_url == exe_url:
                return Reply(payload, headers={"Content-Length": str(len(payload))})
            return Reply(bodies[request.full_url])
        return opener, calls, self.state / "updates" / version / name, exe_url, digest

    def test_checksum_mismatch_leaves_nothing_staged_and_the_old_app_untouched(self):
        payload = b"d" * (2 * MB)
        opener, calls, staged, exe_url, _ = self.release(payload, checksum_text="0" * 64 + "  super-pinkie-windows-9.8.7.exe")
        updater = self.updater(opener)
        with self.assertRaises(ValueError) as caught:
            updater.prepare()
        self.assertIn("checksum mismatch", str(caught.exception))
        self.assertFalse(staged.exists())
        self.assertFalse(staged.with_suffix(staged.suffix + ".download").exists(), "坏包的半成品也不留")
        self.assertIsNone(updater.prepared, "不能留着一个能被 launch_replacer 拿去换的包")
        self.assertEqual(b"old", self.executable.read_bytes())
        self.assertEqual(1, calls.count(exe_url))

    def test_checksum_file_for_another_asset_stops_before_downloading_the_package(self):
        payload = b"e" * (2 * MB)
        opener, calls, staged, exe_url, digest = self.release(payload, checksum_text=f"{hashlib.sha256(payload).hexdigest()}  other.exe")
        with self.assertRaises(ValueError):
            self.updater(opener).prepare()
        self.assertNotIn(exe_url, calls, "校验和文件不对就别去下几百 MB 的包")
        self.assertFalse(staged.exists())

    def test_corrupt_package_left_by_an_earlier_run_is_downloaded_again_and_verified(self):
        payload = b"f" * (2 * MB)
        opener, calls, staged, exe_url, digest = self.release(payload)
        staged.parent.mkdir(parents=True)
        staged.write_bytes(b"half-written by a crash")
        result = self.updater(opener).prepare()
        self.assertTrue(result["ready"])
        self.assertEqual(digest, hashlib.sha256(staged.read_bytes()).hexdigest())
        self.assertEqual(1, calls.count(exe_url))

    def test_verified_package_from_an_earlier_run_is_reused_without_downloading(self):
        payload = b"g" * (2 * MB)
        opener, calls, staged, exe_url, digest = self.release(payload)
        staged.parent.mkdir(parents=True)
        staged.write_bytes(payload)
        self.assertTrue(self.updater(opener).prepare()["ready"])
        self.assertNotIn(exe_url, calls)


if __name__ == "__main__":
    unittest.main()
