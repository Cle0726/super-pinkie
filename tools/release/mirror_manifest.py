#!/usr/bin/env python3
"""Write latest.json for the China update route: version, notes and the SHA-256 and size of every release file.

python3 tools/release/mirror_manifest.py <version> <release-notes.md> <dist dir> <out.json> [<commit>]
With <commit> (the 40-hex commit the release tag points to) the file also carries `commit`;
release.yml then runs `installer/guard/guard.mjs sign-latest` to add `signature` (version + commit)
and `assetsSignature` (version + commit + every asset's SHA-256). Updaters of release builds install
only what those signatures cover (settings guard A6); older updaters ignore the extra keys.
The Windows updater reads it through a GitHub download accelerator or the China bucket
(app/windows_desktop.py, update_mirrors / manifest_update).
"""
import hashlib
import json
import re
from pathlib import Path
import sys


def main(version, notes_path, dist, out, commit=""):
    assets = {}
    for path in sorted(Path(dist).iterdir()):
        if not path.is_file() or path.suffix == ".sha256" or path.name == "latest.json":
            continue
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        assets[path.name] = {"sha256": digest.hexdigest(), "size": path.stat().st_size}
    if not assets:
        raise SystemExit("no release files to describe")
    manifest = {"version": version.removeprefix("v"), "notes": Path(notes_path).read_text(encoding="utf-8-sig"), "assets": assets}
    if commit:
        if not re.fullmatch(r"[0-9a-f]{40}", commit.lower()):
            raise SystemExit("commit must be a 40-hex Git commit")
        manifest["commit"] = commit.lower()
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"latest.json: {len(assets)} files")


if __name__ == "__main__":
    main(*sys.argv[1:6])
