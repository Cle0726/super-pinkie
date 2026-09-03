const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('native settings and mode menus use one warm glass control language',()=>{
  const css=read('ui/injections/laolao-theme.css');
  assert.match(css,/Immersive control sheets/);
  assert.match(css,/\.chat-settings-popover \.chat-settings-action\.active/);
  assert.match(css,/\.chat-settings-popover select/);
  assert.match(css,/\.laolao-mode-menu__option\[aria-checked="true"\]/);
  assert.match(css,/\.agent-chat__attach-menu-option/);
  assert.match(css,/linear-gradient\(145deg, rgba\(255, 252, 253, 0\.84\), rgba\(250, 226, 239, 0\.70\)\)/);
});

test('custom confirmations and toasts avoid stock grey and black materials',()=>{
  const css=read('ui/injections/laolao-sidebar.css');
  assert.match(css,/@keyframes laolao-modal-in/);
  assert.match(css,/background: rgba\(91, 50, 73, 0\.16\)/);
  assert.match(css,/linear-gradient\(135deg, #dc4e8b, #c9477e\)/);
  assert.doesNotMatch(css,/background: #e25c5c/);
  assert.doesNotMatch(css,/background: rgba\(24, 25, 26, 0\.92\)/);
});
