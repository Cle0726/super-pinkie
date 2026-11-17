# Metre 总控台 · 给接后端的人

> **11-15 现状（先看这段，下面是 11-14 晚写给接手人的原文，留作记录）**
> - 后端和数据接线已经做完：`services/mode-architecture/metre-board.mjs`（批 5，9a601292）、`ui/injections/laolao-metre-board-data.js`（9743a13d）。九个区块都换成真数据，「示例」说明会自动拿掉。下面「还没人做的」三条都已做完（资源关停是批 6）。
> - 11-15 在 F 盘隔离副本的真网关上跑了一次（S2 三件并行），发现并修了：网关里插件有两个实例，读数接口一直拿着内存里的旧账，子会话一行时间段都没有 → 每次取账看文件修改时间，别的实例写过就重读（有单测）。
> - 11-15 用户：「不喜欢全屏，看不到 Metre 的流式输出」→ 改成**停在窗口右边的面板**，对话区让出宽度，左边沿可拖宽度；内容区放不下「对话 520 + 面板 400」时退成浮层，浮层停在输入框上方。下面「和方案不同的地方」第 1 条因此作废。
> - 11-15 用户：「后端挂了前端不能还在转」→ 连接一断立刻标「断线」，「在跑」改成「断线前在跑」；有东西在跑时 20 秒没刷过就主动读一次；在跑但 90 秒没动静（上游重试、卡住）的行标「没动静」。A5-2「没事件不发请求」现在只在什么都没在跑时成立。

2026-11-14 晚，Fable（Windows）。前端的页面骨架已经在了，数据一格没接。这份是你要做的事和验收办法。
方案原文在 `PLAN.md` 2.12（八个区块）和 6.2（第 9 区项目记忆）；验收在 `ACCEPTANCE.md` A5-1～10。这里只写骨架已经定下来的东西和你要补的东西。

## 现在有什么

- 文件：`ui/injections/laolao-metre-board.js`、`laolao-metre-board.css`，已登记在 `laolao-head.fragment.html`。
- 入口三处：侧栏「总控台」；首页输入框下面三张卡片（总控台 / 项目记忆 / 运行环境）；`window.__pinkieMetreBoard.open('<区块名>')`。
- 页面：铺满侧栏右边的内容区（不是 PLAN 2.12 写的右侧窄面板——九个区块放不进 400px，见下面「和方案不同的地方」）。Esc、右上角的叉、点侧栏里别的东西都会关。
- 每个区块里现在是一份**版式示例**（第四版起：有字、有颜色，样子就是接好以后的样子）和一句说明，右上角标着「示例 · 待接入」，页面顶上有一条「示例」说明。示例里的字和数字都是编的，不是数据，接好以后必须整块换掉，不许留一半；九块全接完后把顶上那条说明（`.pk-metre-board__notice`）也拿掉。图表颜色用 `--metre-v1…v5`（黄铜 = 在跑，铜绿 = 做完，赭红 = 出错，灰 = 排队），状态写在 `data-state="done|run|fail|wait"` 上，样式类在 `laolao-metre-board.css`「示例内容的零件」一段，可以直接复用。
- 截图：`ref/v3-board-light.png`、`ref/v3-board-dark.png`。

## 区块和接口

一个只读接口 `pinkie.metre.board`，参数 `{sessionKey}`（Metre 主会话），一次返回下面全部字段；项目记忆读已有的 `pinkie.metre.memory`。

