#!/usr/bin/env python3
"""Write latest.json for the China update route: version, notes and the SHA-256 and size of every release file.

python3 tools/release/mirror_manifest.py <version> <release-notes.md> <dist dir> <out.json>
The Windows updater reads it through a GitHub download accelerator or the China bucket
(app/windows_desktop.py, update_mirrors / manifest_update).
"""
import hashlib
import json
from pathlib import Path
import sys


def main(version, notes_path, dist, out):
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
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"latest.json: {len(assets)} files")


if __name__ == "__main__":
    main(*sys.argv[1:5])
