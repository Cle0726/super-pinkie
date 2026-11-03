"""Install the outbound first-person renderer without touching user content."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import time


PLUGIN_ID = "pinkie-first-person-renderer"
FILES = ("index.mjs", "openclaw.plugin.json", "package.json")


def _replace_preserving_file_flags(temp_name: str, target: Path) -> None:
    target_stat = target.stat()
    flags = getattr(target_stat, "st_flags", 0)
    immutable = getattr(__import__("stat"), "UF_IMMUTABLE", 0)
    if immutable and flags & immutable:
        os.chflags(target, flags & ~immutable)
    try:
        os.replace(temp_name, target)
        os.chmod(target, target_stat.st_mode & 0o777)
    finally:
        if flags and target.exists() and hasattr(os, "chflags"):
            os.chflags(target, flags)


def install(home: str | Path | None = None) -> bool:
    home = Path(home or Path.home())
    config = home / ".openclaw" / "openclaw.json"
    if not config.is_file():
        return False
    raw = config.read_bytes()
    data = json.loads(raw)
    plugins = data.setdefault("plugins", {})
    if plugins.get("enabled") is False or PLUGIN_ID in plugins.get("deny", []):
        raise RuntimeError("第一人称输出渲染插件被配置禁用；没有绕过用户配置。")

    source = Path(__file__).resolve().parent
    target = home / ".openclaw" / "extensions" / PLUGIN_ID
    assets_changed = any(
        not (target / name).is_file() or (target / name).read_bytes() != (source / name).read_bytes()
        for name in FILES
    )
    before = json.dumps(plugins, ensure_ascii=False, sort_keys=True)
    plugins.setdefault("entries", {}).setdefault(PLUGIN_ID, {})["enabled"] = True
    paths = plugins.setdefault("load", {}).setdefault("paths", [])
    if str(target) not in paths:
        paths.append(str(target))
    if isinstance(plugins.get("allow"), list) and PLUGIN_ID not in plugins["allow"]:
        plugins["allow"].append(PLUGIN_ID)
    config_changed = before != json.dumps(plugins, ensure_ascii=False, sort_keys=True)
    if not assets_changed and not config_changed:
        return False

    backup = home / "Library" / "Application Support" / "SuperPinkie" / "backups" / ("first-person-renderer-" + str(time.time_ns()))
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(config, backup / "openclaw.json")
    if target.exists():
        shutil.copytree(target, backup / PLUGIN_ID)
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in FILES:
        shutil.copy2(source / name, target / name)

    if config_changed:
        if config.read_bytes() != raw:
            raise RuntimeError("配置发生并发修改，没有覆盖；请重新安装。")
        fd, temporary = tempfile.mkstemp(dir=config.parent, prefix=".pinkie-first-person-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.chmod(temporary, 0o600)
            _replace_preserving_file_flags(temporary, config)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print("第一人称输出渲染插件已安装。")
    return True


if __name__ == "__main__":
    install()