| 区块 `data-metre-slot` | 标题 | 返回字段 | 内容 |
|---|---|---|---|
| `overview` | 总览条 | `overview: {state, startedAt, running, limit, returned, failed, paused, stopped}` | 当前状态一句话、已用时间、在跑 n / 上限、已交回 · 失败 |
| `plan` | 计划 Score | `plan: [{id, text, status}]`，status：`pending / active / done / blocked` | `plan_update` 的步骤 |
| `sessions` | 子会话 Parts | `sessions: [{key, title, mode, model, status, startedAt, endedAt, doing, usage, rejects, error, spans: [{from, to, kind}]}]` | 一行一个子会话。**画成总谱**：一行一个声部，横向是时间，`spans` 是它在干活的时间段，竖线是「现在」。行尾：打开、停止、发消息。失败的那行写原因 |
| `pending` | 待你处理 Cues | `pending: [{id, kind, sessionKey, text, askedAt}]`，kind：`ask_user / confirm` | 有内容时卡片标题和侧栏「总控台」上出数字 |
| `timeline` | 时间线 Bars | `timeline: [{at, kind, sessionKey, text}]`，kind：`dispatch / report / reject / accept / error / stop / memory` | 新的在上；记忆写入也出一条（PLAN 6.2） |
| `changes` | 改动 Revisions | `changes: [{sessionKey, title, files: [{path, added, removed}]}]` | 按会话分组，点文件在工作台里打开 |
| `runtime` | 运行环境 Tempo | `runtime: {gateway: {connected, latencyMs}, models: [{id, health, lastError}], context: {used, max}, usage: {input, output, cost}, errors: [{at, text}]}` | 圆环是上下文用量，折线是这件事的用量随时间 |
| `memory` | 项目记忆 Repertoire | 已有的 `pinkie.metre.memory`（list / search / pin / edit / delete / stats） | 顶上写「现在用的是：<文件夹名>」和条数；九宫格是了解程度；按类别分组的卡片可钉住、编辑、删除、搜索。和状态条的芯片不重复：芯片只给数字和跳转 |
| `raw` | 原始记录 Log | `raw: [{at, event, data}]`（最近 200 条） | 默认收起 |

字段名是建议，你可以改，但改了要同时改这张表。

## 前端怎么接

```js
const board = window.__pinkieMetreBoard;
board.fill('plan', 节点);          // 换掉占位图，「待接入」标签自动消失
board.reset('plan');               // 退回占位（接口报错、没有数据来源时用）
board.setStat('state', '在等 2 个子会话');
board.setStat('running', '2/24');  // 会排成拍号那样上下两个数
board.enableActions({stop: fn, pause: fn});  // 「全部停下」「暂停派发」现在是禁用的
```

- 你的渲染代码写在新文件里（建议 `laolao-metre-board-data.js`），不要往骨架文件里塞请求和定时器：`tests/metre-skin-cat.test.cjs` 有一条断言骨架文件里没有 `setInterval`、`gwRequest`、`fetch(`。
- 刷新：监听 `pinkie:gateway-event`，每秒最多刷一次；没有事件不轮询（A5-2 要看 60 秒网络记录）。面板关着的时候不请求。
- 断线：页面顶上那句说明换成「连接断了，正在重连」，各区块保持上一次的数据并变灰，不许显示成做完（A5-7）。
- 没有数据（Metre 还没派过活）：每个区块写一句实话，例如「还没有子会话」，不要留占位图假装有内容。
- 颜色只用 `--metre-*` 变量（定义在 `laolao-metre-skin.css`）：正文 `--metre-text`、次要 `--metre-muted`、线 `--metre-line` / `--metre-line-strong`、卡片底 `--metre-card`、强调 `--metre-accent`（黄铜色，只给「正在进行」和「现在」用，一屏不超过三处）。失败用文字写「失败」加原因，不单靠颜色。
- 字：数字用 `--metre-serif`，其余 `--metre-sans`；卡片标题 14px / 500；说明 12.5px。
- 窄窗口（≤ 760px）骨架已经改成单列；你加的表格要能横向滚动，不许把页面撑宽。

## 和方案不同的地方（Fable 定的，用户 11-14 说「自己做自己决定」）

1. ~~总控台是**整页**，不是右侧面板。~~（11-15 作废，见文首）原因：用户要「可视化要丰富」，九个区块在 400px 宽的面板里只能排成一长条。A5-8「520 像素以下变成浮层」改成「760 像素以下单列」。
2. 子会话区画成总谱（时间在横轴），不只是表格。原因：Metre 这个名字和 Baton / Virtuoso 都是音乐的词，这是这个模式自己的样子；也比表格更容易一眼看出谁在跑、谁卡住。
3. 首页多了三张看板卡片（A4-13 原来写「首页只有三样」）。

## 还没人做的（不在这份骨架里）——11-15：三条都已做完

- `pinkie.metre.board` 接口本身、全停 / 暂停 / 接着做三个按钮的接线（批 5）。
- 侧栏「总控台」和卡片标题上的待处理数字。
- 资源关停（批 6）。
