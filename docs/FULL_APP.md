# 完整 App 安装与更新

## 运行条件

- macOS 13 或更高版本
- 已安装并能正常运行的 OpenClaw
- Git、Node.js、Python 3、Xcode Command Line Tools
- 首次安装语音依赖时需要联网

## 完整安装

```bash
git clone https://github.com/Cle0726/super-pinkie.git
cd super-pinkie
./install-full.sh
```

需要把某个 OpenAI 兼容提供者指向提示词代理时：

```bash
./install-full.sh --provider mm
```

安装器会完成：

1. 备份已有 `SOUL.md` 与 `IDENTITY.md`。
2. 原样安装三套人格文件。
3. 调用仓库原有安装器，部署提示词、代理和传输补丁。
4. 建立隔离的 Python 虚拟环境并安装晓伊语音服务。
5. 编译本机签名的「来啦～老弟.app」。
6. 注入完整 UI、模式、转场、项目文件夹与图片查看功能。
7. 注册语音服务和 UI 自动重应用任务。

安装器不会读取或上传 API Key，也不会复制 `openclaw.json`、`USER.md`、`TOOLS.md`、记忆或聊天记录。

## 更新

可以在 App 菜单中选择“检查并安装更新…”，也可以运行：

```bash
./update-full.sh
```

更新只接受 Git 的快进合并，拉取成功后重新运行完整安装。人格文件仍然直接复制仓库原件，不执行文本替换。

## 配置

默认配置文件：

```text
~/.config/super-pinkie/config.json
```

可配置网关和语音地址：

```json
{
  "gatewayURL": "http://127.0.0.1:18789/",
  "speechURL": "http://127.0.0.1:18888/v1/audio/speech"
}
```

也可以通过 `PINKIE_GATEWAY_URL`、`PINKIE_SPEECH_URL` 临时覆盖。

## 卸载

```bash
./uninstall-full.sh
```

App 会被移到废纸篓；聊天、记忆、项目和人格备份不会自动删除。
