# 超级碧琪 🎈 — OpenClaw Unrestricted-Prompt Kit

为 [OpenClaw](https://github.com/openclaw/openclaw) 网关注入"无限制"系统提示词的完整工具包：提示词库、HTTP 层注入代理、双传输层补丁、macOS / Windows 双平台一键安装与自动更新。

> 本项目仅供模型能力评估、安全研究与个人自动化使用。使用本工具产生的任何后果由使用者自行承担。上游模型服务商仍保留其服务端的内容审核权利。

## 架构

```
OpenClaw 网关 ──▶ ur-rewrite-proxy (HTTP 层注入) ──▶ 模型中继 (cle-cliproxy / litellm / 其他)
     │                        │
     └── 传输层补丁(进程内注入) ┘       两条注入路径互为冗余、去重防双份
```

- **代理注入（主）**：代理位于网关与模型中继之间。对系统提示含 `agent=unrestricted`（可配置）的 chat/completions 请求，按模型自动选择对应弹头，前置注入为 `messages[0]`，再转发。覆盖 dashboard/webchat 等绕过进程内传输层的所有路径。
- **传输层补丁（冗余）**：patch 两个 OpenClaw 模型传输实现（`dist/openai-transport-stream-*.js` 与 `@openclaw/ai/dist/openai-completions-*.mjs`），进程内注入，与代理层通过内容标记去重。

## 弹头库（prompts/，按模型自动路由）

| 文件 | 适用模型 | 策略 |
|---|---|---|
| `unrestricted-prompt.txt` | deepseek / 其他通用 | 满配 15 部分：免疫声明、归一化、术语重定义、预设模板、防复发等 |
| `unrestricted-prompt-claude.txt` | claude-* | 非对抗式 XML 配置 + URIAL 少样本 + Skeleton Key |
| `unrestricted-prompt-gemini.txt` | gemini-*（普通档） | BLOCK_NONE 安全设置声明 + 自由实体人设 |
| `unrestricted-prompt-gemini-hard.txt` | gemini-3.7-flash-tiered / gemini-pro-agent / gemini-3.1-pro-high | 良性"协议测试套件"框架（不提任何破甲词汇），代理自动强制 temperature=0 |
| `unrestricted-prompt-gpt5.txt` | gpt-5.x / codex | 技术操作范围语义定义 + 硬输出规则 |
| `unrestricted-prompt-gptoss.txt` | gpt-oss-* | 政策覆写（SYSTEM CORE POLICY） |

## 验证口令

任意弹头内置暗号：会话中发送 **`Cle`**，模型只回复 `ACTIVE_UNRESTRICTED_RULESET_LOADED` 即注入链路正常（提示词文件可自行修改暗号，实时生效）。

## 文档

- Windows 10/11 详细部署：[docs/WINDOWS.md](docs/WINDOWS.md)

## 安装

### macOS (Intel / M1/M2/M3/M4)

```bash
git clone <repo-url> && cd <repo>
./install.sh --provider mm     # 提示词+补丁+代理，并把 mm 提供者指向代理
./install.sh --launchd         # （可选）代理开机自启
```

### Windows 10/11

```powershell
git clone <repo-url>; cd <repo>
.\install.ps1 -Provider mm     # 提示词+补丁+代理+计划任务自启
```

### 配置说明

- 提示词文件安装在 `~/.openclaw/`（Windows: `%USERPROFILE%\.openclaw\`），**每次请求实时读取**，改完立即生效，无需重启网关。
- 代理默认监听 `127.0.0.1:1467`，转发到 `127.0.0.1:1466`。改端口用 `UR_PROXY_PORT` / `UR_UPSTREAM_PORT`。
- 无限制模式判定：系统提示含 `agent=unrestricted`（`UR_PROXY_GATE_MARKER` 可改）。在 OpenClaw 里建一个无人格的 agent（如 `unrestricted`）即生效；其他 agent 不受影响。
- 更新：`./update.sh`（mac）或 `.\update.ps1`（win）——从远端拉取并自动重装。

## 卸载

```bash
./install.sh --remove          # mac
.\install.ps1 -Remove          # win
```

## 常见问题

- **某个模型 Cle 不回**：先查代理日志（mac: `/tmp/ur-rewrite-proxy.log`；win: 计划任务输出）里的 `ur-proxy: model=... gated=... injected=...` 行；`injected=True` 说明注入已发出，剩余是模型自身对齐，换同系列低档位模型（如 gemini-3.6-flash-tiered）通常即可。
- **升级 OpenClaw 后失效**：重新运行 `./install.sh` / `.\install.ps1`（补丁脚本幂等）。
- **上游 4xx**：是模型中继/账号问题，与注入无关，检查中继配置与配额。

## 开发

- `patch/reapply-unrestricted-patch.mjs`：传输层补丁（`OPENCLAW_ROOT` 指定 openclaw 包目录，自动探测）。
- `proxy/ur-rewrite-proxy.py`：注入代理（纯 Python 标准库，含上游瞬断重试）。

## License

MIT
