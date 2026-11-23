# Metre 外部引擎 · 进度

新的一条写在最上面。每条写：做了什么、怎么验的、没验什么、下一步。

---

## 2026-11-22 · 会话 847a9261（Opus 5.5）· 摸底和打通

**环境（已做）**
- 本机命令行全部升到最新：Codex 0.146.0 → 0.171.0、Claude Code 2.1.322 → 2.1.330（都是 `npm -g`，前缀 `F:\npm-global`）；Antigravity CLI 1.1.5 → 1.5.14、Antigravity IDE 2.5.5 → 2.8.0（winget）。
- Clash Verge 全局节点按实测下载速度换成「🇺🇸美国中转2」（1.64 MB/s；原「美国直连3」0.78 MB/s）。只能换美国节点。控制器 127.0.0.1:9097，密钥在 Clash Verge 的 config.yaml，不打印。

**T3 试验（已打通）**
- 试验目录 `F:\t3probe`（纯英文）：`node_modules/t3`（npm 启动器 0.1.11）、`home`（`T3CODE_HOME`，里面 `runtime/versions/0.1.11/t3.exe`）、`work`（试验项目，git 仓库）、`tools`（多装的一份 Codex 0.171，现在用不着了）。
- 启动：`T3CODE_HOME=F:/t3probe/home t3.exe serve --port 3790 --host 127.0.0.1 --no-browser`，日志 `F:\t3probe\serve.log`。
- 已证实：`t3 project add .`、`t3 thread start . "<话>" --provider codex --model gpt-5.6-luna --wait --json` 走通，返回 `{threadId, runId, status, reply, error}`。
- 中文路径坑：T3 启动器用 Windows `tar.exe` 解压，`F:\碧琪实测\...` 直接失败。碧琪必须自己解压。
- 三家现状：
  - Codex：已登录（用户的 ChatGPT Plus），版本够了；**额度用完，11-26 17:43 恢复**。
  - Claude Code：已装，**没登录**，要用户自己运行 `claude auth login`。T3 里的实例 id 是 `claudeAgent`，默认是关的。
  - Antigravity：T3 里默认关；要在 T3 里装它的运行包并用 Google 登录（用户自己点）。
  - 实例 id 看 `home/caches/*.json` 的 `instanceId`；这些文件含账号邮箱，不要打印、不要外传。

**计划**：本目录 `PLAN.md`。C.le. 计划那边的 K8（分支 `docs/metre-next-1122`）指向这里。

**下一步**：E1 引擎服务（`services/mode-architecture/engines.mjs` + 测试）。
