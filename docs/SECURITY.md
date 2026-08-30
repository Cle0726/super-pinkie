# 安全与隐私

- 仓库不包含 API Key、Token、Cookie、OpenClaw 配置、聊天记录或个人记忆。
- 安装器不会上传本机文件。
- 提供者 ID、安装路径等本地信息只写入 `~/.config/super-pinkie/install.env`。
- TTS 和提示词代理默认仅监听 `127.0.0.1`。
- 安装前会备份已有的人格文件；卸载不会删除聊天、记忆和项目。
- macOS 自动构建产物使用本机临时签名。公开分发若需要免除 Gatekeeper 提示，应另行配置 Apple Developer ID 与公证密钥，并把密钥只放在 GitHub Actions Secrets 中。

发现仓库意外包含敏感内容时，请立即撤销相关凭据，并通过 GitHub Security Advisory 私下报告。
