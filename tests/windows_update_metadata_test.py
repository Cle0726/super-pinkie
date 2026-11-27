"""B35: the update metadata gates in app/windows_update_guard.py, called directly.

manifest_update (latest.json on the mirror route), mirrored_release_update
(older releases without latest.json), guard_release_build and
verify_signed_latest decide which package the App will download and whether
a release build installs it. They were only reached through WindowsUpdater
with one or two shapes each; these pin what each one rejects.
"""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import windows_update_guard as guard  # noqa: E402

NAME = "super-pinkie-windows-9.9.9.exe"
PORTABLE = "super-pinkie-windows-9.9.9-portable.zip"
OFFICIAL = "https://github.com/Cle0726/super-pinkie/releases/download/v9.9.9/"
DIGEST = "ab" * 32


def mirror_url(version, name):
    return f"https://mirror.example/v{version}/{name}"


def manifest(**changes):
    value = {"version": "9.9.9", "notes": "fixes", "assets": {NAME: {"sha256": DIGEST}, PORTABLE: {"sha256": "cd" * 32}}}
    value.update(changes)
    return value


def release(assets=None, **changes):
    value = {
        "tag_name": "v9.9.9",
        "html_url": "https://github.com/Cle0726/super-pinkie/releases/tag/v9.9.9",
        "assets": assets if assets is not None else [
            {"name": NAME, "browser_download_url": OFFICIAL + NAME},
            {"name": NAME + ".sha256", "browser_download_url": OFFICIAL + NAME + ".sha256"},
        ],
    }
    value.update(changes)
    return value


