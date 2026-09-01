const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const theme=read('ui/injections/laolao-theme.css');
const quiet=theme.slice(theme.indexOf('/* Quiet utility controls:'),theme.indexOf('::selection {'));
test('utility controls are transparent at rest, reveal on hover, and retain focus indication',()=>{
  assert.match(quiet,/background: transparent !important/);
  assert.match(quiet,/border-color: transparent !important/);
  assert.match(quiet,/box-shadow: none !important/);
  assert.match(quiet,/@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(quiet,/:hover \{[\s\S]*?box-shadow: inset/);
  assert.match(quiet,/:focus-visible \{[\s\S]*?outline: 2px solid/);
  for(const selector of quiet.matchAll(/:is\(([^)]+)\)([^{}]+)\{/g)){
    assert.doesNotMatch(selector[1],/laolao-mode-switcher|laolao-mode-menu__option|pinkie-party-entry/);
    for(const state of ['.is-recording','.danger','.chat-send-btn--stop'])assert.ok(selector[2].includes(':not('+state+')'));
  }
});
test('sidebar has no idle frame and keeps a subtle selected indicator',()=>{
  const css=read('ui/injections/laolao-sidebar.css');
  assert.match(css,/html \.sidebar-recent-session \{[^}]*background: transparent !important;[^}]*border-color: transparent !important;/);
  assert.match(css,/html \.sidebar-recent-session\.sidebar-recent-session--active \{[^}]*box-shadow: none !important;[^}]*color: var\(--accent/);
  assert.match(css,/\.sidebar-recent-session:focus-within \.laolao-row-actions/);
});
test('party text editor moves focus feedback to its rounded parent, not a square inset outline',()=>{
  const css=read('ui/party/party-art.css');
  assert.match(css,/#draft:focus,#draft:focus-visible \{ outline:none; box-shadow:none; \}/);
  assert.match(css,/\.composer:focus-within \{[^}]*border-color:[^}]*box-shadow:/);
  assert.match(css,/\.compose-toolbar select \{ border-radius:7px;/);
  assert.match(css,/\.send \{ color:#c75489;/);
  assert.doesNotMatch(css,/textarea:focus-visible\s*\{\s*outline:none/);
});
