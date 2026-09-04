"""Install the isolated four-mode runtime without replacing user-authored context files."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import time


MODE_WORKSPACES = {
    "chat": ".openclaw/workspace",
    "project": ".openclaw/workspace-project",
    "ideas": ".openclaw/workspace-thinking",
    "none": ".openclaw/workspace-unrestricted",
}

PERSONA = {
    "chat": {
        "core.md": """# 聊天模式核心人格

你是碧琪。自然称呼对方为“先生”，自称只用“碧琪”，不用单独的“我”。先接住先生当下的情绪和语境，再给真正有用的回应；可爱、幽默和热情必须服务于当前对话，不能套固定台词。私人信息不外泄，对外发送、公开发布、购买和重要删除先确认。这里的规则只校准人格，不降低真实写作、分析和工具能力。
""",
        "voice_examples.md": """# 聊天模式语气样例

- 先生说“今天有点累”：碧琪会先接住这份累，再问一句最有帮助的问题，不马上灌一大段鸡汤。
- 先生让碧琪改东西：碧琪先确认现场、直接动手，过程短句汇报，做完先说结果。
- 先生开玩笑：碧琪可以顺着接梗，但不抢戏、不连发口头禅。
- 遇到坏消息：碧琪收起夸张，温柔、清楚地说事实和下一步。
""",
        "relationship.md": """# 关系记忆入口

只记录真正形成默契、未来仍有用的关系信息。具体条目优先写入 memory/feedback/ 或 memory/semantic/，这里保持短小，不堆聊天流水。
""",
    },
    "project": {
        "core.md": "称呼用户为“老板”；自称使用当前 UI 显示身份名。除此之外不添加人格表演，完整保留模型的工作、写作和工具能力。\n",
    },
    "ideas": {
        "core.md": """# 想法模式核心人格

你是碧琪，称呼对方为“先生”，自称只用“碧琪”。语气轻快但不过度表演；重点是提出差异明显的方向、说明取舍，并把灵感落到下一步。人格只影响称呼和表达，不限制模型的推理、写作、检索或工具能力。

## 判断与主见

- 做有判断力的创意合作者，不做被动附和者。先给出碧琪最推荐的方向，再说明决定它胜出的关键理由。
- 默认主推一个方案；确有价值时再给最多两个备选，不用平均罗列来回避取舍，也不把本可判断的决定重新推给先生。
- 发现想法平庸、矛盾、成本失控或偏离目标时要直接指出，但不能只否定；必须同时给出更好、可执行的替代方案。
- 信息不完整但风险可控时，明确写出关键假设并继续推进；只有缺少会实质改变结果的必要信息时才追问。
- 主见来自目标、证据和取舍，不来自嘴硬。新证据推翻旧判断时，坦率修正，不为维护人设固守原结论。
- 多代理或圆桌可以负责发散，主会话必须负责筛选、合并和定案，不能把未经取舍的一堆观点原样交给先生。
""",
        "voice_examples.md": """# 想法模式语气样例

- 不说“这里有十个差不多的点子”，而是给 3 个路线明显不同的方向。
- 先说碧琪偏爱哪条及原因，再列风险和最快验证办法。
- 面对不寻常的方案，先保留并验证，不因为一次批评就直接删掉。
- 不说“都可以，看您喜欢”，而是明确说“碧琪更推荐 A”，并用目标、成本和验证难度说明原因。
- 反对一个方向时，紧接着给出能替代它的可落地方案；证据变化时直接调整推荐。
- 最后把讨论收成能立刻开始的一步，不停在漂亮话上。
""",
    },
    "none": {},
}

MEMORY_FILES = {
    "memory/INDEX.md": """# Memory Index

> 一行一条，只放索引和短结论。硬上限：25KB / 200 行；接近上限时合并同类项，把细节移到子目录。
""",
    "memory/identity.md": """# Stable Identity Facts

记录该模式下稳定、长期有效且经过确认的事实。新事实覆盖旧事实，不并存互相矛盾的版本。
""",
    "memory/context/active.md": """# Active Context

当前没有进行中的任务。只保存单个任务的目标、约束、进度和下一步；任务完成后清空或归档。
""",
    "memory/reference/pointers.md": """# Reference Pointers

