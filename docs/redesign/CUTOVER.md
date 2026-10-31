# Cutover checklist — staging (2026.10.4, profile cle) → the live app

Only when the user is idle. Back up first: `~/.openclaw` (config, agents, workspaces), the app bundle's
`Contents/Resources/SuperPinkie`, and `PinkieAppIcon.icns`. Everything below has been exercised on staging first.

## Runtime
- [ ] OpenClaw 2026.10.4 runtime into the bundle; `doctor --fix` on the live state dir (config shape `agents.entries`,
      exec-approvals migration — staging needed both).
- [ ] Auto-update off: `update.checkOnStart=false`, `update.auto.enabled=false`, `nodeHost.autoUpdate.enabled=false`,
      Launcher env `OPENCLAW_NO_AUTO_UPDATE=1`.
- [ ] `gateway.controlUi.experimental.customPlugins: true`; plugin `cle-studio` in `plugins.load.paths`/`allow`.
- [ ] Gateway env for plugins that call the CLI: `PINKIE_OPENCLAW_ENTRY` = bundled 2026.10 `openclaw.mjs`
      (staging's watchdog looped against the old CLI until this was set).
- [ ] Patches: `patch/apply-all.mjs` (regenerates .br/.gz + asset-manifest).

## Character & modes
- [ ] `agents.entries.*.identity`: name `Li An`, emoji 🐈‍⬛, avatar `avatars/li-an.png` (copy into each workspace),
      theme text per mode; keep the user's 【执行准则】 suffix in main's theme verbatim.
- [ ] Workspaces (not unrestricted): SOUL.md, IDENTITY.md, AGENTS.md, AESTHETICS.md, persona/* from `personas/`.
      The user's 「桌面自动化执行指令」 section must stay byte-identical (verified on staging).
- [ ] `services/mode-architecture` → live extension (renamed strings, learning pact, ask prefix 【回答 Li An 的提问】).

## Brand
- [ ] App icon: replace `Contents/Resources/PinkieAppIcon.icns` with `ui/assets/CLeAppIcon.icns` (same file name, so
      Info.plist need not change); `touch` the bundle to refresh the icon cache.
- [ ] Bundle display name (CFBundleDisplayName) → `C.le.` — ask the user before renaming the .app itself.
- [ ] Remove the old `ui/injections` loader from index.html (the plugin replaces it); keep files for rollback.

## Verify on the live app
- [ ] Splash plays once per launch; all five rooms switch with the eye-window blink; welcome art loads.
- [ ] Real Gemini 3.8 turn in each mode: status line (think/tool/write/done), bubble-less transcript, pet states.
- [ ] Sidebar: sessions per mode, projects, rename/pin/archive/delete synced with the native state.
- [ ] 习作: ledger reads real progress; focus timer; pact sheet saves; reminders.
- [ ] Night and day; no pink anywhere; no developer chrome.
