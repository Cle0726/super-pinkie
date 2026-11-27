const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui/injections/laolao-companion.js'), 'utf8');
const PAGES = ['http://127.0.0.1:18789/settings/', 'http://127.0.0.1:18789/settings/power', 'http://127.0.0.1:18789/chat'];

function listOf(name) {
  const match = source.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`));
  assert.ok(match, `${name} not found`);
  return [...match[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}

test('companion buddy art loads from the site root, so /settings/ pages do not 404', () => {
  assert.doesNotMatch(source, /[`'"]\.\/laolao-pinkie-/);
  const match = source.match(/const ART = \(m, s\) => `([^`]+)`/);
  assert.ok(match, 'ART template not found');
  const modes = listOf('MODES');
  const states = listOf('STATES');
  assert.ok(modes.length >= 5 && states.length >= 5);
  for (const m of modes) {
    for (const s of states) {
      const file = match[1].replace('${m}', m).replace('${s}', s);
      const name = path.basename(file);
      assert.ok(fs.statSync(path.join(root, 'ui/assets', name)).size > 0, `missing ui/assets/${name}`);
      for (const page of PAGES) {
        assert.equal(new URL(file, page).pathname, `/${name}`, `${file} resolves wrong under ${page}`);
      }
    }
  }
});
