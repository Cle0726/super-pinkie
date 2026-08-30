# 架构说明

```text
来啦～老弟.app
  ├─ WKWebView 桌面窗口
  ├─ 原生语音听写 / 音频播放
  ├─ 原生文件夹选择 / Finder 定位
  └─ 首次启动应用 UI 与人格
           │
           ▼
OpenClaw Control UI
  ├─ laolao-theme.css             透明玻璃与交互
  ├─ laolao-sidebar.js            置顶、项目、目录管理
  ├─ laolao-mode-switcher.js      三模式无缝切换
  ├─ laolao-live-voice.js         语音回合与摘要朗读
  ├─ laolao-image-viewer.js       图片放大
  ├─ laolao-phrases.js            中文人格状态话术
  └─ splash / transition assets   启动与切换动画
           │
           ▼
OpenClaw Gateway ── ur-rewrite-proxy ── 模型上游
           └────── transport patch ─────┘
```

## 更新边界

- Git 仓库是发布源。
- `update-full.sh` 拉取源码并重新安装。
- LaunchAgent 每 15 分钟检查一次本机 OpenClaw UI，官方更新覆盖 UI 后会自动重新应用。
- 人格文件不经过模板、变量替换或构建转换。
- 本机路径只存在于安装后生成的 `install.env` 和 LaunchAgent，不进入仓库。
