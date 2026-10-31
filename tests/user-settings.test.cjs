const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function loadSettingsRules() {
  const window = {};
  const document = {readyState: 'loading', addEventListener() {}};
  vm.runInNewContext(read('ui/injections/laolao-settings-user.js'), {
    window, document, URL, URLSearchParams, JSON, Object, Array, String, Boolean,
  }, {filename: 'laolao-settings-user.js'});
  return window.__laolaoUserSettings;
}

test('user-facing permission presets have explicit mappings and preserve custom combinations', () => {
  const rules = loadSettingsRules();
  assert.deepEqual(JSON.parse(JSON.stringify(rules.presetMap)), {
    chat: {profile: 'minimal', execSecurity: 'deny', browserEnabled: false},
    work: {profile: 'coding', execSecurity: 'allowlist', browserEnabled: false},
    open: {profile: 'full', execSecurity: 'full', browserEnabled: true},
  });
  assert.equal(rules.matchingPreset({tools: {profile: 'minimal', exec: {security: 'deny'}}, browser: {enabled: false}}), 'chat');
  assert.equal(rules.matchingPreset({tools: {profile: 'coding', exec: {security: 'allowlist'}}, browser: {enabled: false}}), 'work');
  assert.equal(rules.matchingPreset({tools: {profile: 'full', exec: {security: 'full'}}, browser: {enabled: true}}), 'open');
  assert.equal(rules.matchingPreset({tools: {profile: 'messaging', exec: {security: 'deny'}}, browser: {enabled: false}}), null);
  assert.equal(rules.matchingPreset({tools: {profile: 'full', exec: {security: 'allowlist'}}, browser: {enabled: true}}), null);
  assert.equal(rules.hasScopedToolOverrides({tools: {profile: 'minimal', deny: ['computer'], exec: {security: 'deny'}}, browser: {enabled: false}}), true);
  assert.equal(rules.matchingPreset({tools: {profile: 'minimal', deny: ['computer'], exec: {security: 'deny'}}, browser: {enabled: false}}), null);
  assert.equal(rules.matchingPreset({tools: {profile: 'minimal', exec: {security: 'deny'}}, agents: {list: [{id: 'main', tools: {allow: ['read']}}]}, browser: {enabled: false}}), null);
});

test('remote access warning rules detect external reachability only when access checks are absent', () => {
  const rules = loadSettingsRules();
  assert.equal(rules.remoteAccessEnabled({gateway: {bind: 'loopback'}}, 'localhost'), false);
  assert.equal(rules.remoteAccessEnabled({gateway: {tailscale: {mode: 'funnel'}}}, 'localhost'), true);
  assert.equal(rules.remoteAccessEnabled({gateway: {bind: 'lan'}}, 'localhost'), true);
  assert.equal(rules.remoteAccessEnabled({gateway: {bind: 'loopback'}}, '10.0.0.12'), true);
  assert.equal(rules.authMode({gateway: {auth: {mode: 'none'}}}), 'none');
  assert.equal(rules.authMode({gateway: {auth: {token: 'present'}}}), 'token');
});

test('settings use the native config RPC and do not destructively edit Lit-owned nodes', () => {
  const source = read('ui/injections/laolao-settings-user.js');
  assert.match(source, /request\("config\.get"/);
  assert.match(source, /request\("config\.apply", \{raw: JSON\.stringify\(next\), baseHash: snapshot\.hash\}/);
  assert.match(source, /laolaoModelPickerCatalog/);
  assert.doesNotMatch(source, /(?:\.textContent|\.innerHTML|\.innerText)\s*=(?!=)/);
  assert.doesNotMatch(source, /replaceChildren\(|\.remove\(\)/);
  // ui/injections/** is the old live app and keeps the old character name;
  // this page must keep matching the labels it actually ships.
  for (const label of ['碧琪', '模型与思考', '碧琪能做什么', '外观与声音', '连接', '关于与更新']) {
    assert.ok(source.includes(`"${label}"`), `missing settings group: ${label}`);
  }
  assert.match(source, /高级设置（开发者）/);
  assert.match(source, /网关可能可以从本机以外连接，但还没有设置访问验证/);
});

test('settings page is loaded by the head fragment and both installers with one cache key', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  // CSS and JS advance independently; each must use its own current key.
  const versions = {'laolao-settings-user.css': 3, 'laolao-settings-user.js': 4};
  for (const file of ['laolao-settings-user.css', 'laolao-settings-user.js']) {
    const versioned = new RegExp(`${file.replace(/[.-]/g, '\\$&')}\\?v=settingsuser${versions[file]}`);
    assert.match(head, versioned);
    assert.match(mac, versioned);
    assert.match(windows, versioned);
    assert.match(mac, new RegExp(`^\\s+${file.replace(/[.-]/g, '\\$&')} \\\\$`, 'm'), `${file} missing from macOS copy list`);
    assert.ok(windows.includes(`"${file}",`), `${file} missing from Windows asset list`);
  }
});
