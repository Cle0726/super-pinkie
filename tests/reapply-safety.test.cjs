const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the desktop reapply job never rewrites a live App on a fixed timer', () => {
  const plist = read('installer/macos/com.super-pinkie.reapply.plist.in');
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.doesNotMatch(plist, /<key>StartInterval<\/key>/);
  assert.match(plist, /immutable while it is running/);
});

test('manual theme application leaves a healthy watchdog alone', () => {
  const installer = read('installer/macos/apply-theme.sh');
  const block = installer.slice(installer.indexOf('install_relay_watchdog()'), installer.indexOf('\nOPENCLAW_ROOT='));
  assert.match(block, /local backup_root should_reload=0/);
  assert.match(block, /if \[\[ "\$should_reload" == "1" \]\]; then/);
  assert.match(block, /launchctl print "gui\/\$\(id -u\)\/ai\.openclaw\.watchdog"/);
});

test('manual theme application updates only the owned model proxy jobs', () => {
  const installer = read('installer/macos/apply-theme.sh');
  const block = installer.slice(installer.indexOf('install_model_retry_proxy()'), installer.indexOf('\nOPENCLAW_ROOT='));
  assert.match(block, /backups\/model-proxy-/);
  assert.match(block, /PlistBuddy -c 'Print :ProgramArguments'/);
  assert.match(block, /launchctl kickstart -k/);
  assert.match(block, /com\.openclaw\.mm-retry-proxy-codex-oc/);
  assert.doesNotMatch(block, /pkill|killall|rm -rf/);
});
