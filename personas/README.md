# 人格文件

这里保存「超級碧琪」使用的模式人格、工作手册和 Metre 专用角色卡：

- `chat/`：唠嗑模式
- `project/`：项目模式（独立项目人格与工作区）
- `thinking/`：想法模式（含 `AESTHETICS.md` 审美规范）
- `learning/`：学习模式（含 `METHODS.md` 方法卡与辅导规则）
- `neutral/`：无限制模式使用的无碧琪人格工作区文件（保持原样，不随改版改写）
- `metre/`：Metre 模式（不用碧琪的人格和称呼；只有 `AGENTS.md`、`IDENTITY.md`、`SOUL.md` 三份，`TOOLS.md`、`USER.md`、`HEARTBEAT.md` 装成 0 字节占位，见 `docs/METRE-MODE.md`）

- `metre/roles/*.md`：随版本发布的官方角色卡，存放在子目录，不注入 Metre 自己的提示。

`roles` 是 Metre 专用的后台 agent，不是用户可切换的模式，不使用碧琪的旧模式人格。安装时会创建 `~/.openclaw/workspace-roles`，从 `project/playbooks/` 复制打法，从 `thinking/AESTHETICS.md` 复制 `refs/AESTHETICS.md`，并放空占位文件；它不建记忆目录。复制是单向的，不修改这些源手册。

官方卡同步到 `~/.openclaw/workspace-metre/roles/`，更新覆盖前先备份、官方退役时移进备份。用户卡只放在本机的 `roles/user/`，安装和更新不碰它。格式和用法见 [Metre 模式 · 角色](../docs/METRE-MODE.md#角色)。

安装与更新时，人格与工作手册（`SOUL.md`、`IDENTITY.md`、`AGENTS.md`、`AESTHETICS.md`、`METHODS.md`、`HEARTBEAT.md`、`memory-system.md`）和 `playbooks/` 一律跟随官方版本：本机的不同版本先备份到 `backups/`，再换成新版。`DREAMS.md`、无限制模式，以及用户自己的 `USER.md`、`TOOLS.md`、`MEMORY.md`、`memory/` 长期记忆与聊天记录原文绝不覆盖、绝不上传。正式版提供可选的「帮碧琪变好（使用场景与纠错摘要）」改进反馈功能：默认关闭，仅在用户明确同意后于本机脱敏并加密上报模式/任务类型/工具与纠错分类摘要，随时可在设置里关闭、查看待传内容或删除本地待传记录。
