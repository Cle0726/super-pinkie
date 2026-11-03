# Windows UI parity — partial progress

Status: **in progress; visual parity and full Windows acceptance are not complete**.

## Scope in this partial push

- Apply the bundled Chinese font to UI labels that otherwise override their parent's font; leave book-style welcome text, code, mathematics and animations intact.
- In Windows learning-desk multi-page layouts, reserve space between each page's close button and the “本月” entry. This does not close, remove or deduplicate the user's existing pages.
- Increment the stylesheet cache version and add a focused regression test. No other desktop, browser, persona or release changes are included in this partial push.

## Real Windows evidence

- Windows 11 Home `10.0.26200`, NVIDIA GeForce RTX 4060 Laptop GPU, WebView2 Runtime `154.0.4258.62`; actual WebView2 reported Direct3D 11 GPU rendering, not software rendering.
- In an actual packaged App using the user's profile, two existing “今日” pages had the page-close button covering “本月”. With the stylesheet fix packaged, hit testing confirmed both controls reach themselves. Page widths of 320, 360, 480, 582 and 760 CSS pixels were checked without saving a new layout; all 20 visible header controls stayed in their page and were individually reachable.
- The user accepted a more opaque `.94` light background in a separate local native candidate. This partial commit does not itself include that host change. Do not treat this as a desktop-transparency or Mac visual-parity pass.
- Local screenshots and diagnostic JSON are saved under this machine's `briefs/windows-ui-parity/shots/` and `evidence/`; they are not published because they may contain user information.

## Verification and remaining work

- Focused Node stylesheet regression and shared-UI source checks are recorded by the handoff. The full Windows Node gate on the candidate and clean `b2708dd` baseline remains red: 84 failures each, 43 listed known, with no additional unexpected failure names. The failure list was not changed.
- Upstream CI `41571354564`: Windows build succeeded; Mac WebKit and Windows smoke did not pass. A Mac manifest from a run built from the same eventual source is still needed for final `bundle.py compare`.
- Built-in browser, mode double-open, workbench controls, real desktop transparency, animations, onefile/update behavior and the final Mac comparison remain under investigation or require further real-window validation. Do not close the overall task based on this partial push.

## Subsequent partial repair: readable Windows background

- The user explicitly asked to push the more opaque Windows background already accepted on their machine. The native Windows surface paints light `rgba(255,250,249,.94)` and dark `rgba(20,17,25,.96)` behind content, follows theme changes, and never applies whole-window opacity or removes effects. This is the same reading-surface code previously exercised in the real packaged candidate.
- This pushes the reading surface only; it is not a claim that the unfinished browser, dual-mode workspace, updater, onefile acceptance, desktop-transmission gate or full Mac parity are complete. The earlier native pixel-transmission check remained false at the user's requested opacity and was not weakened.
- Added an executable regression of the actual injected script, including theme switches, repeated injection and a late document body; no user configuration or conversation is changed by the test.
- On this Windows host the full `tests.windows_desktop_test` run produced 12 passes and one `WinError 32` while removing a temporary relay log after the relay test. The reading-surface and native bridge health tests passed; the relay cleanup failure remains recorded and is not counted as a green full-suite run.

## Portable updater investigation — Windows, 2026-11-03

- The local updater log showed a downloaded and checksum-verified v2.5.27 followed by `switching to 2.5.27`, but no decisive helper completion/error record for that historical attempt. This does **not** establish that the user's failure was caused by missing administrator rights.
- On Windows 11 Home 10.0.26200, a real-process fixture reproduced two independent old-version failures: the v2.5.26 PowerShell 5.1 helper read a no-BOM UTF-8 script using the Windows ANSI codepage and rejected the garbled Chinese package layout; adding only the BOM still left the old gateway and relay running. A port-binding fixture demonstrated that the stale gateway can make the replacement fail and roll back. The published v2.5.26 updater cannot retroactively acquire this fix; affected existing installs need a one-time manual replacement or a separately released migration path.
- A second fixture reproduced PowerShell 5.1 inheriting an incompatible PowerShell 7 module path, causing update validation to fail. The replacers now prefer their own inbox modules, probe write access and required commands, and acknowledge readiness before the App closes. A real test-directory ACL denial produced the explicit permission message without closing the old process; that controlled denial is not evidence about the user's historical directory ACL.
- The onedir helper verifies the payload first, stops only processes whose executable belongs to the target installation, and checks the gateway listener separately. A gateway from a different install is stopped only when the recorded PID, executable path, bundled-node suffix and gateway command line all match; an unidentified listener leaves the App and that process running. Process fixtures checked same-install and verified-other-install gateways, a missing/stale owner record, an unrelated command, a retained unrelated child, bad checksum, failed new-version health and rollback. A pre-existing backup was not overwritten. User profiles and the live gateway were not used by these fixtures.
- Replay on Windows with Python 3.12: `python -m unittest -v tests.windows_portable_update_integration_test tests.windows_update_test tests.windows_stale_gateway_test`. Related integration evidence and logs are local task artifacts, not checked into Git. The onefile helper also gains preflight, readiness and unique backup handling; this work has not established a complete packaged onefile-update pass.
- The real packaged App update flow is being built and verified separately; do not infer package acceptance, release availability, Mac visual parity or VPN connectivity from these process-fixture results.
