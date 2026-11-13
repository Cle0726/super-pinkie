"""设定防护 A6：正式版的 Windows / Mac 更新器只装 latest.json 签名覆盖的安装包 / 提交；开发版行为不变。"""
import functools
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

from app import windows_desktop
from app.windows_desktop import GUARD_UPDATE_REFUSED, UPDATE_API_URL, WindowsUpdater

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "installer/guard/guard.mjs"
NODE = shutil.which("node")
KEYGEN = """
import crypto from 'node:crypto';
const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
process.stdout.write(JSON.stringify({pem: privateKey.export({type: 'pkcs8', format: 'pem'}), pub: publicKey.export({type: 'spki', format: 'der'}).toString('base64')}));
"""


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def keypair(directory):
    keys = json.loads(subprocess.run([NODE, "--input-type=module", "-e", KEYGEN], capture_output=True, text=True, check=True).stdout)
    pem = Path(directory) / "key.pem"
    pem.write_text(keys["pem"], encoding="utf-8")
    return pem, keys["pub"]


def signed_latest(directory, pem, latest):
    file = Path(directory) / "latest.json"
    file.write_text(json.dumps(latest), encoding="utf-8")
    subprocess.run([NODE, str(GUARD), "sign-latest", str(file), str(pem)], check=True)
    return json.loads(file.read_text(encoding="utf-8"))


@unittest.skipUnless(NODE, "node is required")
class WindowsSignedUpdateTest(unittest.TestCase):
    version = "9.8.7"
    name = f"super-pinkie-windows-{version}.exe"
    commit = "c" * 40

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.state = base / "state"
        patcher = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(self.state)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.pem, self.pub = keypair(base)
        # 测试公钥：只在这里注入，产品代码调用时不传。
        verify = mock.patch.object(windows_desktop, "verify_signed_latest",
                                   functools.partial(windows_desktop.verify_signed_latest, public_key=self.pub))
        verify.start()
        self.addCleanup(verify.stop)
        self.payload = b"pinkie-update" * 90000
        self.digest = hashlib.sha256(self.payload).hexdigest()

    def bundle(self, guard):
        root = Path(self.temporary.name) / ("release" if guard else "dev")
        (root / "installer/guard").mkdir(parents=True)
        shutil.copy(GUARD, root / "installer/guard/guard.mjs")
        (root / "VERSION").write_text("2.5.1", encoding="utf-8")
        (root / "build-info.json").write_text(json.dumps({"guard": guard, "channel": "release" if guard else "dev"}), encoding="utf-8")
        executable = root / "超級碧琪.exe"
        executable.write_bytes(b"old")
        return root, executable

    def updater(self, guard, latest):
        url = f"https://github.com/Cle0726/super-pinkie/releases/download/v{self.version}/{self.name}"
        release = {"tag_name": f"v{self.version}", "assets": [
            {"name": self.name, "browser_download_url": url}, {"name": self.name + ".sha256", "browser_download_url": url + ".sha256"}]}
        bodies = {UPDATE_API_URL: json.dumps(release).encode(), url: self.payload, url + ".sha256": f"{self.digest}  {self.name}".encode()}
        if latest is not None:
            bodies[f"https://github.com/Cle0726/super-pinkie/releases/download/v{self.version}/latest.json"] = json.dumps(latest).encode()

        def opener(request, timeout=0):
            if request.full_url not in bodies:
                raise OSError("404")
            return Response(bodies[request.full_url])

        root, executable = self.bundle(guard)
        return WindowsUpdater(root, opener=opener, executable=executable)

    def latest(self, sha=None):
        return {"version": self.version, "notes": "", "commit": self.commit,
                "assets": {self.name: {"sha256": sha or self.digest, "size": len(self.payload)}}}

    def test_release_build_installs_a_signed_package(self):
        latest = signed_latest(self.temporary.name, self.pem, self.latest())
        self.assertTrue(self.updater(True, latest).prepare()["ready"])

    def test_release_build_refuses_unsigned_or_tampered_manifest(self):
        for latest in (None, self.latest(),  # 没有 latest.json / 没签名
                       {**signed_latest(self.temporary.name, self.pem, self.latest()), "version": "9.8.8"}):
            with self.subTest(latest=bool(latest)):
                with self.assertRaisesRegex(ValueError, GUARD_UPDATE_REFUSED):
                    self.updater(True, latest).prepare()
                shutil.rmtree(Path(self.temporary.name) / "release")
        # 包被换了：签名清单里的哈希不是这个包的
        latest = signed_latest(self.temporary.name, self.pem, self.latest(sha="0" * 64))
        with self.assertRaisesRegex(ValueError, GUARD_UPDATE_REFUSED):
            self.updater(True, latest).prepare()
        self.assertFalse((self.state / "updates" / self.version / self.name).exists())

    def test_dev_build_is_unchanged(self):
        self.assertTrue(self.updater(False, None).prepare()["ready"])


