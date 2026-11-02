"""Refresh the Mac runtime snapshot that the Windows package lays over OpenClaw.

build-win.ps1 does not run the runtime patches; it copies the patched OpenClaw
files out of desktop/windows/mac-runtime instead.  That snapshot was taken once
(2026-10-31), so every Mac fix that patched OpenClaw afterwards -- history image
thumbnails, the context panel's breakdown, the work-first media gate -- silently
never reached Windows.  This tool re-derives the snapshot from the installed Mac
app: every backend file that differs from the pinned, unpatched OpenClaw.

  python tools/windows-package/refresh_mac_runtime.py --check   # stale? exit 1
  python tools/windows-package/refresh_mac_runtime.py           # update snapshot

The browser UI (dist/control-ui) is not taken from here: ui/ and ui/runtime own
it and tools/ui-parity/bundle.py installs it.  services/ entries carry Windows
fixes and are merged by hand; --check only lists the ones that differ.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "desktop/windows/mac-runtime"
SUMS = SNAPSHOT / "SHA256SUMS"
MAC_RUNTIME = Path("/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime")
MAC_EXTENSIONS = Path.home() / ".openclaw/extensions"
SERVICE_DIRS = {
    "mode-architecture": "pinkie-mode-architecture",
    "messaging-connect": "pinkie-messaging-connect",
    "project-scope": "pinkie-project-scope",
    "wechat-connect": "pinkie-wechat-connect",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_sums():
    entries = {}
    for line in SUMS.read_text(encoding="utf-8").splitlines():
        if line.strip():
            value, rel = line.split("  ", 1)
            entries[rel.strip()] = value.lower()
    return entries


def pristine_openclaw(version, workdir):
    """Unpack the pinned OpenClaw package exactly as npm publishes it."""
    subprocess.run(["npm", "pack", f"openclaw@{version}", "--silent"], cwd=workdir, check=True,
                   stdout=subprocess.DEVNULL)
    archive = next(Path(workdir).glob("openclaw-*.tgz"))
    with tarfile.open(archive) as bundle:
        bundle.extractall(workdir, filter="data")
    return Path(workdir) / "package"


def owned(rel):
    """Snapshot entries this tool manages; others (sw.js, ui/preview) are hand-kept."""
    rel = rel.removeprefix("openclaw/")
    return rel == "openclaw.mjs" or (rel.startswith("dist/") and not rel.startswith("dist/control-ui/"))


def backend_files(openclaw):
    """Files the snapshot may carry: dist (minus the browser UI) and the entry."""
    yield openclaw / "openclaw.mjs"
    for path in sorted((openclaw / "dist").rglob("*")):
        rel = path.relative_to(openclaw).as_posix()
        if not path.is_file() or rel.startswith("dist/control-ui/") or ".bak" in path.name:
            continue
        yield path


def plan(mac_openclaw, pristine):
    """Map snapshot paths to Mac files for every patched or added backend file."""
    wanted = {}
    for path in backend_files(mac_openclaw):
        rel = path.relative_to(mac_openclaw).as_posix()
        stock = pristine / rel
        if not stock.is_file() or stock.read_bytes() != path.read_bytes():
            wanted["openclaw/" + rel] = path
    return wanted


def service_drift(sums):
    drift = []
    for rel, value in sums.items():
        if not rel.startswith("services/"):
            continue
        service, name = rel[len("services/"):].split("/", 1)
        live = MAC_EXTENSIONS / SERVICE_DIRS.get(service, "") / name
        if service in SERVICE_DIRS and live.is_file() and digest(live) != value:
            drift.append(rel)
    return drift


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mac-runtime", type=Path, default=MAC_RUNTIME)
    parser.add_argument("--pristine", type=Path, help="an unpacked openclaw package (default: npm pack)")
    parser.add_argument("--check", action="store_true", help="report drift and exit 1 instead of writing")
    args = parser.parse_args(argv)

    mac_openclaw = args.mac_runtime / "openclaw"
    if not (mac_openclaw / "openclaw.mjs").is_file():
        sys.exit(f"no installed Mac runtime at {args.mac_runtime}")
    manifest = json.loads((ROOT / "desktop/windows/runtime-manifest.json").read_text(encoding="utf-8"))
    mac_version = json.loads((mac_openclaw / "package.json").read_text(encoding="utf-8"))["version"]
    if mac_version != manifest["openclaw"]:
        sys.exit(f"the Mac app runs OpenClaw {mac_version}; Windows pins {manifest['openclaw']}")

    sums = read_sums()
    with tempfile.TemporaryDirectory() as workdir:
        pristine = args.pristine or pristine_openclaw(manifest["openclaw"], workdir)
        wanted = plan(mac_openclaw, pristine)

    current = {rel: value for rel, value in sums.items() if rel.startswith("openclaw/") and owned(rel)}
    added = sorted(rel for rel in wanted if rel not in current)
    changed = sorted(rel for rel in wanted if rel in current and digest(wanted[rel]) != current[rel])
    removed = sorted(rel for rel in current if rel not in wanted)
    for label, rows in (("add", added), ("update", changed), ("drop", removed)):
        for rel in rows:
            print(f"{label:6} {rel}")
    services = service_drift(sums)
    for rel in services:
        print(f"review {rel}  (differs from the installed Mac extension; Windows fixes live here, so merge by hand)")

    if args.check:
        return 1 if added or changed or removed else 0
    for rel in removed:
        (SNAPSHOT / rel).unlink(missing_ok=True)
        sums.pop(rel)
    for rel in added + changed:
        target = SNAPSHOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(wanted[rel], target)
        sums[rel] = digest(target)
    # Keep the existing line order so a refresh shows up as a small diff.
    SUMS.write_text("".join(f"{value}  {rel}\n" for rel, value in sums.items()), encoding="utf-8")
    print(f"snapshot refreshed: {len(added)} added, {len(changed)} updated, {len(removed)} dropped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
