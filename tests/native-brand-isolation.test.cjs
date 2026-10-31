const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const mac = path.join(root, 'desktop/macos');
const read = (file) => fs.readFileSync(file, 'utf8');
const selected = (brand) => execFileSync('/bin/bash', [
  '-c', 'source "$1"; native_sources_for_brand "$2" "$3"',
  'native-source-test', path.join(mac, 'native-sources.sh'), mac, brand,
], { encoding: 'utf8' }).trim();

test('default Pinkie and explicit C.le. builds select separate native sources', () => {
  const pinkie = selected('0');
  const cle = selected('1');
  assert.equal(pinkie, path.join(mac, 'pinkie/Sources'));
  assert.equal(cle, path.join(mac, 'Sources'));
  assert.notEqual(pinkie, cle);
  for (const dir of [pinkie, cle]) {
    for (const name of ['Launcher.swift', 'MaterialPreview.swift', 'BrowserControl.swift', 'BrowserControl.js']) {
      assert.ok(fs.statSync(path.join(dir, name)).isFile());
    }
    const swift = read(path.join(dir, 'BrowserControl.swift'));
    const embedded = swift.split('private static let domScript = #"""\n')[1]
      .split('\n    """#')[0].split('\n').map((line) => line.slice(4)).join('\n');
    assert.equal(embedded, read(path.join(dir, 'BrowserControl.js')).trimEnd());
  }
  assert.doesNotMatch(read(path.join(pinkie, 'MaterialPreview.swift')), /CleBrowserPalette/);
  assert.match(read(path.join(cle, 'MaterialPreview.swift')), /CleBrowserPalette/);
});

test('Pinkie build and installer use its own source and never invoke C.le. startup patch', () => {
  const build = read(path.join(mac, 'build.sh'));
  const installer = read(path.join(root, 'installer/macos/apply-theme.sh'));
  assert.match(build, /native_sources_for_brand "\$SCRIPT_DIR" "\$CLE_BRAND"/);
  for (const name of ['Launcher.swift', 'MaterialPreview.swift', 'BrowserControl.swift']) {
    assert.ok(build.includes(`"$NATIVE_SOURCE_DIR/${name}"`));
  }
  assert.match(build, /ditto "\$NATIVE_SOURCE_DIR" "\$CONTENTS\/Resources\/SuperPinkie\/desktop\/macos\/Sources"/);
  assert.match(installer, /PINKIE_NATIVE_SOURCE_DIR="\$REPO_ROOT\/desktop\/macos\/pinkie\/Sources"/);
  assert.doesNotMatch(installer, /\$REPO_ROOT\/patch\/apply-startup\.mjs/);
  assert.ok(fs.existsSync(path.join(root, 'services/cle-studio/scripts/apply-startup.mjs')));
});
