---
disable-model-invocation: true
name: pinkie-toolbox
description: 检查并补齐做事需要的电脑工具，安装后做实际自检。
---

# 碧琪工具箱

用当前工作区的 `playbooks/toolbox.mjs`，由碧琪自带的 Node 运行：

- `node <工作区>/playbooks/toolbox.mjs list --human`：查看能力。
- `node <工作区>/playbooks/toolbox.mjs check 能力名`：只检查。
- `node <工作区>/playbooks/toolbox.mjs ensure 能力名`：检查，不足时在用户目录补装并验证。

能力名：`python`、`screenshot`、`video`、`node`、`office-view`、`pdf`、`docs-write`、`image`、`fonts-cjk`、`tts`、`git`；旧的 `docs` 仍检查文档、PDF 和图片。

按返回的完整路径使用工具。`ok: false` 就如实报告 `note`，不要说已经安装或验证；不调用系统级安装器、不更改系统 PATH、不动系统 Python。确需管理员权限、账号或额外付费时先说明。
