// Packaging assertions go through the shared source; installers no longer
// maintain two independent lists of the same resources and version numbers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function sharedUi({entries = [], assets = []} = {}) {
  const fragment = read('ui/injections/laolao-head.fragment.html');
  for (const name of entries) {
    assert.ok(fragment.includes(`/${name}?`), `${name} must be registered by the shared head`);
    assert.ok(fs.statSync(path.join(root, 'ui/injections', name)).size > 0);
  }
  for (const name of assets) {
    assert.ok(fs.statSync(path.join(root, 'ui/assets', name)).size > 0, `missing art/font ${name}`);
  }
  for (const file of ['installer/macos/apply-theme.sh', 'installer/windows/apply-theme.ps1']) {
    assert.match(read(file), /bundle\.py["']?\)?\s+install/);
  }
  return fragment;
}
module.exports = {sharedUi};
