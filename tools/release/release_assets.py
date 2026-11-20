"""Validate the complete desktop release before a draft can become public."""

import hashlib
import json
from pathlib import Path
import re
import sys


def version_tuple(tag):
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", tag)
    return tuple(map(int, match.groups())) if match else None


def local_assets(tag, commit, dist, latest):
    version = tag.removeprefix("v")
    if version_tuple(tag) is None:
        raise ValueError("expected an exact vMAJOR.MINOR.PATCH release tag")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("expected the release commit SHA")
    manifest = json.loads(latest.read_text(encoding="utf-8"))
    if manifest.get("version") != version or manifest.get("commit") != commit:
        raise ValueError("signed index is not for this version and commit")
    packages = (
        f"super-pinkie-full-{version}.zip",
        f"super-pinkie-macos-{version}.zip",
        f"super-pinkie-windows-{version}.exe",
        f"super-pinkie-windows-{version}-portable.zip",
    )
    records = manifest.get("assets")
    if not isinstance(records, dict) or set(records) != set(packages):
        raise ValueError("signed index must list source, Mac, Windows exe and Windows portable packages")

    upload = {}

    def add(path):
        with path.open("rb") as file:
            sha256 = hashlib.file_digest(file, "sha256").hexdigest()
        size = path.stat().st_size
        if size <= 0:
            raise ValueError(f"empty asset: {path.name}")
        upload[path.name] = {"path": str(path), "size": size, "digest": f"sha256:{sha256}"}
        return sha256, size

    for name in packages:
        sha256, size = add(dist / name)
        if records[name] != {"sha256": sha256, "size": size}:
            raise ValueError(f"package differs from signed index: {name}")
        if name.startswith("super-pinkie-windows-"):
            sidecar = dist / f"{name}.sha256"
            if sidecar.read_text(encoding="ascii").strip() != f"{sha256}  {name}":
                raise ValueError(f"bad Windows checksum: {sidecar.name}")
            add(sidecar)
    if latest.name != "latest.json":
        raise ValueError("the signed index must upload as latest.json")
    add(latest)
    return upload


def verify_uploaded(tag, expected, release):
    if release.get("tagName") != tag or release.get("isPrerelease") is not False:
        raise ValueError("GitHub release is not the requested stable tag")
    if not isinstance(release.get("isDraft"), bool):
        raise ValueError("missing GitHub draft state")
    rows = release.get("assets", [])
    assets = {row["name"]: row for row in rows}
    if len(assets) != len(rows) or set(assets) != set(expected):
        raise ValueError("GitHub release does not have exactly the expected assets")
    for name, row in assets.items():
        if (row.get("state") != "uploaded" or row.get("digest") != expected[name]["digest"]
                or row.get("size") != expected[name]["size"]):
            raise ValueError(f"GitHub upload does not match local bytes: {name}")


def require_not_older(tag, releases):
    requested = version_tuple(tag)
    if requested is None:
        raise ValueError("expected a numeric version tag")
    for release in releases:
        published = release["tagName"]
        existing = version_tuple(published)
        if existing and existing > requested:
            raise ValueError(f"refusing to replace the update channel with {tag}; {published} is already public")


def main(command, *args):
    def read(path):
        return json.loads(Path(path).read_text(encoding="utf-8"))

    if command == "plan":
        tag, commit, dist, latest = args
        print(json.dumps(local_assets(tag, commit, Path(dist), Path(latest))))
    elif command == "verify-upload":
        tag, plan, remote = args
        verify_uploaded(tag, read(plan), read(remote))
        print(f"{tag}: every uploaded asset matches the locally verified release")
    elif command == "not-older":
        tag, releases = args
        require_not_older(tag, read(releases))
    else:
        raise ValueError("unknown release asset command")


if __name__ == "__main__":
    try:
        main(*sys.argv[1:])
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise SystemExit(str(error)) from None
