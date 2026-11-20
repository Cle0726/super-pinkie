"""Identify strictly unchanged bundled agent identities; uncertainty means redo setup."""

import json
import os
from pathlib import Path
import re
import sys
import tempfile


FIELDS = ("name", "theme", "emoji", "avatar")
CANONICAL = re.compile(r"^\s*-\s*\*\*(name|theme|emoji|avatar):\*\*\s+(.+?)\s*$", re.I)
BUNDLED_MODES = {
    "main": "workspace", "project": "workspace-project", "thinking": "workspace-thinking",
    "learning": "workspace-learning", "unrestricted": "workspace-unrestricted", "metre": "workspace-metre",
}


def stage_bundled_agents(config_path, state_dir=None):
    """Register every shipped mode before the managed Gateway can load its plugins."""
    config_path = Path(config_path)
    workspace_root = Path(state_dir) if state_dir is not None else config_path.parent
    config_path.parent.mkdir(parents=True, exist_ok=True)
    raw = config_path.read_bytes() if config_path.exists() else None
    config = json.loads(raw.decode('utf-8-sig')) if raw else {}
    entries = config.setdefault('agents', {}).setdefault('list', [])
    if not isinstance(entries, list):
        raise ValueError('agents.list is not a list; the config has not been changed')
    existing = {entry.get('id'): entry for entry in entries
                if isinstance(entry, dict) and isinstance(entry.get('id'), str)}
    changed = False
    for agent, folder in BUNDLED_MODES.items():
        workspace = str(workspace_root / folder)
        if agent not in existing:
            entry = {'id': agent, 'workspace': workspace}
            if agent != 'main':
                entry['name'] = agent
            entries.append(entry)
            existing[agent] = entry
            changed = True
        elif not existing[agent].get('workspace'):
            existing[agent]['workspace'] = workspace
            changed = True
    main = existing['main']
    if entries[0] is not main:
        entries.remove(main)
        entries.insert(0, main)
        changed = True
    if not changed:
        return False
    # The bundled personas already supply IDENTITY.md. Avoid launching the
    # CLI's per-agent config mutations just to rediscover those identities.
    fd, temporary = tempfile.mkstemp(prefix='.pinkie-mode-agents-', dir=config_path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            json.dump(config, file, ensure_ascii=False, indent=2)
            file.write('\n')
        if (config_path.read_bytes() if config_path.exists() else None) != raw:
            raise RuntimeError('openclaw.json changed during agent setup; leaving it untouched')
        os.replace(temporary, config_path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return True


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
    for agent in ("project", "learning", "metre"):
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
        required = ("name", "theme") if agent == "metre" else FIELDS
        if valid and all(field in parsed for field in required) and all(
            identity.get(field) == parsed.get(field) for field in FIELDS
        ):
            unchanged.append(agent)
    return unchanged


if __name__ == "__main__":
    if sys.argv[1] == '--stage':
        stage_bundled_agents(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        print(" ".join(unchanged_agents(Path.home(), Path(sys.argv[1]), Path(sys.argv[2]))))
