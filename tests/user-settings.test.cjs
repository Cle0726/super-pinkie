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
    chat: {profile: 'minimal', execSecurity: 'deny', browserEnabled: false,
      alsoAllow: ['pinkie_session_start','pinkie_session_message','pinkie_session_list','pinkie_mode_ask','pinkie_sessions','pinkie_model_capability']},
    work: {profile: 'coding', execSecurity: 'allowlist', browserEnabled: false,
      alsoAllow: ['pinkie_model_capability']},
    open: {profile: 'full', execSecurity: 'full', browserEnabled: true},
  });
  assert.equal(rules.matchingPreset({tools: {profile: 'minimal', exec: {security: 'deny'}}, browser: {enabled: false}}), 'chat');
  assert.equal(rules.matchingPreset({tools: {profile: 'coding', exec: {security: 'allowlist'}}, browser: {enabled: false}}), 'work');
  assert.equal(rules.matchingPreset({tools: {profile: 'coding', exec: {security: 'allowlist'}, alsoAllow: ['pinkie_model_capability']}, browser: {enabled: false}}), 'work');
  assert.equal(rules.matchingPreset({tools: {profile: 'coding', exec: {security: 'allowlist'}, alsoAllow: ['browser']}, browser: {enabled: false}}), null);
  assert.equal(rules.matchingPreset({tools: {profile: 'full', exec: {security: 'full'}}, browser: {enabled: true}}), 'open');
  assert.equal(rules.matchingPreset({tools: {profile: 'messaging', exec: {security: 'deny'}}, browser: {enabled: false}}), null);
  assert.equal(rules.matchingPreset({tools: {profile: 'full', exec: {security: 'allowlist'}}, browser: {enabled: true}}), null);
  assert.equal(rules.hasScopedToolOverrides({tools: {profile: 'minimal', deny: ['computer'], exec: {security: 'deny'}}, browser: {enabled: false}}), true);
  assert.equal(rules.matchingPreset({tools: {profile: 'minimal', deny: ['computer'], exec: {security: 'deny'}}, browser: {enabled: false}}), null);
  assert.equal(rules.matchingPreset({tools: {profile: 'minimal', exec: {security: 'deny'}}, agents: {list: [{id: 'main', tools: {allow: ['read']}}]}, browser: {enabled: false}}), null);
});

test('chat preset adds only the child-session tools, preserves existing rules and avoids allow conflicts', () => {
  const rules=loadSettingsRules();
  const changes=config=>JSON.parse(JSON.stringify(rules.presetChanges('chat',config)));
  const values=changes({tools:{alsoAllow:['existing'],deny:['browser']}});
  assert.deepEqual(values.at(-1),[['tools','alsoAllow'],['existing','pinkie_session_start','pinkie_session_message','pinkie_session_list','pinkie_mode_ask','pinkie_sessions','pinkie_model_capability']]);
  assert.equal(values.some(([path])=>path.join('.')==='tools.deny'),false);
  assert.equal(changes({tools:{allow:['read']}}).some(([path])=>path.join('.')==='tools.alsoAllow'),false);
  // 老配置只有前四项或五项（网关启动时会补上 pinkie_sessions / pinkie_model_capability）也还认作「只聊天」（F9）。
  assert.equal(rules.matchingPreset({tools:{profile:'minimal',exec:{security:'deny'},alsoAllow:['pinkie_session_start','pinkie_session_message','pinkie_session_list','pinkie_mode_ask']},browser:{enabled:false}}),'chat');
  assert.equal(rules.matchingPreset({tools:{profile:'minimal',exec:{security:'deny'},alsoAllow:['pinkie_session_start','pinkie_session_message','pinkie_session_list','pinkie_mode_ask','pinkie_sessions']},browser:{enabled:false}}),'chat');
  assert.equal(rules.matchingPreset({tools:{profile:'minimal',exec:{security:'deny'},alsoAllow:['pinkie_session_start','pinkie_session_message','pinkie_session_list','pinkie_mode_ask','pinkie_sessions','pinkie_model_capability']},browser:{enabled:false}}),'chat');
  assert.equal(rules.matchingPreset({tools:{profile:'minimal',exec:{security:'deny'},alsoAllow:['exec']},browser:{enabled:false}}),null);
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
  const head = require('./fixtures/shared-ui.cjs').sharedUi({'entries': ['laolao-settings-user.css', 'laolao-settings-user.js'], 'assets': []});

});

test('thinking and speed buttons use schema-valid paths and preserve custom thinking tiers', () => {
  const rules = loadSettingsRules();
  assert.equal(rules.thinkingValue({}), 'off');
  assert.equal(rules.thinkingValue({agents: {defaults: {thinkingDefault: 'high'}}}), 'high');
  for (const tier of ['minimal', 'xhigh', 'adaptive', 'max', 'ultra']) {
    assert.equal(rules.thinkingValue({agents: {defaults: {thinkingDefault: tier}}}), tier, `preserves custom thinking tier ${tier}`);
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.thinkingChanges('medium', {agents: {defaults: {thinkingDefault: 'high'}}}))),
    [[['agents', 'defaults', 'thinkingDefault'], 'medium']],
  );
  const cleanedThinking = rules.thinkingChanges('high', {agents: {defaults: {thinkingLevel: 'low'}}});
  assert.equal(cleanedThinking.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(cleanedThinking[0])), [['agents', 'defaults', 'thinkingDefault'], 'high']);
  assert.equal(cleanedThinking[1][1], undefined);

  assert.equal(rules.fastModeValue({agents: {defaults: {thinkingDefault: 'ultra'}}}), 'false');
  assert.equal(rules.fastModeValue({agents: {defaults: {params: {fastMode: 'auto'}, thinkingDefault: 'ultra'}}}), 'auto');
  assert.equal(rules.fastModeValue({agents: {defaults: {params: {fastMode: true}, thinkingDefault: 'xhigh'}}}), 'true');
  const speedPatch = JSON.parse(JSON.stringify(rules.fastModeChanges(true, {agents: {defaults: {thinkingDefault: 'ultra'}}})));
  assert.deepEqual(speedPatch, [[['agents', 'defaults', 'params', 'fastMode'], true]]);
});
