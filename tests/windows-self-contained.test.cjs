const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Windows exe embeds its own Node and OpenClaw runtime', () => {
  const build = read('build-win.ps1');
  const manifest = JSON.parse(read('desktop/windows/runtime-manifest.json'));
  assert.match(manifest.node, /^24\./);
  assert.match(manifest.openclaw, /^2026\./);
  assert.match(build, /openclaw@\$\(\$manifest\.openclaw\)/);
  assert.match(build, /node\.exe'\);runtime\\bin/);
  assert.match(build, /runtime\\node_modules/);
  assert.match(build, /--onefile/);
  assert.match(build, /pywebview/);
  assert.match(build, /pywin32/);
  assert.doesNotMatch(build, /winget/);
  assert.doesNotMatch(build, /openclaw\.json/);
});

test('Windows desktop launches the bundled gateway and keeps it supervised', () => {
  const launcher = read('app/windows_desktop.py');
  assert.match(launcher, /node_modules\/openclaw\/openclaw\.mjs/);
  assert.match(launcher, /gateway", "run"/);
  assert.match(launcher, /while not self\.closing\.wait\(2\)/);
  assert.match(launcher, /failures >= 2/);
  assert.match(launcher, /window\.load_url\(GATEWAY_URL\)/);
  assert.match(launcher, /frameless=True/);
});

test('Windows exe checks signed release assets and can roll back a failed update', () => {
  const launcher = read('app/windows_desktop.py');
  const release = read('.github/workflows/release.yml');
  assert.match(launcher, /api\.github\.com\/repos\/Cle0726\/super-pinkie\/releases\/latest/);
  assert.match(launcher, /super-pinkie-windows-/);
  assert.match(launcher, /\.sha256/);
  assert.match(launcher, /Restore-PreviousVersion/);
  assert.match(launcher, /--update-health-token/);
  assert.match(launcher, /check_for_updates/);
  assert.match(launcher, /prepare_update/);
  assert.match(release, /Get-FileHash/);
  assert.match(release, /windows-\*\.exe\.sha256/);
});

test('Windows shell keeps all local spaces, project picker, voice and startup movie', () => {
  const launcher = read('app/windows_desktop.py');
  const entry = read('app/super_pinkie.py');
  assert.match(launcher, /services\/party\/server\.py/);
  assert.match(launcher, /services\/roundtable\/server\.py/);
  assert.match(launcher, /services\/tts\/edge_tts_server\.py/);
  assert.match(launcher, /proxy\/ur-rewrite-proxy\.py/);
  assert.match(launcher, /FOLDER_DIALOG/);
  assert.match(launcher, /laolaoNativeDictation/);
  assert.match(launcher, /SAPI\.SpSharedRecognizer/);
  assert.match(launcher, /pywebview-drag-region/);
  assert.match(launcher, /launcher-loading\.html/);
  assert.match(launcher, /PINKIE_STATE_ROOT/);
  assert.match(launcher, /storage_path=/);
  assert.match(launcher, /location\.protocol === 'file:'\) return/);
  assert.match(entry, /prepare_bundled_desktop/);
  assert.match(entry, /preserve_existing=True/);
  assert.match(entry, /--control-center/);
});

test('Windows subprocess streams use threads instead of unsupported pipe selectors', () => {
  const processIo = read('services/process_io.py');
  const party = read('services/party/server.py');
  const roundtable = read('services/roundtable/server.py');
  assert.match(processIo, /if os\.name != "nt"/);
  assert.match(processIo, /queue\.Queue/);
  assert.match(processIo, /read1/);
  assert.match(processIo, /taskkill/);
  assert.doesNotMatch(party, /selectors\.DefaultSelector/);
  assert.doesNotMatch(roundtable, /selectors\.DefaultSelector/);
  assert.match(party, /iter_process_output/);
  assert.match(roundtable, /iter_process_output/);
});
