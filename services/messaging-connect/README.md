# 飞书与 QQ 连接入口

飞书固定连接学习模式（account `pinkie-learning`）；QQ 固定连接项目模式（account `pinkie-project`）。微信无限模式连接独立保留。

使用已校验 npm 完整性、与当前 2026.7.1-2 核心兼容的官方 `@openclaw/feishu@2026.7.1` 和 `@openclaw/qqbot@2026.7.1`。不调用会改全局配置的交互式安装器，不更新核心。QQ 的配对适配有原包 SHA 校验、全部文件写前检查、原文件备份与幂等检查。

连接入口提供官方二维码和手动 App ID / App Secret。凭据仅写入已有私有配置；状态 RPC 和日志不回传 secret。二维码严格校验各平台 HTTPS 域名，取消和刷新不能被旧请求覆盖。

QQ 必须先选择具体项目目录。扫码完成后，机器人私信返回配对码；用户在连接卡片确认配对码后，先绑定新的独立会话，再批准确切帐号，并显式授予该帐号命令权限。配对同时校验连接 accountId 和机器人 App ID。换机器人先清理旧帐号授权；未配对消息只返回配对提示，不执行工具或读取附件。恢复页面可继续未完成配对，无需重新扫码。

路由使用 `binding.session.dmScope=per-account-channel-peer` 和 direct peer 通配绑定，保持桌面与各平台会话独立。QQ 调用已有 ProjectScope 绑定自己的会话，禁止修改全局 workspace 或挪用桌面会话。

“已连接”要求官方 channel runtime 的 connected=true，模式路由正确；QQ 额外要求帐号配对和项目绑定。保存应用信息不算接通。默认禁用群聊。

初始化时，两个 channel 都必须设为 `enabled: true, accounts: {}`。空帐号不会连接平台，但能让核心在启动时加载 channel 的热更新规则。把 channel 设成禁用会使首次保存帐号触发全网关重启；仅启用插件 entry 不足以避免这一点。预检必须验证真实 startup selection，再验证首次凭据写入只重启对应 channel。

部署先静态校验、备份 App 与配置。网关运行中修正空 channel 时，先用临时 hot 模式写入启用状态，看到日志确认忽略重启后恢复原 reload 配置，再仅刷新对应插件 entry。启用插件会热刷新插件服务，所以必须先检查活动任务和 App 浏览器服务空闲。用解析后的重启日志和进程启动时间共同验收；只检查 PID 无法排除进程内重启。

目标回归：`node --test tests/messaging-connect.test.mjs tests/messaging-settings-ui.test.cjs tests/wechat-settings-ui.test.cjs tests/user-settings.test.cjs tests/qq-connect-adapter.test.mjs tests/messaging-startup.test.mjs`。QQ 发布包测试设置 QQ_ADAPTER_TEST_PACKAGE_ROOT，SDK 集成测试设置 OPENCLAW_ADAPTER_TEST_RUNTIME_ROOT；启动集成测试另设 FEISHU_CONNECT_TEST_PACKAGE_ROOT 和 QQ_CONNECT_TEST_PACKAGE_ROOT，指向已安装的两个 channel。验收必须无 skip。原生目录选择器仅由用户点击启动，测试不打开前台窗口。
