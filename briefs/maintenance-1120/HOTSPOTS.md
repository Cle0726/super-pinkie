# 碧琪维护 · 修复热点（前 30）

- 统计日期：2026-11-20；窗口：2026-09-22 至 2026-11-20（UTC，自然日，含首尾；按提交者时间）。
- 基于提交：`2c1fa0bb28d6326d5459376748a8440f155d80ab`。仅统计此提交可达历史，不扫其他分支。
- 复现命令：`node tools/health/hotspots.mjs --ref 2c1fa0bb28d6326d5459376748a8440f155d80ab --as-of 2026-11-20`
- 按提交标题筛选：以 `fix` 开头，或含 `修`、`repair`、`regress`、`restore`（英文不区分大小写）。
- 排除合并提交、Markdown、图片、JSON；每个路径每提交计一次。重命名按两个路径处理；次数相同按路径排序。
- 命中 293 个修复类提交，涉及 1648 个未被筛掉的文件。

| 排名 | 文件 | 修复提交数 |
|---:|---|---:|
| 1 | `ui/injections/laolao-head.fragment.html` | 56 |
| 2 | `installer/macos/apply-theme.sh` | 40 |
| 3 | `services/mode-architecture/index.mjs` | 39 |
| 4 | `desktop/windows/mac-runtime/SHA256SUMS` | 34 |
| 5 | `app/windows_desktop.py` | 27 |
| 6 | `installer/windows/apply-theme.ps1` | 24 |
| 7 | `desktop/windows/mac-runtime/services/mode-architecture/index.mjs` | 22 |
| 8 | `app/super_pinkie.py` | 18 |
| 9 | `tests/mode-architecture.test.mjs` | 18 |
| 10 | `ui/injections/laolao-resume.js` | 15 |
| 11 | `VERSION` | 12 |
| 12 | `desktop/macos/Sources/Launcher.swift` | 12 |
| 13 | `services/mode-architecture/setup.py` | 11 |
| 14 | `patch/apply-chat-timeline.mjs` | 10 |
| 15 | `tests/native-glass.test.cjs` | 10 |
| 16 | `tests/self-contained-app.test.cjs` | 10 |
| 17 | `ui/injections/laolao-context-compact.js` | 10 |
| 18 | `ui/injections/laolao-session-list.js` | 10 |
| 19 | `desktop/macos/build.sh` | 9 |
| 20 | `tests/chat-tool-timeline.test.mjs` | 9 |
| 21 | `tests/resume-ui.test.cjs` | 9 |
| 22 | `tests/windows-self-contained.test.cjs` | 9 |
| 23 | `ui/injections/laolao-mode-switcher.js` | 9 |
| 24 | `patch/apply-all.mjs` | 8 |
| 25 | `services/cle-studio/src/main.js` | 8 |
| 26 | `tests/cle-startup.test.mjs` | 8 |
| 27 | `ui/injections/laolao-companion.js` | 8 |
| 28 | `ui/injections/laolao-game-battle.js` | 8 |
| 29 | `ui/injections/laolao-study-desk-drill.js` | 8 |
| 30 | `ui/injections/laolao-theme.css` | 8 |
