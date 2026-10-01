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
