#!/usr/bin/env python3
"""Write personas/shipped-hashes.txt: every version of every persona file we ever shipped.

Installers use it to update persona files safely on existing machines: a file whose
content still matches one of these versions was never edited by its owner, so it
can be replaced by the new release (after a backup); anything else is the user's
own work and is left alone.

Hashes are SHA-256 of the file bytes with every carriage return removed, so the
same file checked out with LF (macOS) or CRLF (Windows) hashes the same.

Run from the repository after changing anything under personas/:
    python3 tools/personas/shipped_hashes.py          # rewrite the list
    python3 tools/personas/shipped_hashes.py --check  # exit 1 if it is out of date
"""
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERSONAS = ROOT / "personas"
OUTPUT = PERSONAS / "shipped-hashes.txt"


def digest(data):
    return hashlib.sha256(data.replace(b"\r", b"")).hexdigest()


def git(*args, data=None):
    return subprocess.run(["git", "-C", str(ROOT), *args], input=data, capture_output=True, check=True).stdout


def history_entries():
    """(sha, mode/rel) for every blob that ever sat under personas/ on any branch."""
    blobs = {}
    for commit in git("rev-list", "--all", "--", "personas").decode().split():
        for line in git("-c", "core.quotepath=off", "ls-tree", "-r", commit, "--", "personas").decode().splitlines():
            meta, path = line.split("\t", 1)
            _, kind, blob = meta.split()
            if kind == "blob" and path.count("/") >= 2:  # files inside a mode folder only
                blobs.setdefault(blob, set()).add(path[len("personas/"):])
    if not blobs:
        return set()
    # One cat-file process for all blobs: "<sha> blob <size>\n<bytes>\n" per object.
    out = git("cat-file", "--batch", data="\n".join(blobs).encode() + b"\n")
    entries, pos = set(), 0
    while pos < len(out):
        header_end = out.index(b"\n", pos)
        blob, _, size = out[pos:header_end].decode().split()
        body = out[header_end + 1:header_end + 1 + int(size)]
        pos = header_end + 1 + int(size) + 1
        for rel in blobs[blob]:
            entries.add((digest(body), rel))
    return entries


def current_entries():
    return {
        (digest(path.read_bytes()), path.relative_to(PERSONAS).as_posix())
        for path in PERSONAS.rglob("*")
        if path.is_file() and path != OUTPUT and "/" in path.relative_to(PERSONAS).as_posix()
    }


def main():
    current = current_entries()
    if "--check" in sys.argv:
        listed = set()
        if OUTPUT.is_file():
            listed = {tuple(line.split(" ", 1)) for line in OUTPUT.read_text(encoding="utf-8").splitlines() if line}
        missing = sorted(rel for sha, rel in current if (sha, rel) not in listed)
        if missing:
            print("personas/shipped-hashes.txt is out of date; run tools/personas/shipped_hashes.py. Missing:")
            print("\n".join("  " + rel for rel in missing))
            return 1
        return 0
    entries = sorted(history_entries() | current, key=lambda item: (item[1], item[0]))
    OUTPUT.write_text("".join(f"{sha} {rel}\n" for sha, rel in entries), encoding="utf-8", newline="\n")
    print(f"{len(entries)} entries -> {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
