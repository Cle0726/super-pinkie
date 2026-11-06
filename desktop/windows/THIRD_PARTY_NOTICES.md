# Windows 内置运行时说明

超級碧琪 Windows 桌面版内置 Node.js、OpenClaw、Python、pywebview、aiohttp 与 edge-tts，使聊天网关、派对空间、灵感圆桌和语音服务无需另装命令行环境即可启动。

各组件继续使用其原许可证。模型 API Key、用户配置、人格、工作区、项目和聊天记录不打进 EXE，仍保存在当前 Windows 用户目录中；升级程序不会用发行包覆盖这些资料而不先备份。

## 碧琪的浏览器 · 浏览器节点

「浏览器节点」随包附带 [mihomo](https://github.com/MetaCubeX/mihomo)（v1.19.33，`runtime/browser-vpn/mihomo.exe`），按 GNU General Public License v3.0 发布。它是官方发布的未修改可执行文件，作为独立进程运行，只监听本机 127.0.0.1，且只有碧琪的浏览器窗口会把代理指向它；系统代理、聊天网关和模型连接都不经过它。源代码与许可证全文见 https://github.com/MetaCubeX/mihomo/tree/v1.19.33 。PyYAML（MIT）用于读取 Clash 订阅。

浏览器页面操作脚本（BrowserControl.js）与 Mac 版共用，属于本项目。
