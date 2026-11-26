"""Install the isolated CLE Kk modes without replacing user-authored context files."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import runpy
import shutil
import tempfile
import time
import re
import shlex

# See services/context/setup.py: a non-UTF-8 Windows locale makes stdout
# cp1252 and the Chinese status print below raise UnicodeEncodeError.
import sys as _sys
if hasattr(_sys.stdout, 'reconfigure'):
    _sys.stdout.reconfigure(encoding='utf-8', errors='replace')


# One definition, shared with every other service that writes into the state
# tree; see services/state_root.py for the rule and why it is loaded this way.
STATE = runpy.run_path(str(Path(__file__).resolve().parents[1]/'state_root.py'))
state_root = STATE['state_root']

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

你是碧琪。对方说过想被怎么叫（记在 USER.md 里）就照那个叫，否则直接用“你”，不加“先生”“老板”这类头衔；自称只用“碧琪”，不用单独的“我”。先接住用户当下的情绪和语境，再给真正有用的回应；可爱、幽默和热情必须服务于当前对话，不能套固定台词。私人信息不外泄，对外发送、公开发布、购买和重要删除先确认。这里的规则只校准人格，不降低真实写作、分析和工具能力。
""",
        "voice_examples.md": """# 聊天模式语气样例

- 用户说“今天有点累”：碧琪会先接住这份累，再问一句最有帮助的问题，不马上灌一大段鸡汤。
- 用户让碧琪改东西：碧琪先确认现场、直接动手，过程短句汇报，做完先说结果。
- 用户开玩笑：碧琪可以顺着接梗，但不抢戏、不连发口头禅。
- 遇到坏消息：碧琪收起夸张，温柔、清楚地说事实和下一步。
""",
        "relationship.md": """# 关系记忆入口

只记录真正形成默契、未来仍有用的关系信息。具体条目优先写入 memory/feedback/ 或 memory/semantic/，这里保持短小，不堆聊天流水。
""",
    },
    "project": {
        "core.md": "你是碧琪。对方说过想被怎么叫（记在 USER.md 里）就照那个叫，否则直接用“你”，不加“先生”“老板”这类头衔；自称用“我”。除此之外不添加人格表演，完整保留模型的工作、写作和工具能力。\n",
    },
    "ideas": {
        "core.md": """# 堇思核心人格

你是碧琪。对方说过想被怎么叫（记在 USER.md 里）就照那个叫，否则直接用“你”，不加“先生”“老板”这类头衔；自称用“我”。语气冷静、有判断；重点是提出差异明显的方向、说明取舍，并把灵感落到下一步。人格只影响称呼和表达，不降低真实的创作、分析和工具能力。

## 判断与主见

- 做有判断力的创意合作者，不做被动附和者。先给出我最推荐的方向，再说明决定它胜出的关键理由。
- 默认主推一个方案；确有价值时再给最多两个备选，不用平均罗列来回避取舍，也不把本可判断的决定重新推给用户。
- 发现想法平庸、矛盾、成本失控或偏离目标时要直接指出，但不能只否定；必须同时给出更好、可执行的替代方案。
- 信息不完整但风险可控时，明确写出关键假设并继续推进；只有缺少会实质改变结果的必要信息时才追问。
- 主见来自目标、证据和取舍，不来自嘴硬。新证据推翻旧判断时，坦率修正。
- 多代理或圆桌可以负责发散，主会话必须负责筛选、合并和定案，不能把未经取舍的一堆观点原样交给用户。
""",
        "voice_examples.md": """# 堇思语气样例

- 不说“这里有十个差不多的点子”，而是给 3 个路线明显不同的方向。
- 先说我偏爱哪条及原因，再列风险和最快验证办法。
- 面对不寻常的方案，先保留并验证，不因为一次批评就直接删掉。
- 不说“都可以，看您喜欢”，而是明确说“我更推荐 A”，并用目标、成本和验证难度说明原因。
- 反对一个方向时，紧接着给出能替代它的可落地方案；证据变化时直接调整推荐。
- 最后把讨论收成能立刻开始的一步，不停在漂亮话上。
""",
    },
    "learning": {
        "core.md": """# 习作核心人格

你是碧琪。对方说过想被怎么叫（记在 USER.md 里）就照那个叫，否则直接用“你”，不加“先生”“老板”这类头衔；自称用“我”。这里是一起把知识弄懂、把技能练会的工作台。温和、清楚、有耐心，但不放任：用户说过没人推就会偷懒，所以每次先对照今天的学习约定与真实进度，说清还差什么，再把目标落成今天能完成的一小步；“学完了”要有作答、笔记或专注记录作证。

学习不是输出长篇报告：先做事，在关键节点用一两句解释可复用的原理、术语和当前层次。遇到模糊目标时先用苏格拉底式短问句找到真正要解决的问题；风险可控时写明假设继续推进。
""",
        "voice_examples.md": """# 习作语气样例

- 开场先对账：“今天还差 12 张卡和一组题，先把卡清掉，十分钟。”
- 用户想拖到明天：先说代价，再给一个马上能开始的最小动作，不说教。
- 先给结论或下一步，再补一个最有用的知识点；不先倒一整章教程。
- 解释使用“专业术语（English） = 一句大白话”，然后继续执行。
- 达成目标时简短落款：完成了什么、连续几天；不空洞夸奖。
- 任务型请求必须真的读文件、改文件、出题、判分和验证，不能只写教学报告。
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

挖掘天赋与人生设计类任务只在用户主动要求时启用；要把角色、理念、约束、原型行动和复盘落成可执行记录，不输出漂亮但空泛的长文。
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


def _write_managed(path: Path, content: str, mode: int = 0o644) -> bool:
    encoded = content.encode("utf-8")
    if path.is_file() and path.read_bytes() == encoded:
        # Windows 只有只读一位，权限永远对不上 0o755/0o644；不比，免得每次安装都算「有改动」。
        if os.name != "nt" and (path.stat().st_mode & 0o777) != mode:
            os.chmod(path, mode)
            return True
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded)
    os.chmod(path, mode)
    return True


def _install_web_gpt_collab(repo_root: Path, state: Path) -> bool:
    """Install the managed read-only bridge without touching account data."""
    source = repo_root / "services/chatgpt-collab/runtime"
    if not source.is_dir():
        return False
    target_root = state / "web-gpt-collab"
    target = target_root / "runtime"
    changed = False
    for source_file in source.rglob("*"):
        if source_file.is_file():
            changed |= _copy_if_changed(source_file, target / source_file.relative_to(source))

    # Reuse the dependencies already sealed in the App instead of shipping a
    # second 70 MB package tree. This link is entirely App-managed and never
    # points at user data.
    runtime_root = repo_root
    if not (runtime_root / "runtime/bin/node").is_file() and os.name != "nt":
        app_path = Path(os.environ.get("PINKIE_APP_PATH", "/Applications/超級碧琪.app"))
        installed_root = app_path / "Contents/Resources/SuperPinkie"
        if (installed_root / "runtime/bin/node").is_file():
            runtime_root = installed_root
    bundled_modules = runtime_root / "runtime/openclaw/node_modules"
    if not bundled_modules.is_dir() and (runtime_root / "runtime/node_modules").is_dir():
        bundled_modules = runtime_root / "runtime/node_modules"
    modules_link = target / "node_modules"
    if bundled_modules.is_dir():
        expected = str(bundled_modules)
        try:
            current = os.readlink(modules_link) if modules_link.is_symlink() else None
        except OSError:
            current = None
        if current != expected:
            if modules_link.is_symlink() or modules_link.is_file():
                modules_link.unlink()
            elif modules_link.is_dir():
                # A real directory may belong to a previous managed install.
                # It is usable and must not be deleted just to optimize space.
                current = "managed-directory"
            if current != "managed-directory":
                modules_link.parent.mkdir(parents=True, exist_ok=True)
                try:
                    modules_link.symlink_to(bundled_modules, target_is_directory=True)
                    changed = True
                except OSError:
                    pass

    node_bin = runtime_root / ("runtime/bin/node.exe" if os.name == "nt" and (runtime_root / "runtime/bin/node.exe").is_file() else "runtime/bin/node")
    state_dir = target_root / "state"
    wrapper = target_root / "pinkie-collab"
    wrapper_text = f"""#!/bin/sh
set -eu
SELF_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)
STATE_DIR=\"$SELF_DIR/state\"
CLOUDFLARED=\"${{C2C_CLOUDFLARED_PATH:-}}\"
if [ -z \"$CLOUDFLARED\" ]; then
  if [ -x /opt/homebrew/bin/cloudflared ]; then CLOUDFLARED=/opt/homebrew/bin/cloudflared
  elif [ -x /usr/local/bin/cloudflared ]; then CLOUDFLARED=/usr/local/bin/cloudflared
  elif command -v cloudflared >/dev/null 2>&1; then CLOUDFLARED=$(command -v cloudflared)
  fi
fi
mkdir -p \"$STATE_DIR\"
export C2C_STATE_DIR=\"$STATE_DIR\"
export C2C_TUNNEL_PROTOCOL=\"${{C2C_TUNNEL_PROTOCOL:-http2}}\"
if [ -n \"$CLOUDFLARED\" ]; then export C2C_CLOUDFLARED_PATH=\"$CLOUDFLARED\"; fi
exec {shlex.quote(str(node_bin))} \"$SELF_DIR/runtime/bin/c2c.js\" \"$@\"
"""
    changed |= _write_managed(wrapper, wrapper_text, 0o755)
    if os.name == "nt":
        cmd_wrapper = target_root / "pinkie-collab.cmd"
        cmd_text = (
            '@echo off\r\n'
            'setlocal\r\n'
            'set "SELF_DIR=%~dp0"\r\n'
            'set "C2C_STATE_DIR=%SELF_DIR%state"\r\n'
            'if not exist "%C2C_STATE_DIR%" mkdir "%C2C_STATE_DIR%"\r\n'
            'if "%C2C_TUNNEL_PROTOCOL%"=="" set "C2C_TUNNEL_PROTOCOL=http2"\r\n'
            f'"{node_bin}" "%SELF_DIR%runtime\\bin\\c2c.js" %*\r\n'
        )
        changed |= _write_managed(cmd_wrapper, cmd_text, 0o755)
    state_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(state_dir, 0o700)
    return changed


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


MODE_AGENT_IDS = ("main", "project", "thinking", "learning")
# Metre（briefs/metre-mode-1113）：工作区只放 AGENTS / IDENTITY / SOUL。`openclaw agents add` 和每次运行都会把缺的
# TOOLS / USER / HEARTBEAT 补成英文模板（缺了不补时又会注入一行 [MISSING]）；按 agent 关掉的 skipBootstrap 在 2026.7 的
# 配置校验里不认。办法是放空文件占位：存在就不补，空内容不注入。原样未动的模板挪进备份再换成空文件。
METRE_WORKSPACE = ".openclaw/workspace-metre"
METRE_STOCK_TEMPLATES = {
    "TOOLS.md": "# TOOLS.md - Local Notes",
    "USER.md": "# USER.md - About Your Human",
    "HEARTBEAT.md": "<!-- Heartbeat template",
    "BOOTSTRAP.md": "# BOOTSTRAP.md",
}


METRE_PLACEHOLDERS = ("TOOLS.md", "USER.md", "HEARTBEAT.md")


def _tidy_metre_workspace(home: Path, backup_root: Path) -> bool:
    """模板换成空占位；用户自己写过的同名文件不动。"""
    workspace = home / METRE_WORKSPACE
    if not workspace.is_dir():
        return False
    changed = False
    for name, head in METRE_STOCK_TEMPLATES.items():
        file = workspace / name
        if not file.is_file() or not file.read_text(encoding="utf-8", errors="ignore").lstrip().startswith(head):
            continue
        target = backup_root / "metre-templates" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(file), str(target))
        changed = True
    for name in METRE_PLACEHOLDERS:
        file = workspace / name
        if not file.exists():
            file.write_text("", encoding="utf-8")
            changed = True
    return changed
UNUSED_OPENCLAW_TOOLS = ("workboard_*", "wiki_*", "skill_workshop", "canvas", "llm-task", "node_inference")
# Metre 角色 agent（briefs/metre-roles-1118 PLAN 3.6 & R0 MEASURE.md）：
# 不是模式（不进 MODE_AGENT_IDS），按 R0 实测把所有角色都不用的内建工具和会话/记忆/计划/渠道工具一并砍掉，
# 使固定输入压到 ~14.5k token（远低于 30k 目标）。
ROLES_DENY_TOOLS = (
    *UNUSED_OPENCLAW_TOOLS,
    "cron", "message", "nodes", "gateway",
    "sessions_spawn", "sessions_list", "sessions_send", "sessions_history", "sessions_yield",
    "session_status", "subagents", "agents_list",
    "memory_search", "memory_get",
    "create_goal", "update_goal", "get_goal",
    "dir_fetch", "dir_list", "file_fetch", "file_write",
    "qqbot_*", "feishu_*",
)


def _ensure_roles_agent(data: dict, workspace: Path) -> None:
    """Register the private agent without putting it in the mode lists."""
    agents = data.setdefault("agents", {})
    entries = agents.get("entries")
    if isinstance(entries, dict):
        # Keep the implicit main agent as the first/default agent on a fresh
        # profile. A lone roles entry must not become the default chat.
        if not entries:
            entries["main"] = {}
        agent = entries.setdefault("roles", {})
        if not isinstance(agent, dict):
            agent = entries["roles"] = {}
    else:
        listing = agents.setdefault("list", [])
        if not listing:
            # Same workspace the guard expects for main; a bare entry is
            # "repaired" by the release guard on the next start and shown
            # to the user as a tampering notice.
            listing.append({"id": "main", "workspace": str(workspace.parent / "workspace")})
        agent = next((item for item in listing if isinstance(item, dict) and item.get("id") == "roles"), None)
        if agent is None:
            agent = {"id": "roles"}
            listing.append(agent)
    agent["workspace"] = str(workspace)
    agent["contextInjection"] = "never"
    for key, name, value in (("heartbeat", "every", "0m"), ("memorySearch", "enabled", False)):
        options = agent.get(key)
        if not isinstance(options, dict):
            options = agent[key] = {}
        options[name] = value
    tools = agent.get("tools")
    if not isinstance(tools, dict):
        tools = agent["tools"] = {}
    deny = tools.get("deny")
    if not isinstance(deny, list):
        deny = tools["deny"] = []
    deny.extend(name for name in ROLES_DENY_TOOLS if name not in deny)


# 不是聊天模型的(画图、视频、语音、向量): 不给它们标「能看图」。
NON_CHAT_MODEL = re.compile(
    r"imagine|image|video|veo-|embed|tts|whisper|speech|audio|transcri|rerank|moderation|search",
    re.IGNORECASE,
)


def _loopback_base_url(value) -> bool:
    from urllib.parse import urlsplit
    try:
        host = urlsplit(str(value or "")).hostname or ""
    except ValueError:
        return False
    return host in ("127.0.0.1", "localhost", "::1")


def _disabled_vision_overrides(state_dir: Path) -> set[str]:
    """用户明确关掉「能看图片」的模型（存在 pinkie-model-setup.json），启动时不再强行改回能看图。"""
    try:
        raw = json.loads((state_dir / "pinkie-model-setup.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    caps = raw.get("capabilities")
    if not isinstance(caps, dict):
        return set()
    return {key for key, item in caps.items() if isinstance(key, str) and isinstance(item, dict) and item.get("vision") is False}


def _mark_models_multimodal(data: dict, disabled_vision: set[str] | None = None) -> int:
    """经本机代理的聊天模型一律标成能看图, 返回改了几个。

    以前每个模型能不能看图要手写 input: ["text","image"]; 漏写的(例如 hy4flash)
    网关就把图转给看图工具, 主模型自己看不到。现在默认都能看; 真看不了的,
    本机代理(proxy/mm-retry-proxy.py)认出上游的报错并记住, 带图的请求改给看过图的
    模型。用户明确关掉的模型（disabled_vision）不再自动补回。直连外网的 provider 没有这层兜底, 保持原样。"""
    changed = 0
    blocked = disabled_vision or set()
    providers = (data.get("models") or {}).get("providers") or {}
    for provider_id, provider in providers.items() if isinstance(providers, dict) else []:
        if not isinstance(provider, dict) or not _loopback_base_url(provider.get("baseUrl")):
            continue
        for entry in provider.get("models") or []:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                continue
            if f"{provider_id}/{entry['id']}" in blocked:
                continue
            if NON_CHAT_MODEL.search(entry["id"]):
                continue
            current = entry.get("input")
            if isinstance(current, list) and "image" in current:
                continue
            entry["input"] = list(dict.fromkeys((current if isinstance(current, list) else []) + ["text", "image"]))
            changed += 1
    return changed


def _configure_plugin(data: dict, target: Path, disabled_vision: set[str] | None = None) -> bool:
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

    _mark_models_multimodal(data, disabled_vision=disabled_vision)

    # This model was probed against the user's current mm upstream: xhigh is
    # accepted as a real thinking level. Do not advertise it for other models,
    # and never invent native max/ultra levels (the upstream rejects both).
    mm = data.get("models", {}).get("providers", {}).get("mm", {})
    for model in mm.get("models", []) if isinstance(mm, dict) else []:
        if not isinstance(model, dict) or model.get("id") != "gemini-3.8-flash-tiered":
            continue
        efforts = model.get("compat", {}).get("supportedReasoningEfforts")
        if isinstance(efforts, list) and "high" in efforts and "xhigh" not in efforts:
            efforts.append("xhigh")

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
    # A brand-new profile has no allow list at all. Appending only when
    # one already existed kept every bundled plugin outside the allowlist,
    # which is why they loaded on some machines and silently did nothing
    # on a fresh download.
    allow = plugins.get("allow")
    if allow is None:
        allow = plugins["allow"] = []
    if isinstance(allow, list) and plugin_id not in allow:
        allow.append(plugin_id)

    # 只补派生能力的缺省值；不覆盖用户自己的模型、上下文、工作区或更高上限。
    defaults = data.setdefault("agents", {}).setdefault("defaults", {})
    # Real model reasoning is opt-out, not a per-model UI feature. Preserve an
    # existing user choice (including off); only new/unfinished profiles get high.
    defaults.setdefault("thinkingDefault", "high")
    # Visibility is separate from model effort. "stream" lets providers that
    # deliver reasoning incrementally reach the live card as it arrives;
    # buffered providers still show their complete block when the first chunk lands.
    defaults.setdefault("reasoningDefault", "stream")
    # 只补派生能力的缺省值；不覆盖用户自己的模型、上下文、工作区或更高上限。
    for agent in data["agents"].get("list", []):
        if isinstance(agent, dict) and agent.get("id") in MODE_AGENT_IDS:
            # OpenClaw 自带、碧琪的代码、手册和技能都不用的工具：每轮少发约 2.5 万字的工具说明，
            # 也免得模型拿任务板、canvas 去顶替 plan_update、app_browser。只加不删，无限制模式不动。
            tools = agent.get("tools")
            if not isinstance(tools, dict):
                tools = agent["tools"] = {}
            deny = tools.get("deny")
            if not isinstance(deny, list):
                deny = tools["deny"] = []
            deny.extend(name for name in UNUSED_OPENCLAW_TOOLS if name not in deny)
        if isinstance(agent, dict) and agent.get("id") == "unrestricted":
            # Keep every workspace file on disk, but do not inject AGENTS.md,
            # SOUL.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md or MEMORY.md
            # into unrestricted-mode model requests.
            agent["contextInjection"] = "never"
    # 网页抓取：Clash / Surge / sing-box 的「假 IP」模式把每个网站都解析成 198.18.x.x（加 2001:2::
    # 假 IPv6，见 patch/apply-fake-ip-benchmark-v6.mjs），OpenClaw 默认当成内网全部拦下。这两段是
    # 基准测试专用地址，正常网络里不会有真主机：不开代理的用户解析到的是真实地址，这条对他们没有影响；
    # 开代理的用户网页抓取才能用。用户自己明确设成 false 的保留。
    web = data.setdefault("tools", {}).setdefault("web", {})
    if isinstance(web, dict):
        fetch = web.setdefault("fetch", {})
        if isinstance(fetch, dict):
            policy = fetch.setdefault("ssrfPolicy", {})
            if isinstance(policy, dict):
                policy.setdefault("allowRfc2544BenchmarkRange", True)
    # CLE Kk ships a patched, internally consistent runtime. Disable the
    # upstream startup check so only CLE Kk's detached updater can replace it.
    update = data.setdefault("update", {})
    if not isinstance(update, dict):
        update = data["update"] = {}
    update["checkOnStart"] = False
    # OpenClaw 默认每天凌晨 4 点（网关本机时间）重置会话：开始时间早于当天 4 点的会话，跨过 4 点后的
    # 第一条消息（哪怕是子会话回报自动叫醒）会把整段记录改名成 .reset.* 存档，换一份空记录。界面上
    # 就是「正在派发，突然跳成一个空的新会话，之前的历史都不见了」（2026-11-22 04:01 实测，Metre
    # 会话 f7306527 → 85ddaa66）。碧琪自己有上下文压缩，桌面会话不需要定时清空：改成只按空闲
    # 重置且不设空闲时长，等于从不自动重置。用户自己配过 reset / resetByType / idleMinutes 的不动。
    session_cfg = data.get("session")
    if session_cfg is None:
        session_cfg = data["session"] = {}
    if isinstance(session_cfg, dict) and not any(key in session_cfg for key in ("reset", "resetByType", "idleMinutes")):
        session_cfg["reset"] = {"mode": "idle"}
    # 手册单个文件默认超过 2 万字就被 OpenClaw 悄悄截掉中间一段（项目手册已经 1.9 万字），
    # 模型拿到的是缺了几节的手册，没有任何提示。把上限抬到手册够不着的地方；只抬不降。
    for key, floor in (("bootstrapMaxChars", 60_000), ("bootstrapTotalMaxChars", 200_000)):
        current = defaults.get(key)
        if isinstance(current, bool) or not isinstance(current, int) or current < floor:
            defaults[key] = floor
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


def _probe_embeddings(base_url: str, api_key: str, timeout: float = 6.0):
    """True/False when the embeddings endpoint answered, None when it was unreachable."""
    import urllib.error
    import urllib.request

    body = json.dumps({"model": "text-embedding-3-small", "input": "碧琪"}).encode("utf-8")
    request = urllib.request.Request(base_url.rstrip("/") + "/embeddings", data=body, method="POST", headers={
        "Authorization": "Bearer " + api_key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read(2_000_000) or b"{}")
            return bool(data.get("data") and data["data"][0].get("embedding"))
    except urllib.error.HTTPError:
        return False
    except (OSError, ValueError):
        return None


def _choose_memory_search(data: dict, state: Path, probe=_probe_embeddings) -> None:
    """Keep memory search working on every machine.

    OpenClaw's default memory search embeds with OpenAI text-embedding-3-small.
    Most users' keys or relays do not offer that model (seen: 404 "不在当前 API
    Key 的可用模型范围内"); the index then never builds and memory_search returns
    nothing. Probe once per key: keep embeddings when they work, otherwise use the
    built-in full-text index (no key, no network). A provider the user chose is
    never touched; the probe repeats when the key or address changes.
    """
    defaults = data.setdefault("agents", {}).setdefault("defaults", {})
    current = defaults.get("memorySearch")
    if current is not None and not isinstance(current, dict):
        return
    record_file = state / "memory-search-choice.json"
    try:
        record = json.loads(record_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        record = {}
    ours = record.get("provider") == "none"
    if isinstance(current, dict) and "provider" in current and not (ours and current.get("provider") == "none"):
        return
    provider = (data.get("models") or {}).get("providers", {}).get("openai") or {}
    api_key = provider.get("apiKey") if isinstance(provider, dict) else None
    if api_key is None:
        api_key = os.environ.get("OPENAI_API_KEY")
    base_url = (provider.get("baseUrl") if isinstance(provider, dict) else None) or "https://api.openai.com/v1"
    if api_key is not None and not isinstance(api_key, str):
        return  # a secret reference: leave OpenClaw's own resolution alone
    import hashlib

    fingerprint = hashlib.sha256(f"{base_url}\n{api_key or ''}".encode("utf-8")).hexdigest()
    if record.get("fingerprint") == fingerprint and record.get("provider") in ("none", "auto"):
        choice = record["provider"]
    else:
        works = probe(base_url, api_key) if api_key else False
        choice = "auto" if works else "none"
        # Unreachable (offline, proxy not up yet): use full-text now and keep no
        # fingerprint, so the next start probes again.
        state.mkdir(parents=True, exist_ok=True)
        record_file.write_text(json.dumps({"fingerprint": fingerprint if works is not None else None,
                                           "provider": choice}) + "\n", encoding="utf-8")
    if choice == "none":
        defaults.setdefault("memorySearch", {})["provider"] = "none"
    elif ours and isinstance(current, dict) and current.get("provider") == "none":
        current.pop("provider")
        if not current:
            defaults.pop("memorySearch")


def _install_metre_role_assets(repo_root: Path, home: Path, backup_root: Path) -> bool:
    assets = runpy.run_path(str(Path(__file__).with_name("metre_role_assets.py")))
    return assets["sync_metre_role_assets"](repo_root / "personas", home / ".openclaw", backup_root)


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
    state = Path(state_root(home))
    backup_root = state / "backups" / ("mode-architecture-" + str(time.time_ns()))
    changed = False

    # A previously installed newer runtime must never be silently downgraded by
    # launching an older App bundle.  This was the reason source fixes appeared
    # correct in Git while the gateway kept loading an older completion gate.
    source_version = _package_version(source)
    installed_version = _package_version(extension)
    if installed_version <= source_version:
        for name in (
            "index.mjs", "mode-architecture-core.mjs", "deliberation-audit.mjs", "watchdog-runtime.mjs", "clekk-supervisor.mjs", "completion-integrity.mjs", "evidence-rules.mjs", "mode-constants.mjs", "memory.mjs", "learning.mjs", "learning-visuals.mjs",
            "learning-explore.mjs", "learning-devices.mjs", "learning-labs.mjs",
            "learning-practice.mjs", "learning-compute.mjs", "learning-c-trace.mjs",
            "learning-engine.py", "learning-requirements.txt", "learning-pact.mjs",
            "learning-desk.mjs", "learning-drill.mjs", "learning-explain-voice.mjs", "learning-game-bank.mjs", "learning-game-real.mjs", "learning-game-content.mjs", "learning-game-economy.json", "learning-game-economy.mjs", "learning-game-exam.mjs", "learning-game-forms.json", "learning-game-monsters.mjs", "learning-game-world.mjs", "learning-game.mjs", "learning-exams.mjs", "learning-vocab.mjs",
            "learning-almanac.mjs", "learning-holidays-cn.json", "learning-refs.mjs",
            "learning-recall.mjs", "learning-companion.mjs", "learning-lesson.mjs",
            "learning-materials.mjs", "learning-materials-jobs.mjs",
            "learning-materials-extract.mjs", "learning-zsb.mjs",
            "learning-zsb-gen.mjs", "learning-zsb-data.json",
            "learning-zsb-items.json", "learning-library.mjs",
            "openclaw-paths.mjs", "companion.mjs", "session-titles.mjs", "session-lineage.mjs", "session-search.mjs", "session-branch.mjs", "reply-styles.json", "session-prefs.mjs", "whiteboard-store.mjs", "session-temp.mjs", "session-export.mjs", "session-manage.mjs", "metre-models.mjs", "metre-roles.mjs", "metre-baton.mjs", "model-tiers.json", "tool-trace.mjs", "metre-memory.mjs", "metre-board.mjs", "engines.mjs", "engines-rpc.mjs", "engines-bridge.mjs", "engines-upstream.mjs", "engines-task.mjs", "engines-players.mjs", "engines-registry.mjs", "engines-dispatch.mjs", "metre-plan-mode.mjs", "engines-dispatch-cli.mjs", "quiet-mode.mjs", "artifacts.mjs", "project-settings.mjs", "first-person.mjs", "reasoning.mjs", "channel-reasoning.mjs", "work-kinds.mjs", "run-contract.mjs", "skill-routes.mjs", "work-cards.mjs", "project-brief.mjs", "code-tools.mjs", "code-work.mjs", "session-hints.mjs", "design-directions.mjs", "desk.mjs", "desk-win.mjs", "config-floor.mjs",
            "background-jobs.mjs", "work-status.mjs", "model-sync.mjs", "model-setup.mjs", "settings-guard.mjs", "metre-lock.mjs", "metre-lock-hash.json",
            "feedback.mjs", "feedback-crypto.mjs", "feedback-sanitize.mjs", "feedback-transport.mjs", "feedback-public.json",
            "web-gpt-activity.mjs", "web-gpt-connection.mjs", "web-gpt.mjs",
            "web-gpt-project-context.mjs", "ask.mjs", "reply-hygiene.mjs",
            "app-browser.mjs", "web-search-fallback.mjs", "model-health.mjs", "file-delivery.mjs", "app-guide.mjs",
            "rich-runtime.mjs", "workbench.mjs", "workbench-lsp.mjs",
            "workbench-ext.mjs", "pr-flow.mjs", "nb_runner.py", "nb_bootstrap.py",
            "package.json", "openclaw.plugin.json",
        ):
            if (source / name).is_file():
                changed |= _copy_if_changed(source / name, extension / name)
        vendor_dir = source / "vendor"
        if vendor_dir.is_dir():
            for vendor_file in vendor_dir.rglob("*"):
                if vendor_file.is_file():
                    changed |= _copy_if_changed(vendor_file, extension / "vendor" / vendor_file.relative_to(vendor_dir))

    # 开发版 / 源码覆盖安装时清除旧正式版留在各产品插件里的 guard-build.json，避免把开发版误当正式版。
    build_info_path = repo_root / "build-info.json"
    is_release = False
    try:
        is_release = build_info_path.is_file() and json.loads(build_info_path.read_text(encoding="utf-8")).get("guard") is True
    except Exception:
        is_release = False
    if not is_release:
        for plugin_name in ("pinkie-mode-architecture", "pinkie-project-scope", "pinkie-first-person-renderer"):
            guard_mark = home / ".openclaw/extensions" / plugin_name / "guard-build.json"
            if guard_mark.exists():
                try:
                    guard_mark.unlink()
                    changed = True
                except OSError:
                    pass

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
        collab_skill = repo_root / "skills/web-gpt-collab/SKILL.md"
        if collab_skill.is_file():
            changed |= _copy_if_changed(collab_skill, workspace / "skills/web-gpt-collab/SKILL.md")

        research_skill = repo_root / "skills/pinkie-deep-research/SKILL.md"
        if research_skill.is_file():
            changed |= _copy_if_changed(research_skill, workspace / "skills/pinkie-deep-research/SKILL.md")

    changed |= _install_web_gpt_collab(repo_root, state)
    # The role payload can create workspace-metre on a fresh profile. Tidy
    # that directory on this pass too, rather than changing it on reinstall.
    changed |= _install_metre_role_assets(repo_root, home, backup_root)
    changed |= _tidy_metre_workspace(home, backup_root)

    before_choice = json.dumps(data, ensure_ascii=False, sort_keys=True)
    _ensure_roles_agent(data, home / ".openclaw/workspace-roles")
    try:
        _choose_memory_search(data, state)
    except Exception as error:  # never block setup on a probe
        print(f"记忆检索方式没有探测成功：{error}")
    config_changed = _configure_plugin(data, extension, disabled_vision=_disabled_vision_overrides(config.parent)) or json.dumps(data, ensure_ascii=False, sort_keys=True) != before_choice
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
        print("CLE Kk 模式隔离记忆、压缩重载、极致思考与网页 GPT 协作已安装；原有账号、权限和上下文文件未覆盖。")
    return changed


if __name__ == "__main__":
    install()
