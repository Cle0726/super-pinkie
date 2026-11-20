import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from tools.release.release_assets import local_assets, require_not_older, verify_uploaded


class ReleaseAssetsTest(unittest.TestCase):
    tag = "v2.5.51"
    commit = "c" * 40

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.dist = root / "dist"
        self.dist.mkdir()
        self.latest = root / "latest.json"
        version = self.tag[1:]
        self.mac = f"super-pinkie-macos-{version}.zip"
        self.portable = f"super-pinkie-windows-{version}-portable.zip"
        manifest = {"version": version, "commit": self.commit, "assets": {}}
        for name in (self.mac, self.portable, f"super-pinkie-windows-{version}.exe",
                     f"super-pinkie-full-{version}.zip"):
            data = name.encode()
            (self.dist / name).write_bytes(data)
            checksum = hashlib.sha256(data).hexdigest()
            manifest["assets"][name] = {"size": len(data), "sha256": checksum}
            if name.startswith("super-pinkie-windows-"):
                (self.dist / f"{name}.sha256").write_text(f"{checksum}  {name}", encoding="ascii")
        self.latest.write_text(json.dumps(manifest), encoding="utf-8")

    def plan(self):
        return local_assets(self.tag, self.commit, self.dist, self.latest)

    def test_all_seven_files_agree_with_signed_index_and_github(self):
        plan = self.plan()
        self.assertEqual(len(plan), 7)
        rows = [dict(expected, name=name, state="uploaded") for name, expected in plan.items()]
        draft = {"tagName": self.tag, "isDraft": True, "isPrerelease": False, "assets": rows}
        verify_uploaded(self.tag, plan, draft)
        for patch in ({"state": "starter"}, {"size": 1}, {"digest": "sha256:wrong"}):
            with self.subTest(patch=patch), self.assertRaisesRegex(ValueError, "does not match"):
                verify_uploaded(self.tag, plan, {**draft, "assets": [{**rows[0], **patch}, *rows[1:]]})
        with self.assertRaisesRegex(ValueError, "exactly the expected"):
            verify_uploaded(self.tag, plan, {**draft, "assets": rows[1:]})
        with self.assertRaisesRegex(ValueError, "exactly the expected"):
            verify_uploaded(self.tag, plan, {**draft, "assets": rows + rows[:1]})

    def test_wrong_package_and_sidecar_block_publication(self):
        sidecar = self.dist / f"{self.portable}.sha256"
        sidecar.write_text("sha no longer matches", encoding="ascii")
        with self.assertRaisesRegex(ValueError, "bad Windows checksum"):
            self.plan()
        (self.dist / self.portable).write_bytes(b"incomplete package")
        with self.assertRaisesRegex(ValueError, "differs from signed index"):
            self.plan()

    def test_never_put_an_older_tag_back_on_latest(self):
        require_not_older(self.tag, [{"tagName": "v2.5.49"}, {"tagName": "v2.5.32"},
                                    {"tagName": self.tag}])
        with self.assertRaisesRegex(ValueError, "already public"):
            require_not_older(self.tag, [{"tagName": "v2.5.100"}])


if __name__ == "__main__":
    unittest.main()
