const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('native WKWebView has an explicit clear under-page and early native marker',()=>{
  const source=read('desktop/macos/Sources/Launcher.swift');
  assert.match(source,/data-pinkie-native-glass/);
  assert.match(source,/injectionTime: \.atDocumentStart/);
  assert.match(source,/webView\.underPageBackgroundColor = \.clear/);
  assert.match(source,/webView\.setValue\(false, forKey: "drawsBackground"\)/);
});

test('native glass keeps density fixed while preserving movement',()=>{
  const css=read('ui/injections/laolao-theme.css');
  assert.match(css,/data-pinkie-native-glass/);
  assert.match(css,/@keyframes laolao-native-wallpaper-enter[\s\S]*0% \{ opacity: 0\.52; transform: scale\(1\.012\)/);
  assert.match(css,/@keyframes laolao-native-glass-enter[\s\S]*0% \{ opacity: 1; transform: translateY\(9px\)/);
  assert.match(css,/data-pinkie-native-glass="1"\] \.card\.chat[\s\S]*animation: none !important/);
  assert.match(css,/@keyframes laolao-avatar-enter/);
  assert.match(css,/animation: laolao-mode-sweep/);
});

test('live UI updates avoid redundant root styles and forced synchronous layout',()=>{
  const mode=read('ui/injections/laolao-mode-switcher.js');
  const usage=read('ui/injections/laolao-usage-stats.js');
  assert.match(mode,/if \(previousMode !== mode\.id\) \{\s*document\.documentElement\.setAttribute/);
  assert.doesNotMatch(usage,/offsetWidth|offsetHeight|getBoundingClientRect/);
  assert.match(usage,/el\.animate\(\[/);
  assert.match(usage,/Math\.max\(Number\(fileStats\[key\]\)/);
  assert.match(usage,/runtimeIncluded: true/);
});

test('installer cache-busts the native glass assets',()=>{
  const installer=read('installer/macos/apply-theme.sh');
  assert.match(installer,/laolao-theme\.css\?v=theme35/);
  assert.match(installer,/laolao-sidebar\.css\?v=sidebar17/);
  assert.match(installer,/laolao-sidebar\.js\?v=sidebar15/);
  assert.match(installer,/laolao-session-list\.js\?v=sessions5/);
  assert.match(installer,/trap reseal_app_on_exit EXIT/);
  assert.match(installer,/codesign --force --deep --sign -/);
  assert.match(installer,/Computer Use v2 patch skipped/);
  assert.match(installer,/laolao-deep-think\.js\?v=deepthink15/);
  assert.match(installer,/laolao-splash\.css\?v=splash18/);
  assert.match(installer,/laolao-splash\.js\?v=splash22/);
  assert.match(installer,/laolao-mode-switcher\.js\?v=mode28/);
  assert.match(installer,/laolao-usage-stats\.js\?v=stats15/);
  assert.match(installer,/laolao-classic-shell\.css\?v=classic11/);
  assert.match(installer,/laolao-classic-shell\.js\?v=classic11/);
  assert.match(installer,/laolao-side-layout\.css\?v=side12/);
  assert.match(installer,/laolao-side-layout\.js\?v=side12/);
  assert.match(installer,/laolao-memory\.css\?v=memory1/);
  assert.match(installer,/laolao-memory\.js\?v=memory1/);
  assert.match(installer,/s\{\"\\\.\/laolao-\}\{\"\/laolao-\}g/);
});

test('assistant replies get a subtle readable surface without slowing streams',()=>{
  const css=read('ui/injections/laolao-theme.css');
  const bubbleBlock=css.match(/chat-group\.assistant:not\(\.chat-group--forwarded\)[\s\S]*?\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(bubbleBlock,/background: rgba\(255, 250, 252, 0\.24\)/);
  assert.match(css,/chat-bubble:not\(\.chat-bubble--tool-shell\):not\(\.chat-reading-indicator\)/);
  assert.doesNotMatch(bubbleBlock,/backdrop-filter/);
});

test('chat layout keeps both rails out of the message column',()=>{
  const css=read('ui/injections/laolao-side-layout.css');
  assert.match(css,/grid-template-columns: minmax\(0, 1fr\) var\(--laolao-window-rail-reserve\)/);
  assert.match(css,/chat-workspace-rail\.laolao-classic-workspace-rail[\s\S]*position: relative !important/);
  assert.match(css,/chat-workspace-rail\.laolao-classic-workspace-rail[\s\S]*grid-column: 2 !important/);
  assert.match(css,/@media \(max-width: 1120px\)[\s\S]*display: none !important/);
  assert.match(css,/chat-bubble :is\(p, li, blockquote, a\)[\s\S]*overflow-wrap: anywhere/);
  assert.doesNotMatch(css,/padding-right: var\(--laolao-window-rail-reserve\)/);
});
