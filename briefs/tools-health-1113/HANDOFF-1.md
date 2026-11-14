# 交接 1（Windows 端，2026-11-13 傍晚）

上一个会话上下文用到一半，按规矩 12 换新会话。先读 `WINDOWS-PROMPT.md`（用户贴给 Windows 端的版本，规矩以它为准）、`PLAN.md`、`ACCEPTANCE.md`、`PROGRESS.md`，再读这份。

## 在哪

- 工作树 `F:\Projects\tools-health`，分支 `fix/tools-health-1113`，已推到 origin。主工作区 `F:\Projects\super-pinkie` 停在 `audit/pinkie-1112`，不碰。
- 提交（都已推）：`da05889f` 隔离副本脚本 → `91252d7e` A1 → `c9348d03` A2。交接文件这一条之后。
- F: 盘拷大目录很慢（几千个小文件要几分钟），大拷贝放到 C: 或后台跑；`grep -r` 整个仓库会超时，指定子目录。

## 隔离副本（已搭好、网关在跑）

- `%USERPROFILE%\碧琪实测\iso-th`，端口 **1425**，`manifest.json` 里有全部路径。
- 起停：`python -I -X utf8 tools/tool-health/iso-windows/gateway.py start|stop|status`。启动第一次要 1–2 分钟（运行时会跑 npm 插件依赖计划），`start` 的 120 秒等待可能先超时，再 `status` 看端口。
- 改了 `services/` 后：`setup.py sync`（重新复制插件）再重启网关。打运行时补丁：`setup.py patch apply-xxx.mjs`（只改副本运行时）。**A1 补丁还没打进副本**，跑「改后」那批之前要先 `setup.py patch apply-web-fetch-fakeip-v6.mjs`。
- 注意：副本运行时是 Windows 包那份（叠了 Mac 快照），它的 `ssrf` 解析检查本来就被拿掉了，所以 A1 在副本里**看不出差别**；A1 的复现和验证用的是 npm 原包 `F:\tmp\th-sandbox\openclaw-pristine`（脚本 `F:\tmp\th-sandbox\repro-a1.mjs <dist>`），见 PROGRESS。
- 批量跑题：`python -I -X utf8 tools/tool-health/iso-windows/run_eval.py --label <名字> --repeat 2 --jobs 8 [--only 1,2]`，结果在 `iso-th\evals\<名字>\results.json`（里面有 `started` 时间戳）。量数字：`python -I tools/tool-health/session-stats.py --state %USERPROFILE%\碧琪实测\iso-th\home\.openclaw --since <started> --last 500 --json <仓库外>`。
- **「改前」那批（label `before`，10 题 × 3 模型 × 2 遍）交接时还在后台跑**，输出 `iso-th\logs\eval-before.out`。跑完把 session-stats 数字填进 PROGRESS「体检数字」。会话文件在副本里，`--since` 用 results.json 的 `started`。
- 夹具：`fixtures.py` 已跑过：`%LOCALAPPDATA%\Temp\th-test\note-1..3.png`、`iso-th\fixtures\scan-book.pdf`（34.9 MB，30 页 JPEG，第 2–3 页目录）、`fixtures\site\`、`fixtures\proj\`。
- 题 6（app_browser）在副本里没有侧栏浏览器端点（故意不设 `PINKIE_APP_BROWSER_ENDPOINT`），会失败，A6 主要靠单元测试；要真机走通得另想办法，先记「没测」。

## 已查明、后面要用的事实

- 正式环境 Z2 开工值在 PROGRESS 顶部；18789 开工时**没有**进程。收工再对一遍。
- Windows 上 App 自带 Python：`workbench.mjs` 在 win32 直接用 `python`（`PINKIE_PYTHON_BIN` 可覆盖），没有 `agent-env`。系统 Python 是 miniconda，**没有** PIL / pypdf / pytest；运行时 node_modules 也没有 pdf-lib/sharp，只有 `openclaw/node_modules/clawpdf`（A4 先看它能不能抽页、缩图）。
- Python 测试用 `python -X utf8 -m unittest tests.<名字>`（没装 pytest）。Node 测试 `node --test tests/<名字>.test.mjs`。
- 插件工具都是 `api.registerTool(ctx => ... , {name})`，工厂可以按会话返回 `null`（`index.mjs` 约 6935 行起）→ B1 对插件自己的工具可直接按会话不发；核心工具（feishu_*、nodes、gateway…）要看有没有发工具前的钩子，或走 `agents.list[].tools.deny`。
- 运行时 agent 库版本常量在 `dist/openclaw-agent-db-*.js`（`OPENCLAW_AGENT_SCHEMA_VERSION = 1`）。
- Windows 正式只读基线：`process` 54% 失败、`image` 100% 失败（图片模型报错，不是白名单）——A5、A4 要特别看。

## 下一步（按顺序）

1. 等 `before` 批跑完，填数字；在副本 learning 模式放一个假的版本 19 库（`tests/agent-db-guard.test.mjs` 里的造法），`sync` + 重启网关，确认被挪走、网关正常 → A2-1 实测。
2. A3 `services/mode-architecture/web-search-fallback.mjs`：搜索源链 + 每源解析函数 + 8 秒超时 + 60 秒 2 败跳过 10 分钟 + 上限 10 条 + 全败走应用内浏览器；`web_search` 名字走新链（做不到就在各模式 tools.deny 拿掉内置那个）。
3. A4 `patch/apply-image-access.mjs` 上改（复制进 `media/inbox/`、24 小时清理、拒绝目录两套：Mac 的 + `%USERPROFILE%\.ssh`、正式状态目录 `credentials`、设定防护私钥目录（先在 `settings-guard.mjs` 查 Windows 放哪）、凭据管理器路径）；PDF 超 10 MB 抽页 / 返回第五节原文；图片超限先缩。改完同步快照 `local-media-access-olAlkTss.js` + SHA256SUMS。
4. A5 `background-jobs.mjs` + `tests/background-jobs.test.mjs`。
5. A6 `app-browser.mjs`（wait name+ms、serve dir+port、Mac tab、证书报错中文）。
6. A7 出错分类（副本 + Windows 正式只读）。
7. 跑 A 组「改后」批，填 A 组表；然后 B → C → D。
