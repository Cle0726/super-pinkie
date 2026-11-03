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
  assert.equal(pinkie, path.join(mac, 'pinkie/Sources'));
  assert.throws(() => selected('1'), /only the 超級碧琪/);
  assert.ok(!fs.existsSync(path.join(mac, 'Sources')));
  for (const name of ['Launcher.swift','MaterialPreview.swift','BrowserControl.swift','BrowserControl.js']) assert.ok(fs.statSync(path.join(pinkie,name)).isFile());
  const swift=read(path.join(pinkie,'BrowserControl.swift'));
  const embedded=swift.split('private static let domScript = #"""\n')[1].split('\n    """#')[0].split('\n').map(line=>line.slice(4)).join('\n');
  assert.equal(embedded,read(path.join(pinkie,'BrowserControl.js')).trimEnd());
});

test('Pinkie build and installer use its own source and never invoke C.le. startup patch', () => {
  const build=read(path.join(mac,'build.sh'));
  const installer=read(path.join(root,'installer/macos/apply-theme.sh'));
  assert.match(build,/native_sources_for_brand "\$SCRIPT_DIR"/);
  assert.doesNotMatch(build,/CLE_BRAND|apply-startup/);
  for(const name of ['Launcher.swift','MaterialPreview.swift','BrowserControl.swift']) assert.ok(build.includes(`"$NATIVE_SOURCE_DIR/${name}"`));
  assert.match(installer,/PINKIE_NATIVE_SOURCE_DIR="\$REPO_ROOT\/desktop\/macos\/pinkie\/Sources"/);
  for(const file of ['services/cle-studio','installer/cle','patch/apply-startup.mjs']) assert.ok(!fs.existsSync(path.join(root,file)));
});
