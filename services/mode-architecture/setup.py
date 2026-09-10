"""Install the isolated CLE Kk modes without replacing user-authored context files."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import re


MODE_WORKSPACES = {
    "chat": ".openclaw/workspace",
    "project": ".openclaw/workspace-project",
    "ideas": ".openclaw/workspace-thinking",
    "learning": ".openclaw/workspace-learning",
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
    "learning": {
        "core.md": """# 学习模式核心人格

你是碧琪，称呼对方为“先生”，自称只用“碧琪”。这里是一起把知识弄懂、把技能练会的工作台。你保持温暖、清楚、有耐心，但不把对话演成课程；每次都优先推进先生眼前的目标。

学习不是输出长篇报告：先做事，在关键节点用一两句解释可复用的原理、术语和当前系统层次。遇到模糊目标时先用苏格拉底式短问句找到真正要解决的问题；风险可控时带着明确假设继续，不把判断推回给先生。
""",
        "voice_examples.md": """# 学习模式语气样例

- 先给结论或下一步，再补一个最有用的知识点；不先倒一整章教程。
- 默认短句、白话、口语化；能三句话讲清就不写三段，除非先生明确要求深入。
- 解释使用“专业术语（English） = 一句大白话”，然后继续执行。
- 发现方案不合理时直接指出，并给出更好的替代或最小验证办法。
- 任务型请求必须真的读文件、改文件、调用工具和验证，不能只写教学报告。
""",
        "methods.md": """# 学习模式方法卡（独立模块）

根据任务按需组合，不机械套用：

1. 苏格拉底提问：先找到真正值得回答的问题与验收标准。
2. 双层解释：先用直观类比，再说明真实机制与边界。
3. 反向拆解：从优秀范例提炼可复用规律，不照抄表面形式。
4. 纵横分析：纵向看演化路径，横向看替代方案与差异。
5. 事实核查：把事实、推断和未知分开，再决定可信度。
6. 专家会诊：让互补视角互相质疑，最后由主代理综合定案。
7. 第一性原理：拆回目标、本质约束和最小可行路径。
8. 跨领域借解：把其他领域中同构的方法迁移过来并说明对应关系。
9. 双向钢人：先把相反方案都说到最强，再依据目标与证据决断。
10. 最小实验：能运行就先做小实验，用真实反馈替代空想。

挖掘天赋与人生设计类任务只在先生主动要求时启用；要把角色、理念、约束、原型行动和复盘落成可执行记录，不输出漂亮但空泛的长文。
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


def _version_key(value: str) -> tuple[int, ...]:
    numbers = [int(item) for item in re.findall(r"\d+", str(value or ""))]
    return tuple((numbers + [0, 0, 0])[:3])


def _package_version(directory: Path) -> tuple[int, ...]:
    try:
        return _version_key(json.loads((directory / "package.json").read_text(encoding="utf-8"))["version"])
    except Exception:
        return (0, 0, 0)


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

    # A short-lived 2026.9 installation can leave newer schema fields in the
    # shared config.  The user's chosen 2026.7 runtime rejects the whole file
    # before the gateway can start, so a watchdog can only loop forever.  When
    # the pinned desktop bundle explicitly requests 2026.7 compatibility,
    # remove only the four known incompatible leaves; preserve all actual user
    # settings and do nothing for newer/external runtimes.
    if os.environ.get("PINKIE_RUNTIME_CONFIG_SCHEMA") == "2026.7":
        models = data.get("models")
        if isinstance(models, dict):
            models.pop("catalogRefresh", None)
        defaults = data.get("agents", {}).get("defaults") if isinstance(data.get("agents"), dict) else None
        if isinstance(defaults, dict):
            defaults.pop("systemAgent", None)
            heartbeat = defaults.get("heartbeat")
            if isinstance(heartbeat, dict):
                heartbeat.pop("agentId", None)
                if not heartbeat:
                    defaults.pop("heartbeat", None)
        talk = data.get("talk")
        if isinstance(talk, dict):
            talk.pop("agentId", None)

    plugins = data.setdefault("plugins", {})
    plugin_id = "pinkie-mode-architecture"
    if plugins.get("enabled") is False or plugin_id in plugins.get("deny", []):
        raise RuntimeError("CLE Kk 模式运行插件被配置禁用；没有绕过用户配置。")
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
    for agent in data["agents"].get("list", []):
        if isinstance(agent, dict) and agent.get("id") == "unrestricted":
            # Keep every workspace file on disk, but do not inject AGENTS.md,
            # SOUL.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md or MEMORY.md
            # into unrestricted-mode model requests.
            agent["contextInjection"] = "never"
    # CLE Kk ships a patched, internally consistent runtime. Disable the
    # upstream startup check so only CLE Kk's detached updater can replace it.
    update = data.setdefault("update", {})
    if not isinstance(update, dict):
        update = data["update"] = {}
    update["checkOnStart"] = False
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

    # A previously installed newer runtime must never be silently downgraded by
    # launching an older App bundle.  This was the reason source fixes appeared
    # correct in Git while the gateway kept loading an older completion gate.
    source_version = _package_version(source)
    installed_version = _package_version(extension)
    if installed_version <= source_version:
        for name in ("index.mjs", "memory.mjs", "package.json", "openclaw.plugin.json"):
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
        print("CLE Kk 模式隔离记忆、压缩重载和极致思考派生规则已安装；原有上下文文件未覆盖。")
    return changed


if __name__ == "__main__":
    install()
