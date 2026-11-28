"""B104：现装的是 C.le. 包时，Windows 更新器碰到三种异常的复发测试。

C.le. 包 = build-win.ps1 用 C.le. 内核打的包（build-info.json channel=cle，设定防护关）。
更新器本身不读 core-manifest.json：cle-core tgz 的 SHA-256 在打包时由 tools/core/manifest.mjs
把关（Node 测试 core-manifest / core-cle-preflight 锁住）。到了用户机器上，同一道关落在
「更新包的 SHA-256」上，所以这里锁的是更新器这一侧：

  1. 校验和不对：官方 .sha256 或国内清单里的 sha256 和下到的字节对不上 → 不暂存、不能换、旧版不动；
  2. 下载中断：被掐断时报「下了一半」、留半成品续传，而不是当成下完再报成校验和不对；
  3. 回退到 OpenClaw 包：更新器不看内核种类，比现装版本新的 OpenClaw 包照常装（正式版照常验签），
     版本号不更新的包不会被当成更新。

不真下载：opener 是假的，响应是内存里的字节；状态根指到临时目录，不写真 updater.log。
"""
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app.windows_desktop import GUARD_UPDATE_REFUSED, UPDATE_API_URL, WindowsUpdater
from app.windows_update_guard import guard_bundle_identity, guard_release_build

MB = 1024 * 1024
VERSION = "9.8.7"
NAME = f"super-pinkie-windows-{VERSION}.exe"
EXE_URL = f"https://github.com/Cle0726/super-pinkie/releases/download/v{VERSION}/{NAME}"
SUM_URL = EXE_URL + ".sha256"
LATEST_URL = f"https://github.com/Cle0726/super-pinkie/releases/download/v{VERSION}/latest.json"
BUCKET = "https://mirror.example.cn/super-pinkie/"


