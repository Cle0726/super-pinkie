# 聊天界面模拟网关（chat-ui harness）

在浏览器里运行**真实的**聊天页（已安装 App 的原生 OpenClaw 聊天代码 + 仓库里的 `laolao-*` 注入脚本），只把网关连接换成页面内的模拟网关。这样不花模型额度、不动正在用的 App，就能反复重放「多次工具调用」「看门狗续跑」「历史同步」，检查聊天区渲染是否正确。

「工具调用后最终回复不显示、要重开 App」这个 bug 就是用它复现并验证修复的。

## 启动

```bash
python3 scripts/chat-ui-harness/server.py --port 18811
```

然后用浏览器打开终端里打印的地址：

```text
http://127.0.0.1:18811/chat?session=agent%3Aunrestricted%3Adashboard%3Aharness0001
```

参数：

- `--ui-root DIR`：提供 `index.html` 和原生 bundle 的 control-ui 目录。默认是已安装 App 里的 `runtime/openclaw/dist/control-ui`。
- `--injections DIR`：用这个目录里的 `laolao-*` 文件替代已安装的版本。默认是仓库的 `ui/injections`，所以改完注入脚本刷新页面就能看到效果。
- `--installed-injections`：改用已安装的注入脚本，用于对比改动前的样子。

`laolao-head.fragment.html` 里新增、但已安装的 `index.html` 还没引用的 `laolao-*` 脚本和样式，会自动注入页面。Service Worker 被禁用，所有响应都不缓存。

## 在页面控制台里使用

```js
// 发一条消息时自动触发某个场景（走真实输入框，和用户操作一致）
__fake.auto('narrated', {gap: 300});
__fake.checks.send('帮我跑一下基线测试');

// 也可以直接触发（不经过输入框）
await __fake.scenario('watchdog', {rounds: 2});

// 检查
__fake.checks.captureRenderErrors();   // 先调用一次，之后返回聊天面板渲染报错列表；"rebuilt:" 开头表示已自愈重建
__fake.checks.brokenLitParts();        // 被脚本删掉标记的 Lit 文字绑定，正常应为 []
__fake.checks.threadStatus('【最终回复】'); // 回复是否在 DOM 里、是否滚动到可见
__fake.checks.groups();                // 当前渲染出的每个分组：角色、头像、工具进度标签、首段文字

__fake.setModel('gemini-3.8-flash');   // 模拟会话模型变化（会触发模型标签重绘）
__fake.tail();                         // 最近的请求和事件日志
```

`threadStatus` 等布局检查依赖真实窗口尺寸。窗口被隐藏时 `viewport` 会是 `0x0`，结果没有意义；测试时保持窗口可见，建议用 1440×900 左右的尺寸。

## 场景

所有场景都接受 `gap`（事件间隔毫秒，默认 250）和 `reply`（最终回复文字）。

| 场景 | 模拟内容 | 其他参数 |
|---|---|---|
| `narrated` | 每次调用工具前先流式输出一句说明。和真实记录一样，这句说明与 toolCall 存在同一条助手消息里。 | `steps`：`[说明, 工具名, 参数, 结果]` 数组；`thinking: true` 附带思考块 |
| `multiTool` | 同一轮里连续多次工具调用后回复 | `tools`：次数；`parallel: true` 最后再来一条消息里的两个并行调用 |
| `watchdog` | 第一轮工具调用后没回复就结束，网关看门狗从另一个连接（CLI）续跑。续跑会插入不可见用户消息 U+2063，并用新的 runId | `rounds`：续跑次数；`r1Terminal: 'error'` 首轮以错误结束（`chat` 错误事件按 15 秒宽限延后，`graceMs` 可调） |

### 追加消息 / 队列自愈（a–f）

这些场景专门给“碧琪正在思考或跑工具时继续补一句”的回归测试用。它们不伪造
composer 队列：页面仍用原生的 `chatQueue`、`steerQueuedChatMessage` 和
`retryQueuedChatMessage`。假网关只决定当前 run 是否接收引导、是否丢终止事件，并记录
真正收到的消息。`__fake.checks.deliveries()` 中每个 idempotency key 最多一条，能查重发。

| 场景 | 含义 | 修复前可观察现象 |
|---|---|---|
| `queue-normal`（别名 `busy-queue-normal`） | 忙碌首轮正常 `final`；用 Alt/Option+Enter 排队的消息应在结束后发出。 | 这是基线，原生本来能发出。 |
| `queue-missing-terminal`（别名 `busy-queue-missing-terminal`） | run 实际已结束，`sessions.list` 已是 idle，但没有 lifecycle/end、chat/final 或 sessions.changed。 | `forceIdle` 只清忙碌字段，卡片一直停在输入框上方，`deliveries()` 没有该消息。 |
| `steer-accepted` | 当前 run 回 `accepted`，并把追加内容作为真实 user 记录持久化。 | 已追加卡会等旧 run 的终止事件；该事件丢失时不会消失。 |
| `steer-race-ended` | UI 刚开始引导，run 就在确认前结束；网关回 `timeout`，且不会持久化该消息。 | 卡片遗留，用户得手动 Retry；原文容易一直不发。 |
| `queue-refresh` | 向**原生** composer localStorage 写入一张带过期 `failed` / `steered` / `pendingRunId` 的卡；随后刷新页面。 | 恢复后的卡因旧状态不再被原生发送路径接手。 |
| `watchdog-append` | 首轮结束后 `pinkie-watchdog-*` 新 run 续跑；追加消息必须绑定新 run，而不是不可见的 U+2063 控制消息。 | UI 仍盯旧 runId，追加或已引导卡时机错乱，续跑可能吞消息。 |

