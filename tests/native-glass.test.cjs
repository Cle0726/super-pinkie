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

test('native composer uses a stable surface instead of a live backdrop blur',()=>{
  const css=read('ui/injections/laolao-theme.css');
  const block=css.match(/WKWebView to sample and blur[\s\S]*?html\[data-pinkie-native-glass="1"\] \.agent-chat__input \{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(css,/html\[data-pinkie-native-glass="1"\] :is\(\.agent-chat__composer-shell, \.agent-chat__input\)[\s\S]*?backdrop-filter: none !important/);
  assert.match(css,/html\[data-pinkie-native-glass="1"\] :is\(\.agent-chat__composer-shell, \.agent-chat__input\)[\s\S]*?animation: none !important/);
  assert.match(block,/background: rgba\(255, 250, 253, 0\.88\) !important/);
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
  assert.match(installer,/laolao-theme\.css\?v=theme46/);
  assert.match(installer,/laolao-sidebar\.css\?v=sidebar17/);
  assert.match(installer,/laolao-sidebar\.js\?v=sidebar26/);
  assert.match(installer,/laolao-session-list\.js\?v=sessions10/);
  assert.match(installer,/trap reseal_app_on_exit EXIT/);
  assert.match(installer,/codesign --force --deep --sign -/);
  assert.match(installer,/Computer Use v2 patch skipped/);
  assert.match(installer,/laolao-deep-think\.js\?v=deepthink17/);
  assert.match(installer,/laolao-web-gpt-collab\.js\?v=webgpt14/);
  assert.match(installer,/laolao-splash\.css\?v=splash18/);
  assert.match(installer,/laolao-splash\.js\?v=splash26/);
  assert.match(installer,/laolao-mode-switcher\.js\?v=mode36/);
  assert.match(installer,/laolao-usage-stats\.js\?v=stats16/);
  assert.match(installer,/laolao-classic-shell\.css\?v=classic17/);
  assert.match(installer,/laolao-classic-shell\.js\?v=classic15/);
  assert.match(installer,/laolao-side-layout\.css\?v=side20/);
  assert.match(installer,/laolao-side-layout\.js\?v=side12/);
  assert.match(installer,/laolao-memory\.css\?v=memory1/);
  assert.match(installer,/laolao-memory\.js\?v=memory2/);
  assert.match(installer,/s\{\"\\\.\/laolao-\}\{\"\/laolao-\}g/);
});

test('assistant replies get a subtle readable surface without slowing streams',()=>{
  const css=read('ui/injections/laolao-theme.css');
  const bubbleBlock=css.match(/chat-group\.assistant:not\(\.chat-group--forwarded\)[\s\S]*?\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(bubbleBlock,/linear-gradient\(135deg, rgba\(255, 253, 254, 0\.54\), rgba\(255, 247, 251, 0\.34\)\)/);
  assert.match(css,/chat-bubble:not\(\.chat-bubble--tool-shell\):not\(\.chat-reading-indicator\)/);
  assert.doesNotMatch(bubbleBlock,/backdrop-filter/);
  assert.match(css,/chat-group :is\(\.chat-bubble, \.chat-group-content\)[\s\S]*text-shadow:/);
  assert.match(css,/chat-group\.user \.chat-bubble:not\(\.chat-bubble--tool-shell\)[\s\S]*linear-gradient/);
});

test('chat layout keeps both rails out of the message column',()=>{
  const css=read('ui/injections/laolao-side-layout.css');
  assert.match(css,/grid-template-columns: minmax\(0, 1fr\) var\(--laolao-window-rail-reserve\)/);
  assert.match(css,/chat-workbench > \.chat-workspace-rail \{[\s\S]*position: relative !important/);
  assert.match(css,/chat-workbench > \.chat-workspace-rail \{[\s\S]*grid-column: 2 !important/);
  assert.match(css,/@media \(max-width: 1120px\)[\s\S]*display: grid !important[\s\S]*display: flex !important/);
  assert.match(css,/not\(\.chat-workspace-rail--collapsed\) \{[\s\S]*position: absolute !important;[\s\S]*grid-column: 1 \/ -1 !important;[\s\S]*contain: layout paint style;/);
  const expandedRail=css.match(/chat-workbench > \.chat-workspace-rail:not\(\.chat-workspace-rail--collapsed\) \{([\s\S]*?)\}/)?.[1]||'';
  assert.match(expandedRail,/backdrop-filter: none !important/);
  assert.doesNotMatch(expandedRail,/blur\(/);
  assert.match(css,/chat-workspace-rail--collapsed \{[\s\S]*align-self: center !important;[\s\S]*height: auto !important;[\s\S]*max-height: calc\(100% - 24px\) !important;/);
  assert.match(css,/chat-workspace-rail--collapsed > :is\([\s\S]*#pinkie-roundtable-entry,[\s\S]*#pinkie-party-entry[\s\S]*min-height: 58px !important;[\s\S]*margin: 2px auto !important;/);
  assert.match(css,/not\(\.chat-workspace-rail--collapsed\) > :is\([\s\S]*#pinkie-roundtable-entry,[\s\S]*#pinkie-party-entry[\s\S]*display: none !important;/);
  assert.doesNotMatch(css,/:has\(/);
  assert.match(css,/chat-bubble :is\(p, li, blockquote, a\)[\s\S]*overflow-wrap: anywhere/);
  assert.doesNotMatch(css,/padding-right: var\(--laolao-window-rail-reserve\)/);
});