class Reply(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = dict(headers or {})

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class CleInstalledUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pinkie-update-cle-")
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.state = base / "state"
        environment = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.state)})
        environment.start()
        self.addCleanup(environment.stop)
        sleep = mock.patch("time.sleep")
        sleep.start()
        self.addCleanup(sleep.stop)
        self.root = base / "app"
        self.root.mkdir()
        (self.root / "VERSION").write_text("2.5.1", encoding="utf-8")
        self.build_info({"guard": False, "channel": "cle", "version": "2.5.1", "commit": "a" * 40})
        # 包里带的内核清单（build-win.ps1 --add-data core-manifest.json）：更新器不该依赖它。
        (self.root / "core-manifest.json").write_text(json.dumps({"default": "cle"}), encoding="utf-8")
        self.executable = self.root / "超級碧琪.exe"
        self.executable.write_bytes(b"old")
        self.staged = self.state / "updates" / VERSION / NAME

    def build_info(self, info):
        (self.root / "build-info.json").write_text(json.dumps(info), encoding="utf-8")

    def updater(self, opener):
        return WindowsUpdater(self.root, opener=opener, executable=self.executable)

    def official(self, payload, *, digest=None, tag=VERSION, package=None):
        """官方线路：Release API + .sha256 + 安装包。package(request) 可以换成不老实的下载服务器。"""
        digest = digest or hashlib.sha256(payload).hexdigest()
        release = {"tag_name": f"v{tag}", "assets": [
            {"name": NAME, "browser_download_url": EXE_URL},
            {"name": NAME + ".sha256", "browser_download_url": SUM_URL}]}
        bodies = {UPDATE_API_URL: json.dumps(release).encode(), SUM_URL: f"{digest}  {NAME}".encode()}
        calls = []

        def opener(request, timeout=0):
            calls.append(request.full_url)
            if request.full_url == EXE_URL:
                if package:
                    return package(request)
                return Reply(payload, headers={"Content-Length": str(len(payload))})
            if request.full_url not in bodies:
                raise OSError("404")
            return Reply(bodies[request.full_url])
        return opener, calls

    def assert_nothing_staged(self, updater):
        self.assertFalse(self.staged.exists(), "坏包不能留在暂存目录里")
        self.assertFalse(self.staged.with_suffix(self.staged.suffix + ".download").exists(), "坏包的半成品也不留")
        self.assertIsNone(updater.prepared, "不能留着一个能被 launch_replacer 拿去换的包")
        self.assertEqual({"started": False, "message": "新版还没有准备好"}, updater.launch_replacer())
        self.assertEqual(b"old", self.executable.read_bytes(), "旧版不动")

    # ---------- 前提：现装的是 C.le. 包 ----------

    def test_the_installed_cle_package_is_a_guard_off_build_with_its_own_channel(self):
        self.assertFalse(guard_release_build(self.root))
        self.assertEqual("cle", guard_bundle_identity(self.root)["channel"], "channel=cle 不能被当成 release")

    # ---------- 1. SHA-256 不对 ----------

    def test_package_that_does_not_match_the_official_sha256_is_refused(self):
        payload = b"c" * (2 * MB)
        opener, calls = self.official(payload, digest="0" * 64)
        updater = self.updater(opener)
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            updater.prepare()
        self.assert_nothing_staged(updater)
        self.assertEqual(1, calls.count(EXE_URL))
        self.assertNotIn(LATEST_URL, calls, "防护关的包不去拿签名清单")

    def test_package_that_does_not_match_the_mirror_manifest_sha256_is_refused(self):
        """官方 .sha256 连不上时只剩国内 latest.json 里的 sha256：它不对，照样不装。"""
        payload = b"m" * (2 * MB)
        (self.root / "update-mirrors.json").write_text(json.dumps({"bucket": BUCKET}), encoding="utf-8")
        manifest = {"version": VERSION, "notes": "", "assets": {NAME: {"sha256": "1" * 64, "size": len(payload)}}}
        asset_url = f"{BUCKET}v{VERSION}/{NAME}"
        calls = []

        def opener(request, timeout=0):
            calls.append(request.full_url)
            if request.full_url == BUCKET + "latest.json":
                return Reply(json.dumps(manifest).encode())
            if request.full_url == asset_url:
                return Reply(payload, headers={"Content-Length": str(len(payload))})
            raise OSError("unreachable")
        updater = self.updater(opener)
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            updater.prepare(route="mirror")
        self.assertIn(SUM_URL, calls, "先试官方校验和")
        self.assertEqual(1, calls.count(asset_url))
        self.assert_nothing_staged(updater)

    # ---------- 2. 下载中断 ----------

    def test_interrupted_download_keeps_its_partial_and_is_not_reported_as_a_checksum_mismatch(self):
        """每次都在 1MB 处断（续传请求一个字节都没回来）：报「下了一半」，留着 1MB 下次接着下。"""
        payload = bytes(range(256)) * (3 * MB // 256)

        def package(request):
            header = request.headers.get("Range")
            if not header:
                return Reply(payload[:MB], headers={"Content-Length": str(len(payload))})
            start = int(header.split("=")[1].rstrip("-"))
            return Reply(b"", status=206, headers={
                "Content-Length": str(len(payload) - start),
                "Content-Range": f"bytes {start}-{len(payload) - 1}/{len(payload)}"})
        opener, _ = self.official(payload, package=package)
        updater = self.updater(opener)
        with self.assertRaisesRegex(ValueError, "cut short"):
            updater.prepare()
        partial = self.staged.with_suffix(self.staged.suffix + ".download")
        self.assertEqual(payload[:MB], partial.read_bytes(), "半成品是下一次的续传起点")
        self.assertFalse(self.staged.exists())
        self.assertIsNone(updater.prepared)
        self.assertEqual(b"old", self.executable.read_bytes())

    def test_resume_without_content_length_that_is_cut_again_is_resumed_not_called_a_checksum_mismatch(self):
        """代理续传时回 206 + Content-Range 但不带 Content-Length（分块传输），又在半路断了。

        旧实现只拿 Content-Length 核对长度：没有它就把「下了 2MB 的 3MB 包」当成下完，
        os.replace 成正式文件，prepare() 再报成「发布产物和 .sha256 对不上」并删掉已收到的字节。
        Content-Range 里明明写着总长 3MB，应当照它判断「还没下完」并接着续传。
        """
        payload = bytes(range(256)) * (3 * MB // 256)
        seen = []

        def package(request):
            header = request.headers.get("Range")
            seen.append(header)
            if not header:
                return Reply(payload[:MB], headers={"Content-Length": str(len(payload))})
            start = int(header.split("=")[1].rstrip("-"))
            end = min(start + MB, len(payload))  # 每次最多给 1MB 就断
            return Reply(payload[start:end], status=206, headers={
                "Content-Range": f"bytes {start}-{len(payload) - 1}/{len(payload)}"})
        opener, _ = self.official(payload, package=package)
        result = self.updater(opener).prepare()
        self.assertTrue(result["ready"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), hashlib.sha256(self.staged.read_bytes()).hexdigest())
        self.assertEqual([None, f"bytes={MB}-", f"bytes={2 * MB}-"], seen)

    # ---------- 3. 回退到 OpenClaw 包 ----------

    def test_a_newer_openclaw_package_is_installed_like_any_other_release(self):
        payload = b"openclaw-core-package" * (MB // 8)
        opener, calls = self.official(payload)
        updater = self.updater(opener)
        self.assertTrue(updater.prepare()["ready"])
        self.assertEqual(VERSION, updater.prepared["version"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), updater.prepared["sha256"])
        self.assertEqual(payload, self.staged.read_bytes())
        self.assertNotIn(LATEST_URL, calls)

    def test_an_openclaw_package_that_is_not_newer_is_not_offered(self):
        """回退靠「发一个版本号更高的 OpenClaw 包」，同号或更旧的包不当成更新，也不去下。"""
        for tag in ("2.5.1", "2.5.0"):
            with self.subTest(tag=tag):
                opener, calls = self.official(b"o" * (2 * MB), tag=tag)
                updater = self.updater(opener)
                self.assertFalse(updater.prepare()["ready"])
                self.assertNotIn(EXE_URL, calls)
                self.assertIsNone(updater.prepared)

    def test_a_release_build_still_requires_the_signature_for_an_openclaw_package(self):
        self.build_info({"guard": True, "channel": "release", "version": "2.5.1", "commit": "a" * 40})
        opener, calls = self.official(b"o" * (2 * MB))
        updater = self.updater(opener)
        with self.assertRaisesRegex(ValueError, GUARD_UPDATE_REFUSED):
            updater.prepare()
        self.assertIn(LATEST_URL, calls)
        self.assertNotIn(EXE_URL, calls, "签名不覆盖就不下包")
        self.assertIsNone(updater.prepared)


if __name__ == "__main__":
    unittest.main()