队列场景的 `auto` 默认只消费第一条用户发送，后面由真实原生队列重试，不会再次启动首轮：

```js
// a：首轮运行时按 Option/Alt+Enter，明确“结束后发”
__fake.auto('queue-normal', {gap: 180, holdMs: 1400});
__fake.checks.send('先做一个多步任务');
setTimeout(() => __fake.checks.send('等这一轮结束再发', {altKey: true}), 350);

// b：终止事件丢失。首轮运行时同样排队，随后让 resume 走真实的 idle 自愈。
__fake.auto('queue-missing-terminal', {gap: 180, holdMs: 900});
__fake.checks.send('模拟丢失结束事件');
setTimeout(() => __fake.checks.send('仍然要发出去', {altKey: true}), 350);
// 正常会在下一次空闲检查自愈；手动验可用：await __laolaoStaleBusy.reconcileQueued()。

// c：普通 Enter 默认应立即追加；最终回复会带“已按追加信息调整”。
__fake.auto('steer-accepted', {gap: 180, holdMs: 1400});
__fake.checks.send('先开始处理');
setTimeout(() => __fake.checks.send('改成用 X 方法'), 350);

// e：写完原生持久化后刷新；重新进入空闲会话后应自动接手该卡。
await __fake.scenario('queue-refresh', {message: '刷新后继续发'});
location.reload();
```

`steer-race-ended` 和 `watchdog-append` 的用法与 c 相同。前者要在首轮工具期间发
追加消息；后者等第二个 `pinkie-watchdog-*` run 出现后再发。检查时同时看：

```js
__fake.checks.queue();                 // 原生队列卡和按钮
__fake.checks.deliveries();            // 网关真正收到、且没有重复的消息
__fake.tail(80);                       // queue-probe / terminal-dropped / delivery 记录
__fake.checks.captureRenderErrors();
__fake.checks.brokenLitParts();
```

测试文件 `tests/chat-ui-harness.test.cjs` 也逐个固定了 a–f 的协议结果；它记录的
`beforeFix` 字段就是每个复现的修复前现象，方便 UI 改动后对照。

## 重放真实会话

在页面脚本运行前定义 `window.__fakeSeedHistory`（真实 `chat.history` 返回的 `messages` 数组），假网关就用它代替默认的问候作为历史。用 CDP 的 `Page.addScriptToEvaluateOnNewDocument` 注入即可：

```bash
openclaw gateway call chat.history --json --params '{"sessionKey":"agent:learning:…","limit":80}' > history.json
```

刷新后工具结果的显示（`chat.history` 只保留 toolResult，不带调用参数）就是这样复现的。

## 模拟的网关行为（对应 OpenClaw 2026.7.1-2）

- `chat` 增量和 `final` 广播给所有连接。同一轮的文字跨工具调用累积（上一段 + 新增量，中间不加分隔），`final` 带的是整轮累积文字。所以流式界面收尾时，说明句会和最终回复合在同一条消息里；历史同步后，它们又是分开存储的消息。
- 工具事件：发起 `chat.send` 的连接收到 `agent`，其他订阅会话的连接收到 `session.tool`。看门狗续跑是 CLI 发起的，所以界面只会收到 `session.tool`。
- 每条落盘的记录都会发 `session.message`；运行开始、结束发 `sessions.changed`。
- 未模拟的 RPC 一律返回 `{}`。

## 测试原生 bundle 补丁

`index.html` 和 `assets/chat-page-*.js` 都来自 `--ui-root`。要验证对原生 bundle 的补丁（比如 `installer/macos/apply-theme.sh` 里对 `chat-page-*.js` 的 perl 替换），先复制一份再在副本上打补丁：

```bash
cp -R "/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui" /tmp/pinkie-ui
# 对 /tmp/pinkie-ui/assets/chat-page-*.js 执行同样的补丁
python3 scripts/chat-ui-harness/server.py --ui-root /tmp/pinkie-ui
```

不要直接改已安装 App 里的文件。

## 协议测试

`tests/chat-ui-harness.test.cjs` 固定了模拟网关依赖的协议形状（握手、历史分页、累积文字的 `final`、`agent` / `session.tool` 分发、看门狗续跑），随 `node --test tests/*.test.cjs` 一起运行。改模拟网关时同步更新。
