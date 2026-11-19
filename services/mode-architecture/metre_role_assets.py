"""Sync the on-disk assets of Metre roles, without registering an agent."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import tempfile
import time


ROLE_PLACEHOLDERS = (
    "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md",
    "TOOLS.md", "HEARTBEAT.md", "BOOTSTRAP.md",
)


def _linked(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    )


def _plain_dir(path: Path, *, create: bool = False) -> bool:
    if _linked(path):
        return False
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path.is_dir()


def _files(root: Path, *, tree: bool = False, suffix: str | None = None):
    if not _plain_dir(root):
        return
    for file in sorted(root.iterdir()):
        # For the card directory, don't even inspect entries such as user/.
        if suffix is not None and file.suffix != suffix:
            continue
        if _linked(file):
            continue
        if file.is_file():
            yield file
        elif tree and file.is_dir():
            yield from _files(file, tree=True)


def _backup_path(root: Path, relative: Path) -> Path:
    target = root / relative
    if target.exists() or _linked(target):
        target = target.with_name(f"{target.name}.{time.time_ns()}")
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def _install(source: Path | None, target: Path, backups: Path, relative: Path) -> bool:
    if _linked(target):
        return False
    content = source.read_bytes() if source is not None else b""
    if target.is_file():
        if target.read_bytes() == content:
            return False
        shutil.copy2(target, _backup_path(backups, relative))
    # Replace the file, not its contents in place (which could modify a
    # hard-linked user file). Keep the mode of bundled scripts on macOS.
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as out:
        temporary = Path(out.name)
    try:
        if source is not None:
            shutil.copy2(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def _sync_official_cards(personas: Path, state: Path, backups: Path) -> bool:
    source = personas / "metre" / "roles"
    # A legacy bundle may have no roles payload. Do not interpret it as a
    # deletion list. An existing, empty payload means all cards were retired.
    if not _plain_dir(source):
        return False
    metre = state / "workspace-metre"
    target = metre / "roles"
    if not _plain_dir(metre, create=True) or not _plain_dir(target, create=True):
        return False
    cards = {file.name: file for file in _files(source, suffix=".md")}
    changed = False
    for name, file in cards.items():
        changed |= _install(file, target / name, backups, Path("metre/roles") / name)
    # Only top-level .md files are managed. Never enter user/ or drafts/.
    # Use Windows path equality (case-insensitive) on Windows only.
    managed_names = {Path(name) for name in cards}
    for old in _files(target, suffix=".md"):
        if Path(old.name) not in managed_names:
            shutil.move(str(old), str(_backup_path(backups, Path("metre/roles") / old.name)))
            changed = True
    return changed


def _sync_workspace(personas: Path, state: Path, backups: Path) -> bool:
    workspace = state / "workspace-roles"
    was_present = workspace.is_dir()
    if not _plain_dir(workspace, create=True):
        return False
    changed = not was_present
    for name in ROLE_PLACEHOLDERS:
        changed |= _install(None, workspace / name, backups, Path("roles") / name)

    playbooks = personas / "project" / "playbooks"
    if _plain_dir(playbooks):
        for source in _files(playbooks, tree=True):
            relative = Path("playbooks") / source.relative_to(playbooks)
            parent = workspace
            for part in relative.parent.parts:
                parent /= part
                if not _plain_dir(parent, create=True):
                    break
            else:
                changed |= _install(source, workspace / relative, backups, Path("roles") / relative)

    aesthetics = personas / "thinking" / "AESTHETICS.md"
    if aesthetics.is_file() and not _linked(aesthetics) and _plain_dir(workspace / "refs", create=True):
        relative = Path("refs/AESTHETICS.md")
        changed |= _install(aesthetics, workspace / relative, backups, Path("roles") / relative)
    return changed


def sync_metre_role_assets(personas: Path, state: Path, backups: Path) -> bool:
    """Sync bundled assets only. User and draft cards are never inspected."""
    if not personas.is_dir() or not _plain_dir(state, create=True):
        return False
    changed = _sync_official_cards(personas, state, backups)
    changed |= _sync_workspace(personas, state, backups)
    return changed


if __name__ == "__main__":
    import sys

    sync_metre_role_assets(*map(Path, sys.argv[1:]))