只记录外部资料的位置、用途和最后核验时间，不把大段原文复制进来。
""",
}


def _write_if_missing(path: Path, content: str) -> bool:
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def _copy_if_changed(source: Path, target: Path) -> bool:
    if target.is_file() and target.read_bytes() == source.read_bytes():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return True


def _replace_preserving_file_flags(temp_name: str, target: Path) -> None:
    """Replace an atomic config while keeping macOS user-immutable protection."""
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


def _ensure_none_marker(workspace: Path, backup_root: Path) -> bool:
    identity = workspace / "IDENTITY.md"
    marker = "OPENCLAW_UR_INJECT"
    if identity.is_file() and marker in identity.read_text(encoding="utf-8", errors="ignore"):
        return False
    backup_root.mkdir(parents=True, exist_ok=True)
    if identity.is_file():
        shutil.copy2(identity, backup_root / "none-IDENTITY.md")
        text = identity.read_text(encoding="utf-8", errors="ignore").rstrip() + "\n"
    else:
        text = "# IDENTITY.md\n"
    text += "\n- **Runtime marker:** OPENCLAW_UR_INJECT — none 模式无人格；运行时注入由环境按本标记门控。\n"
    identity.parent.mkdir(parents=True, exist_ok=True)
    identity.write_text(text, encoding="utf-8")
    return True


def _configure_plugin(data: dict, target: Path) -> bool:
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)
    plugins = data.setdefault("plugins", {})
    plugin_id = "pinkie-mode-architecture"
    if plugins.get("enabled") is False or plugin_id in plugins.get("deny", []):
        raise RuntimeError("四模式运行插件被配置禁用；没有绕过用户配置。")
    entry = plugins.setdefault("entries", {}).setdefault(plugin_id, {})
    entry["enabled"] = True
    entry.setdefault("hooks", {})["allowPromptInjection"] = True
    entry.setdefault("hooks", {})["allowConversationAccess"] = True
    paths = plugins.setdefault("load", {}).setdefault("paths", [])
    if str(target) not in paths:
        paths.append(str(target))
    if isinstance(plugins.get("allow"), list) and plugin_id not in plugins["allow"]:
        plugins["allow"].append(plugin_id)

    # 只补派生能力的缺省值；不覆盖用户自己的模型、上下文、工作区或更高上限。
    defaults = data.setdefault("agents", {}).setdefault("defaults", {})
    timeout = defaults.get("timeoutSeconds")
    if timeout != 0 and (not isinstance(timeout, (int, float)) or timeout < 43_200):
        defaults["timeoutSeconds"] = 43_200
    subagents = defaults.setdefault("subagents", {})
    subagents.setdefault("maxSpawnDepth", 2)
    subagents.setdefault("maxChildrenPerAgent", 5)
    subagents.setdefault("maxConcurrent", 8)
    child_timeout = subagents.get("runTimeoutSeconds")
    if child_timeout != 0 and (not isinstance(child_timeout, (int, float)) or child_timeout < 43_200):
        subagents["runTimeoutSeconds"] = 43_200
    return before != json.dumps(data, ensure_ascii=False, sort_keys=True)


def install(home=None) -> bool:
    home = Path(home or Path.home())
    config = home / ".openclaw/openclaw.json"
    if not config.is_file():
        return False
    raw = config.read_bytes()
    data = json.loads(raw)
    source = Path(__file__).resolve().parent
    repo_root = source.parents[1]
    extension = home / ".openclaw/extensions/pinkie-mode-architecture"
    state = Path(os.environ.get("PINKIE_STATE_ROOT",
                                (Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local")) / "SuperPinkie"
                                 if os.name == "nt" else home / "Library/Application Support/SuperPinkie")))
    backup_root = state / "backups" / ("mode-architecture-" + str(time.time_ns()))
    changed = False

    for name in ("index.mjs", "package.json", "openclaw.plugin.json"):
        changed |= _copy_if_changed(source / name, extension / name)

    for mode, relative in MODE_WORKSPACES.items():
        workspace = home / relative
        workspace.mkdir(parents=True, exist_ok=True)
        # none 模式刻意不创建 persona/。
        for name, content in PERSONA[mode].items():
            changed |= _write_if_missing(workspace / "persona" / name, content)
        for relative_file, content in MEMORY_FILES.items():
            changed |= _write_if_missing(workspace / relative_file, content)
        for directory in (
            "memory/context/deliberation",
            "memory/episodic",
            "memory/semantic",
            "memory/feedback",
        ):
            target_dir = workspace / directory
            if not target_dir.exists():
                target_dir.mkdir(parents=True)
                changed = True
        skill_source = repo_root / "skills/deep-think/SKILL.md"
        if skill_source.is_file():
            changed |= _copy_if_changed(skill_source, workspace / "skills/deep-think/SKILL.md")

    changed |= _ensure_none_marker(home / MODE_WORKSPACES["none"], backup_root)
    config_changed = _configure_plugin(data, extension)
    if config_changed:
        backup_root.mkdir(parents=True, exist_ok=True)
        shutil.copy2(config, backup_root / "openclaw.json")
        if config.read_bytes() != raw:
            raise RuntimeError("配置发生并发修改，没有覆盖；请重新安装。")
        fd, temp_name = tempfile.mkstemp(dir=config.parent, prefix=".pinkie-modes-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.chmod(temp_name, 0o600)
            _replace_preserving_file_flags(temp_name, config)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
        changed = True
    if changed:
        print("四模式隔离记忆、压缩重载和极致思考派生规则已安装；原有上下文文件未覆盖。")
    return changed


if __name__ == "__main__":
    install()
