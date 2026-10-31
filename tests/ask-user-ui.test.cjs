const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const script = read('ui/injections/laolao-ask-user.js');
const css = read('ui/injections/laolao-ask-user.css');
const sidebar = read('ui/injections/laolao-sidebar.js');
const phrases = read('ui/injections/laolao-phrases.js');
const fragment = read('ui/injections/laolao-head.fragment.html');
const mac = read('installer/macos/apply-theme.sh');
const windows = read('installer/windows/apply-theme.ps1');
const STICKERS = ['thinking', 'working', 'writing', 'done', 'oops', 'asking'];

test('the socket shim broadcasts live gateway events read-only', () => {
  assert.match(sidebar, /msg\?\.type === 'event' && msg\.event[\s\S]*?pinkie:gateway-event/);
  assert.match(sidebar, /sameOrigin/);
});

test('the ask card answers through the native composer and never touches Lit chat DOM', () => {
  assert.match(script, /pinkie:gateway-event/);
  assert.match(script, /data\.name === "ask_user" && data\.phase === "result"/);
  assert.match(script, /\[\[PINKIE_ASK_V1\]\]/);
  assert.match(script, /【回答碧琪的提问】/);
  assert.match(script, /agent-chat__composer-combobox textarea/);
  assert.match(script, /new KeyboardEvent\("keydown", \{key: "Enter"/);
  assert.match(script, /document\.body\.append\(card\)/);
  assert.doesNotMatch(script, /request\("chat\.send"/);
  // Restored from history only while no real user message follows it.
  assert.match(script, /request\("chat\.history"/);
  assert.match(script, /laolao-pinkie-status-asking\.png/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(phrases, /ask\[_ \]user[\s\S]*?向你提问/);
});

test('ask card files, stickers and cache keys ship through both installers', () => {
  assert.match(fragment, /laolao-ask-user\.css\?v=askuser1/);
  assert.match(fragment, /laolao-ask-user\.js\?v=askuser2/);
  for (const source of [mac, windows]) {
    assert.match(source, /laolao-ask-user\.css/);
    assert.match(source, /laolao-ask-user\.js/);
    for (const name of STICKERS) assert.match(source, new RegExp(`laolao-pinkie-status-${name}\\.png`));
    assert.match(source, /askuser2/);
    assert.match(source, /sidebar38/);
  }
  for (const name of STICKERS) assert.ok(fs.statSync(path.join(root, `ui/assets/laolao-pinkie-status-${name}.png`)).size > 10_000);
  assert.ok(windows.startsWith('﻿'));
});
