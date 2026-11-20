"""Read-only receipt for Metre role assets installed into an isolated profile."""
from hashlib import sha256
import json
from pathlib import Path


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def hashes(root, files):
    return {p.relative_to(root).as_posix(): digest(p) for p in sorted(files)}


def tree(root):
    return hashes(root, (p for p in root.rglob("*") if p.is_file() and p.name != ".DS_Store"))


def snapshot(resource_root, home):
    personas = Path(resource_root) / "personas"
    state = Path(home).resolve() / ".openclaw"
    roles = state / "workspace-roles"
    config = json.loads((state / "openclaw.json").read_text(encoding="utf-8-sig"))
    agents = config.get("agents", {})
    entries = agents.get("entries")
    role = entries.get("roles") if isinstance(entries, dict) else next(
        (a for a in agents.get("list", []) if a.get("id") == "roles"), None)
    if not isinstance(role, dict) or Path(role.get("workspace", "")).resolve() != roles.resolve() or not roles.is_dir():
        raise RuntimeError("installed Metre roles agent or its isolated workspace is missing")
    if role.get("memorySearch", {}).get("enabled") is not False or (roles / "memory").exists():
        raise RuntimeError("installed Metre roles workspace unexpectedly has memory")

    packaged, installed = personas / "metre/roles", state / "workspace-metre/roles"
    expected = hashes(packaged, (p for p in packaged.glob("*.md") if p.is_file()))
    actual = hashes(installed, (p for p in installed.glob("*.md") if p.is_file()))
    if len(expected) != 33 or expected != actual:
        missing = sorted(name for name in expected if name not in actual)
        content_differs = sorted(name for name in expected.keys() & actual.keys() if expected[name] != actual[name])
        extras = sorted(name for name in actual if name not in expected)
        raise RuntimeError(f"expected 33 byte-identical official Metre cards: packaged={len(expected)}, "
                           f"installed={len(actual)}, missing={missing}, changed={content_differs}, extra={extras}")

    playbooks = tree(personas / "project/playbooks")
    if not playbooks or playbooks != tree(roles / "playbooks"):
        raise RuntimeError("installed Metre roles playbooks do not match packaged originals")
    aesthetics = digest(personas / "thinking/AESTHETICS.md")
    if aesthetics != digest(roles / "refs/AESTHETICS.md"):
        raise RuntimeError("installed Metre roles visual guidance differs from the package")

    # An actual gateway may consume BOOTSTRAP.md and maintain its own
    # non-persona workspace metadata. Existing persona stubs must stay empty.
    stubs = ("AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "HEARTBEAT.md")
    if any(not (roles / name).is_file() or (roles / name).stat().st_size for name in stubs):
        raise RuntimeError("installed Metre roles persona placeholders are missing or non-empty")
    workspace_entries = {p.name for p in roles.iterdir()}
    extra = workspace_entries - {*stubs, "BOOTSTRAP.md", "openclaw-workspace-state.json", "playbooks", "refs"}
    if extra or (roles / "BOOTSTRAP.md").exists() and (roles / "BOOTSTRAP.md").stat().st_size:
        raise RuntimeError(f"unexpected Metre roles workspace content: {sorted(extra)}")
    return {"roleAgent": "roles", "workspace": "workspace-roles", "officialCount": len(actual),
            "officialSha256": actual, "playbookSha256": playbooks, "aestheticsSha256": aesthetics,
            "memoryPresent": False, "workspaceEntries": sorted(workspace_entries)}
