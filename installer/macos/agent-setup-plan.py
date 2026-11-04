"""Identify strictly unchanged bundled agent identities; uncertainty means redo setup."""

import json
import os
from pathlib import Path
import re
import sys


FIELDS = ("name", "theme", "emoji", "avatar")
CANONICAL = re.compile(r"^\s*-\s*\*\*(name|theme|emoji|avatar):\*\*\s+(.+?)\s*$", re.I)


def unchanged_agents(home, runtime_package, openclaw_bin):
    # Only the pinned runtime's set-identity semantics are verified here. If
    # OpenClaw resolves a different state/config path, let its own CLI decide.
    if any(os.environ.get(key) for key in (
        "OPENCLAW_HOME", "OPENCLAW_PROFILE", "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH"
    )):
        return []
    try:
        expected_entry = runtime_package.parent / "openclaw.mjs"
        if openclaw_bin.resolve(strict=True) != expected_entry.resolve(strict=True):
            return []
        if json.loads(runtime_package.read_text(encoding="utf-8"))["version"] != "2026.7.1-2":
            return []
        raw = (home / ".openclaw/openclaw.json").read_text(encoding="utf-8")
        # Includes or environment substitutions may alter the resolved config.
        if '"$include"' in raw or "${" in raw:
            return []
        entries = json.loads(raw)["agents"]["list"]
        if not isinstance(entries, list):
            return []
    except (OSError, ValueError, KeyError, TypeError):
        return []

    unchanged = []
    for agent in ("project", "learning"):
        matching = [entry for entry in entries if isinstance(entry, dict) and entry.get("id") == agent]
        if len(matching) != 1 or not isinstance(matching[0].get("identity"), dict):
            continue
        try:
            lines = (home / f".openclaw/workspace-{agent}/IDENTITY.md").read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError):
            continue
        parsed = {}
        valid = True
        for line in lines:
            cleaned = re.sub(r"^\s*-\s*", "", line.strip())
            label, separator, _ = cleaned.partition(":")
            label = re.sub(r"[*_`]", "", label).strip().lower()
            if not separator or label not in FIELDS:
                continue
            match = CANONICAL.fullmatch(line)
            if not match or label in parsed:
                valid = False
                break
            value = match.group(2).strip()
            # The upstream parser trims these markers; defer ambiguous values.
            if not value or value[0] in "*_`" or value[-1] in "*_`":
                valid = False
                break
            parsed[label] = value
        identity = matching[0]["identity"]
        if valid and all(field in parsed and identity.get(field) == parsed[field] for field in FIELDS):
            unchanged.append(agent)
    return unchanged


if __name__ == "__main__":
    print(" ".join(unchanged_agents(Path.home(), Path(sys.argv[1]), Path(sys.argv[2]))))