@unittest.skipUnless(NODE, "node is required")
class MacSignedUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        env = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": str(base / "state"), "PINKIE_CONFIG_ROOT": str(base / "config")})
        env.start()
        self.addCleanup(env.stop)
        spec = importlib.util.spec_from_file_location("stage_guard", ROOT / "installer/macos/stage-git-update.py")
        self.stage = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.stage)
        self.pem, self.pub = keypair(base)
        self.bundle = base / "bundle"
        self.bundle.mkdir()
        self.stage.BUNDLE_ROOT = self.bundle
        script = ("import {verifyRelease} from %s; process.exit(verifyRelease(process.argv[1], process.argv[2], process.argv[3], %s) ? 0 : 1);"
                  % (json.dumps(GUARD.as_uri()), json.dumps(self.pub)))
        self.stage.verify_release_signature = lambda v, c, s, root=None: subprocess.run(
            [NODE, "--input-type=module", "-e", script, v, c, s]).returncode == 0
        self.commit = "d" * 40
        self.signed = signed_latest(base, self.pem, {"version": "9.9.9", "commit": self.commit, "assets": {"a.zip": {"sha256": "1" * 64}}})

    def release(self, guard):
        (self.bundle / "build-info.json").write_text(json.dumps({"guard": guard}), encoding="utf-8")

    def test_release_requires_the_signed_commit(self):
        self.release(True)
        self.stage.LATEST_SIGNED.clear()
        self.stage.remember_signed(self.signed, "9.9.9")
        self.assertEqual(self.stage.require_signed_target("v9.9.9", self.commit)["commit"], self.commit)
        with self.assertRaisesRegex(RuntimeError, "签名不对"):
            self.stage.require_signed_target("v9.9.9", "e" * 40)  # tag 被挪到别的提交
        with self.assertRaisesRegex(RuntimeError, "签名不对"):
            self.stage.require_signed_target(None, self.commit)  # 不是官方发布（跟分支走）
        self.stage.LATEST_SIGNED.clear()
        self.stage.remember_signed({**self.signed, "signature": self.signed["assetsSignature"]}, "9.9.9")
        with mock.patch.object(self.stage, "fetch_signed", lambda tag: None), self.assertRaisesRegex(RuntimeError, "签名不对"):
            self.stage.require_signed_target("v9.9.9", self.commit)

    def test_dev_build_skips_the_check(self):
        self.release(False)
        self.stage.LATEST_SIGNED.clear()
        self.assertIsNone(self.stage.require_signed_target(None, "e" * 40))

    def test_verified_signature_is_saved_for_the_local_rebuild(self):
        self.stage.UPDATES.mkdir(parents=True, exist_ok=True)
        self.stage.save_release_signature({"version": "9.9.9", "commit": self.commit, "signature": "x"})
        saved = json.loads((self.stage.UPDATES / "release-signature.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["commit"], self.commit)


if __name__ == "__main__":
    unittest.main()
