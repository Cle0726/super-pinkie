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