class ManifestUpdateTest(unittest.TestCase):
    def test_a_newer_manifest_selects_the_package_and_keeps_the_official_checksum_first(self):
        selected = guard.manifest_update(manifest(), "2.5.0", mirror_url)
        self.assertEqual(selected["name"], NAME)
        self.assertEqual(selected["executableUrl"], mirror_url("9.9.9", NAME))
        self.assertEqual(selected["checksumUrl"], OFFICIAL + NAME + ".sha256")
        self.assertEqual(selected["sha256"], DIGEST)
        portable = guard.manifest_update(manifest(), "2.5.0", mirror_url, portable=True)
        self.assertEqual((portable["name"], portable["sha256"]), (PORTABLE, "cd" * 32))

    def test_an_upper_case_digest_is_normalised(self):
        selected = guard.manifest_update(manifest(assets={NAME: {"sha256": DIGEST.upper()}}), "2.5.0", mirror_url)
        self.assertEqual(selected["sha256"], DIGEST)

    def test_same_or_older_versions_are_not_offered(self):
        for version in ("9.9.9", "v9.9.9", "9.9.8", "1.0"):
            with self.subTest(version=version):
                self.assertIsNone(guard.manifest_update(manifest(version=version), "9.9.9", mirror_url))

    def test_a_package_without_a_valid_sha256_is_not_offered(self):
        for entry in ({}, {"sha256": ""}, {"sha256": "ab" * 31}, {"sha256": "zz" * 32}, {"sha256": DIGEST + "00"}, "x", None):
            with self.subTest(entry=entry):
                self.assertIsNone(guard.manifest_update(manifest(assets={NAME: entry}), "2.5.0", mirror_url))

    def test_assets_that_are_missing_or_not_an_object_offer_nothing(self):
        for assets in (None, [], "x", {}, {PORTABLE: {"sha256": DIGEST}}):
            with self.subTest(assets=assets):
                self.assertIsNone(guard.manifest_update(manifest(assets=assets), "2.5.0", mirror_url))

    def test_a_manifest_that_is_not_an_object_offers_nothing(self):
        for value in (None, [], "9.9.9", 9):
            with self.subTest(value=value):
                self.assertIsNone(guard.manifest_update(value, "2.5.0", mirror_url))

    def test_a_version_that_cannot_be_parsed_raises_value_error_for_the_caller_to_skip(self):
        # WindowsUpdater._check_mirror catches ValueError and tries the next mirror.
        for version in ("latest", "1.2.3.4.5", "9.9.9-beta"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                guard.manifest_update(manifest(version=version), "2.5.0", mirror_url)


class MirroredReleaseUpdateTest(unittest.TestCase):
    def test_an_official_release_is_downloaded_from_the_mirror(self):
        selected = guard.mirrored_release_update(release(), "2.5.0", mirror_url)
        self.assertEqual(selected["executableUrl"], mirror_url("9.9.9", NAME))
        self.assertEqual(selected["checksumUrl"], OFFICIAL + NAME + ".sha256")
        self.assertEqual(selected["metadataSource"], "release-api")
        self.assertNotIn("sha256", selected)

    def test_the_release_asset_digest_is_used_when_it_is_well_formed(self):
        assets = release()["assets"]
        assets[0] = {**assets[0], "digest": "sha256:" + DIGEST.upper()}
        self.assertEqual(guard.mirrored_release_update(release(assets), "2.5.0", mirror_url)["sha256"], DIGEST)

    def test_a_malformed_release_asset_digest_is_refused(self):
        for digest in ("sha256:" + "ab" * 31, "md5:" + DIGEST, DIGEST, "sha256:" + "zz" * 32):
            assets = release()["assets"]
            assets[0] = {**assets[0], "digest": digest}
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                guard.mirrored_release_update(release(assets), "2.5.0", mirror_url)

    def test_draft_prerelease_and_non_object_metadata_are_refused(self):
        for value in (release(draft=True), release(prerelease=True), None, [], "v9.9.9"):
            with self.subTest(value=str(value)[:40]), self.assertRaises(ValueError):
                guard.mirrored_release_update(value, "2.5.0", mirror_url)

    def test_same_or_older_release_means_up_to_date(self):
        self.assertIsNone(guard.mirrored_release_update(release(), "9.9.9", mirror_url))
        self.assertIsNone(guard.mirrored_release_update(release(tag_name="v9.9.8"), "9.9.9", mirror_url))

    def test_assets_from_another_repository_or_tag_are_refused(self):
        for base in ("https://github.com/someone/super-pinkie/releases/download/v9.9.9/",
                     "https://github.com/Cle0726/super-pinkie/releases/download/v9.9.8/",
                     "https://objects.githubusercontent.com/v9.9.9/"):
            assets = [{"name": NAME, "browser_download_url": base + NAME},
                      {"name": NAME + ".sha256", "browser_download_url": base + NAME + ".sha256"}]
            with self.subTest(base=base), self.assertRaises(ValueError):
                guard.mirrored_release_update(release(assets), "2.5.0", mirror_url)

    def test_a_newer_release_without_package_and_checksum_is_refused(self):
        for assets in ([{"name": NAME, "browser_download_url": OFFICIAL + NAME}],
                       [{"name": NAME + ".sha256", "browser_download_url": OFFICIAL + NAME + ".sha256"}],
                       [{"name": NAME, "browser_download_url": "http://github.com/x"},
                        {"name": NAME + ".sha256", "browser_download_url": OFFICIAL + NAME + ".sha256"}]):
            with self.subTest(assets=assets), self.assertRaises(ValueError):
                guard.mirrored_release_update(release(assets), "2.5.0", mirror_url)


class ReleaseBuildAndSignatureTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="pinkie-update-meta-")
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_only_a_literal_true_guard_in_build_info_is_a_release_build(self):
        info = self.root / "build-info.json"
        self.assertFalse(guard.guard_release_build(self.root))
        for raw, expected in (('{"guard": true}', True), ('﻿{"guard": true}', True), ('{"guard": "true"}', False),
                              ('{"guard": 1}', False), ('{"guard": false}', False), ("{}", False), ("[]", False),
                              ("not json", False), ("", False)):
            with self.subTest(raw=raw):
                info.write_text(raw, encoding="utf-8")
                self.assertIs(guard.guard_release_build(self.root), expected)

    def bundle(self):
        node = self.root / "runtime" / "bin" / "node.exe"
        script = self.root / "installer" / "guard" / "guard.mjs"
        for path in (node, script):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("", encoding="utf-8")
        return node, script

    def test_signature_check_runs_guard_verify_latest_and_follows_its_exit_code(self):
        node, script = self.bundle()
        seen = []

        def run(command, **kwargs):
            seen.append((command, Path(command[3]).read_text(encoding="utf-8")))
            return subprocess.CompletedProcess(command, 0 if len(seen) == 1 else 1)

        with mock.patch.object(guard.subprocess, "run", side_effect=run):
            self.assertTrue(guard.verify_signed_latest(self.root, {"version": "9.9.9"}, NAME, DIGEST))
            self.assertFalse(guard.verify_signed_latest(self.root, {"version": "9.9.9"}, NAME, DIGEST))
        command, written = seen[0]
        self.assertEqual(command[:3], [str(node), str(script), "verify-latest"])
        self.assertEqual(command[4:], ["--asset", NAME, "--sha256", DIGEST])
        self.assertEqual(written, '{"version": "9.9.9"}')
        self.assertFalse(Path(command[3]).exists(), "the temporary latest.json must be removed")

    def test_signature_check_fails_closed(self):
        self.assertFalse(guard.verify_signed_latest(self.root, {"version": "9.9.9"}, NAME, DIGEST), "no guard.mjs")
        self.bundle()
        for latest in (None, [], "x"):
            with self.subTest(latest=latest), mock.patch.object(
                    guard.subprocess, "run", side_effect=AssertionError("must not run")):
                self.assertFalse(guard.verify_signed_latest(self.root, latest, NAME, DIGEST))
        for error in (subprocess.TimeoutExpired("node", 30), OSError("no node")):
            with self.subTest(error=type(error).__name__), mock.patch.object(guard.subprocess, "run", side_effect=error):
                self.assertFalse(guard.verify_signed_latest(self.root, {"version": "9.9.9"}, NAME, DIGEST))


if __name__ == "__main__":
    unittest.main()
