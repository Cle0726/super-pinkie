const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const SETTINGS_PAGES = ['http://127.0.0.1:18789/settings/', 'http://127.0.0.1:18789/settings/power', 'http://127.0.0.1:18789/chat'];

function templateOf(source, pattern) {
  const match = source.match(pattern);
  assert.ok(match, `pattern not found: ${pattern}`);
  return match[1];
}

function assertServedFromRoot(template, names) {
  for (const name of names) {
    const file = template.replace(/\$\{[^}]+\}/, name);
    assert.ok(fs.statSync(path.join(root, 'ui/assets', path.basename(file))).size > 0, `missing ui/assets/${path.basename(file)}`);
    for (const page of SETTINGS_PAGES) {
      assert.equal(new URL(file, page).pathname, `/${path.basename(file)}`, `${file} resolves wrong under ${page}`);
    }
  }
}

test('power settings art loads from the site root, so /settings/ pages do not 404', () => {
  const source = read('ui/injections/laolao-power-settings.js');
  assert.doesNotMatch(source, /[`'"]\.\/laolao-pinkie-/);
  const template = templateOf(source, /const ART = \(name\) => `([^`]+)`/);
  const names = ['status-done', 'buddy-chat-happy', ...[...source.matchAll(/art: "([^"]+)"/g)].map((m) => m[1])];
  assertServedFromRoot(template, names);
});

test('update dialog stickers load from the site root, so /settings/ pages do not 404', () => {
  const source = read('ui/injections/laolao-update-dialog.js');
  assert.doesNotMatch(source, /[`'"]\.\/laolao-pinkie-/);
  const template = templateOf(source, /const sticker = `([^`]+)`/);
  const stickers = templateOf(source, /const stickers = \{([^}]+)\}/);
  const names = [...new Set([...stickers.matchAll(/:\s*'([a-z]+)'/g)].map((m) => m[1]))];
  assert.ok(names.length >= 3);
  assertServedFromRoot(template.replace(/\$\{[^}]+\}/, '${s}'), names);
});
