# Windows UI parity coordination

## 2026-11-02 — partial repair push

- Base: `origin/fix/windows-2.5.24` at `b2708dd402091963ba9bc0b4f31cf346df0e6637`. Do not use or merge `origin/main`.
- The user asked to push already checked work first. This partial change contains only the shared font/layout stylesheet, its cache version, and a focused regression test. The user authorized this repair push, not a tag or release.
- Do not overwrite unrelated work. Another session owns `services/mode-architecture/{work-kinds,index,reasoning}.mjs`, `laolao-deep-think.js`, `laolao-model-picker.js`, `personas/`, and `skills/deep-think/`; none are changed here.
- Desktop native controls, the built-in browser, dual-mode workspace, update-route fallback and their remaining tests are separate local candidates and are not represented as completed by this partial change.
- Preserve existing user chats, drafts, profile, model credentials and learning-desk layout. Screenshots and potentially private local evidence remain outside Git.

## 2026-11-03 — Windows UI publication review

- Publication review is isolated at `origin/fix/windows-2.5.24` commit `5bd4907`; do not merge `origin/main` or replace the newer Mac changes.
- The existing `portable-package-test` worktree has additional uncommitted browser/VPN diagnostics and changes which another session is actively modifying. Read for context only; do not overwrite, stage, reset, or push those uncommitted files.
- Select individual previously committed UI changes into this separate worktree, check them against the latest branch and run related tests. A partial push must identify its scope; the actual browser black-screen/VPN functionality and full Mac visual parity remain open until independently verified in the real App.

## 2026-11-13 — Windows 端：工具整改 tools-health-1113

- 分支 `fix/tools-health-1113`（基于 `origin/main` 5ff2aad2），Windows 工作树 `F:\Projects\tools-health`；主工作区 `F:\Projects\super-pinkie` 停在 `audit/pinkie-1112`，不动。
- 方案、验收、进度：`briefs/tools-health-1113/`（PLAN / ACCEPTANCE / WINDOWS-PROMPT / PROGRESS）。
- 会改的文件：`patch/apply-web-fetch-fakeip-v6.mjs`（新）、`patch/apply-image-access.mjs`、`patch/apply-all.mjs`、`installer/macos/apply-theme.sh`（只加补丁调用）、`desktop/windows/mac-runtime/`（同步补丁到快照 + SHA256SUMS）、`services/mode-architecture/` 下的 `background-jobs.mjs`、`app-browser.mjs`、`web-search-fallback.mjs`、`index.mjs`（工具注册 / 工具列表钩子）及对应 `tests/`；`tools/tool-health/`（体检脚本、`iso-windows/` 隔离副本脚本）。
- 不改：`personas/**`、`persona/*.md`、playbooks、破甲文档、`dev/study-game`、`main`、tag。
- 隔离副本在仓库外 `%USERPROFILE%\碧琪实测\iso-th`（自己的端口、令牌、主目录），正式 App / 18789 / `%USERPROFILE%\.openclaw` 只读。
