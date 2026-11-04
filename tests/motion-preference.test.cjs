const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('effects follow the in-app switch, loaded before every other injection but the night bootstrap', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  const scripts = [...head.matchAll(/<script[^>]*src="\/([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(0, 2), ['laolao-night.js', 'laolao-motion-preference.js']);
  assert.doesNotMatch(head.split('laolao-motion-preference.js')[0], /defer/);
  const source = read('ui/injections/laolao-motion-preference.js');
  assert.match(source, /window\.matchMedia = function matchMedia/);
  assert.match(source, /rule\.media\.mediaText = next/);
  assert.match(source, /characterData: true/);
  assert.match(source, /messageHandlers\?\.pinkieMotion/);
});

test('settings expose one 减少动效 switch, default full effects', () => {
  const settings = read('ui/injections/laolao-settings-user.js');
  assert.match(settings, /row\(appearanceCard, "减少动效"/);
  assert.match(settings, /\[\[false, "完整特效"\], \[true, "减少动效"\]\]/);
  assert.match(read('ui/injections/laolao-motion-preference.js'), /localStorage\.getItem\(KEY\) === "1"/);
});

test('the Mac shell no longer reads the OS reduce-motion flag', () => {
  for (const file of ['Launcher.swift', 'BrowserControl.swift']) {
    assert.doesNotMatch(read(`desktop/macos/pinkie/Sources/${file}`), /accessibilityDisplayShouldReduceMotion/);
  }
  assert.match(read('desktop/macos/pinkie/Sources/Launcher.swift'), /controller\.add\(self, name: "pinkieMotion"\)/);
});
