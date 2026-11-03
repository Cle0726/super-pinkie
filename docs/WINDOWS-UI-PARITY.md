# One complete Pinkie UI

Mac and Windows ship one browser interface. The installed Mac App was the read-only migration reference, including its transparent native window and complete v26 chat renderer. The Windows backend compatibility snapshot remains separate from browser code.

## Sources and installation

- `ui/control-ui.index.html` owns the upstream entry, feature flags, preload links and inline bootstrap.
- `ui/injections/laolao-head.fragment.html` owns the custom injection order and human cache versions. Keep night initialization first and the single native-assets slot in place.
- `ui/injections/` and `ui/assets/` contain the full scripts, styles, illustrations, videos, nested vendors and fonts.
- `ui/runtime/` contains the reviewed browser chunks for pinned OpenClaw 2026.7.1-2: `chat-page-DrPkxqJK.js` (v26 timeline and thinking segments), `markdown-DgASfUKF.js` (math/linebreaks) and `index-Bvtt7vVx.js` (surface/browser/learning/drafts and dynamic imports). These were migrated from the installed Mac App. The entry chunk only adds a content hash to its chat imports; the other two retain the Mac bytes.

Both installers, the Python control center and the final Windows post-overlay step call `tools/ui-parity/bundle.py install`. Browser patches are already in the reviewed common renderer; installers apply backend patches, then install the complete common browser UI last. The old Windows snapshot no longer contains a competing entry or browser chunk.

A browser change in `patch/` must be reflected in the reviewed `ui/runtime/` chunks before packaging; changing a patch script alone does not change the shipped browser. Never leave a Mac hotfix only inside `/Applications`. Bring the reviewed UI files back into these sources first. Update the common entry/chunks together when advancing the pinned upstream browser runtime.

The generator preserves nested media, adds content hash cache keys, rejects unresolved LFS pointers / Windows case collisions, installs the same bootstrap bytes for CSP, and removes stale or retired UI. `ui/** -text` prevents Windows checkout from altering UI hashes. Do not copy user-generated statistics or learning exports into the source.

## Native transparency and startup

A transparent HTML body cannot show the desktop through an opaque native host. The Mac shell already sets its window clear/nonopaque and disables WKWebView's page background. Windows now uses a transparent WebView2 base (`WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00000000` and `DefaultBackgroundColor=Transparent`), a black DWM client canvas and `DwmExtendFrameIntoClientArea` with all margins -1. The default Mica fill is disabled. The whole window and its text retain full opacity. The pywebview version is pinned to 6.2.1, whose actual WinForms/Edge implementation supplies these APIs.

`ui/parity-policy.json` lists the native-only App icon. Browser resources have no platform exceptions. Both platforms use the locally bundled full OFL Noto Sans SC variable WOFF2, with code/terminal text retaining monospace fonts. Software-renderer detection records diagnostics only; it never disables glass, canvas, 3D, video or reduces animation rates.

Windows onedir and onefile launchers use the standard `requireAdministrator` manifest (`--uac-admin`). The OS still handles UAC consent. Gateway/probe/repair children use hidden-window flags. Explicit Explorer and control-center windows remain visible. Logs remain in their normal files.

## Verification and release gates

`bundle.py source --tracked` validates source assets and templates against Git. `bundle.py check` reads each actual package back after every overlay. The manifest includes the complete entry HTML, custom injection sequence, all common resources and every upstream `control-ui/assets/` chunk. `bundle.py compare` rejects any difference; it does not trust a manifest copied into a package. Release publishing waits for both final manifests and Windows smoke.

`tools/ui-parity/capture.mjs` serves the actual packaged files with deterministic isolated RPC fixtures. Its five views are home, chat, thinking cards (all four decoded videos), sidebar and learning desk; project mode is the default to match the supplied Mac references. It enters the homepage through the real mode picker and waits for the welcome/transition to settle; full motion is retained. A mode mismatch fails the capture. It blocks external HTTP and routes all gateway sockets to the fixture; it never uses the live 18789 gateway.

Windows smoke attaches this capture to the actual packaged WebView2, with a random localhost debug port only for its isolated profile. `tools/windows-smoke/desktop_shot.py` also captures the real native window over two independent temporary windows behind it. Home/chat and a maximized home view must show broad pixel changes through the chat surface. A global window-alpha fade is rejected. This checks desktop transparency, beyond a browser-only screenshot. The existing smoke independently verifies the real test gateway, five modes and CSP.

The non-publishing `UI parity` workflow builds both Apps and collects evidence. Local Chrome-on-macOS captures are supporting browser evidence and are labelled as such; they are never Windows native proof. Playwright WebKit currently times out locally even on the unmodified installed-Mac UI copy; this remains a failed/pending engine check, without disabling visual effects or accepting it as a pass. Real Windows native evidence and a screenshot review are still required before calling parity complete.
