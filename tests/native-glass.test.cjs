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
});

test('installer cache-busts the native glass assets',()=>{
  const installer=read('installer/macos/apply-theme.sh');
  assert.match(installer,/laolao-theme\.css\?v=theme30/);
  assert.match(installer,/laolao-sidebar\.css\?v=sidebar16/);
  assert.match(installer,/laolao-sidebar\.js\?v=sidebar13/);
  assert.match(installer,/laolao-session-list\.js\?v=sessions3/);
  assert.match(installer,/laolao-deep-think\.js\?v=deepthink10/);
  assert.match(installer,/laolao-splash\.css\?v=splash18/);
  assert.match(installer,/laolao-splash\.js\?v=splash21/);
  assert.match(installer,/laolao-mode-switcher\.js\?v=mode25/);
  assert.match(installer,/laolao-usage-stats\.js\?v=stats11/);
  assert.match(installer,/s\{\"\\\.\/laolao-\}\{\"\/laolao-\}g/);
});
