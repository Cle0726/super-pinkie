# 交接 2（Windows 端，2026-11-13 晚）

接 `HANDOFF-1.md`（隔离副本怎么用、查到的事实都在那里，仍然有效）。规矩以 `WINDOWS-PROMPT.md` 为准。

## 用户新定的（11-13 晚）

1. **实测只用 `mm/workbuddy/hy4free`，不设任何后备**（hy4std、deepseek 不能用）。副本配置已改（`model` / `imageModel` / `pdfModel` = hy4free、`fallbacks: []`），`setup.py`、`run_eval.py` 默认也是。冒烟验证：题 3 三张图全读对，5 次回复全是 hy4free，image 工具走的也是 hy4free。
2. 用户允许最多再开两个**没有上下文、解绑**的会话并行做；已开、**已解绑（不会回报，也不要去唤醒它们）**：
   - A3 搜索链：会话「A3: search source chain for pinkie_search」，分支名形如 `*tools-health-1113-a3*`，结果写 `briefs/tools-health-1113/progress/A3.md`；
   - A4 图片 / PDF：会话「A4: image/pdf read user files, big PDFs」，分支 `*tools-health-1113-a4*`，结果写 `progress/A4.md`。
   它们只在自己的分支上提交、推送，**不合进** `fix/tools-health-1113`。合并要先问用户。查进度：`git fetch origin && git branch -r | grep tools-health-1113-a`。

## 本分支状态（都已推）

`da05889f` 副本脚本 → `91252d7e` A1 → `c9348d03` A2 → `c8591689` 交接 1 → `75878c68`/`3a93743d` 只用 hy4free → `db7ed7df` A2 补安装清单 → `1c1a148e` A5 → 本文件。

- A5 的根因和剩下的一截写在 PROGRESS（插件钩子没法让 veto 不标出错；用 `tool_result_persist` 改会话记录；mm 走 openai-completions，出错标记本来就不发给模型）。
- `tests/mode-architecture.test.mjs` 在 Windows 上本来就有 1 条红：`computer tool discovers the complete driver surface…`（基线也红，不是本分支的）。

## 正在跑

- 「改前」批 `before-h4f`（10 题 × hy4free × 2 遍，并发 8），后台跑，输出 `iso-th\logs\eval-before-h4f.out`，结果 `iso-th\evals\before-h4f\results.json`。注意副本里还有作废批（`before`、`before-hy4free`、`smoke-h4f`）的会话：量数字一定用 `--since <results.json 的 started>`。
- 副本插件还是 A1 之前的代码（没 sync），这正是「改前」要的。

## 下一步

1. `before-h4f` 跑完 → session-stats 数字填 PROGRESS「体检数字（隔离副本，hy4free）」。
2. A2-1 实测：副本 learning 模式 agentDir 放一个版本 19 的假库（造法见 `tests/agent-db-guard.test.mjs`，把 mtime 改到 1 分钟前），`setup.py sync` + 重启网关，看日志 `agent db learning: schema 19 > 1, moved`、文件到了 `home\.openclaw\backups\agent-db-<日期>\learning\`、网关正常。
3. A6 `services/mode-architecture/app-browser.mjs`：wait 给了 text/selector/ref/name 之一再加 ms → ms 当最长等待（上限 15 秒不变），只给 ms 纯等待；serve dir+port 合法、dir+command 才报错；Mac 上 tab：`op:new` 等价 open，其他返回「Mac 版只有一个页面，直接用 open 换网址」且不标出错（这句是方案原文）；工具说明的参数描述同步；证书无效报错换中文 + 下一步（新文字列「待 Fable 写」，或先用方案已有的话）。测试在 `tests/` 里找 app-browser 的。
4. A7 出错分类：副本 + Windows 正式（只读）的 `stopReason: error/aborted` 和 `openclaw:prompt-error` 按 上游超时 / 鉴权 / 上下文超长 / 其他 计数。
5. 等 A3、A4 分支做完 → 问用户能不能合进来 → `setup.py sync` + `setup.py patch apply-web-fetch-fakeip-v6.mjs`（+ A4 的补丁）+ 重启 → 跑「改后」批 → 填 A 组表 → B 组。
6. 上下文用到一半就写 HANDOFF-3。
