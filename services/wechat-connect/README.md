# Li An 微信连接

使用腾讯官方 `@tencent-weixin/openclaw-weixin@2.4.9` 处理微信协议。扫码在独立的官方 `channels login` 后台进程中进行；本插件只捕获二维码、刷新和验证码提示，提供常用设置页面的短请求接口。登录凭据仍由官方插件保存在本地，原始输出、令牌和验证码不会返回或落入网页存储。

每次登录使用权限为 0600 的独立临时 `OPENCLAW_CONFIG_PATH`，只启用微信插件；`OPENCLAW_STATE_DIR` 保留官方账号目录。这样 CLI 自动启用插件、登录成功后的配置写入都不会碰到主网关设置，也不会中断自己的扫码任务。子进程退出后删除该临时目录，成功连接仍由桥接验证路由后合并到主配置。

当前运行时缓存旧桥接时，`apply-cli-isolation.mjs` 为 App 的 CLI 启动文件添加精确匹配的兼容入口：仅匹配非 TTY、`NO_COLOR=1` 的自动化 `channels login --channel openclaw-weixin`。它在加载 runtime 之前调用 `legacy-cli-isolation.mjs`，只改变新登录子进程的环境，不改变正在运行的网关。其独立临时目录在正常退出时清理；原 launcher 的信号转发保持原样。其他 CLI 命令和交互式登录不进入此分支。

扫码前必须有 `openclaw-weixin` → `unrestricted` 的显式 binding，微信使用自己的 `per-account-channel-peer` 会话。连接成功后增加该账号的专用 binding，保留已有配置。断开连接只暂停该微信账号，聊天记录保留。

`apply-weixin-adapter.mjs` 只接受发布包 2.4.9 的两个 SHA-256 已知文件，同时修改源码和编译结果：

- 微信私信只允许本次扫码者，身份丢失时不处理消息；检查在命令和媒体下载之前。
- 最后投递位置遵循 `route.lastRoutePolicy`，不把独立微信会话写到桌面主会话。

未知文件结构完全拒绝写入；重复应用不修改文件。原始文件以 `.pinkie-original` 保留。

首次启用需要先放入已核验发布包和本插件，再合并插件注册设置。更改 `plugins.allow` 在当前宿主可能触发网关内部重启；`restart: null` 和 PID 不变均不能证明没有重启，应核对 `gateway/shutdown` 日志，并遵守用户的重启限制。已注册后的扫码只运行独立登录子进程，不更改插件开关。确认微信渠道已注册后再合并微信账号配置与路由。最低宿主要求以官方包声明为准，当前验收宿主为 OpenClaw 2026.7.1-2。

接口：`pinkie.wechat.status`、`pinkie.wechat.login.start`、`pinkie.wechat.login.verify`、`pinkie.wechat.login.cancel`、`pinkie.wechat.disconnect`。取消和数字提交必须携带当前登录作业 ID，旧页面不能取消新的连接。二维码只保存在网关内存，过期、取消和成功后清除。
