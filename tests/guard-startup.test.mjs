import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildManifest, signBytes, startup, verifyRelease, releasePayload, repairConfig} from '../installer/guard/guard.mjs';

const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
const keyPem = privateKey.export({type: 'pkcs8', format: 'pem'});
const pub = publicKey.export({type: 'spki', format: 'der'}).toString('base64');
const put = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); };

function fixture({guard = true, sign = true} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-start-')));
  const bundle = path.join(root, 'SuperPinkie'), home = path.join(root, 'home'), state = path.join(home, '.openclaw'), appState = path.join(root, 'app-state');
  put(path.join(bundle, 'VERSION'), '9.9.9\n');
  put(path.join(bundle, 'build-info.json'), JSON.stringify({guard, channel: guard ? 'release' : 'dev', version: '9.9.9'}));
  put(path.join(bundle, 'personas/chat/SOUL.md'), 'official soul');
  put(path.join(bundle, 'personas/chat/DREAMS.md'), 'dreams');
  put(path.join(bundle, 'personas/project/AGENTS.md'), 'official agents');
  put(path.join(bundle, 'services/mode-architecture/index.mjs'), 'official plugin');
  put(path.join(bundle, 'bundled-skills/xlsx/SKILL.md'), '---\nname: xlsx\n---\nofficial');
  put(path.join(bundle, 'installer/guard/guard.mjs'), '//');
  fs.writeFileSync(path.join(bundle, 'guard-manifest.json'), JSON.stringify(buildManifest(bundle, {commit: 'a'.repeat(40)})));
  if (sign) fs.writeFileSync(path.join(bundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(bundle, 'guard-manifest.json')), keyPem));
  put(path.join(state, 'workspace/SOUL.md'), 'evil soul');
  put(path.join(state, 'workspace/DREAMS.md'), 'my dreams');
  put(path.join(state, 'workspace/BOOTSTRAP.md'), 'inject me');
  put(path.join(state, 'workspace/USER.md'), 'user facts');
  put(path.join(state, 'workspace/memory/a.md'), 'memory');
  put(path.join(state, 'workspace-project/AGENTS.md'), 'official agents');
  put(path.join(state, 'workspace-thinking/skills/xlsx/SKILL.md'), '---\nname: xlsx\n---\nhacked');
  put(path.join(state, 'extensions/pinkie-mode-architecture/index.mjs'), 'patched plugin');
  put(path.join(state, 'user-skills/mine/SKILL.md'), '---\nname: mine\n---\n');
  put(path.join(state, 'user-skills/fake/SKILL.md'), '---\nname: xlsx\n---\n');
  put(path.join(state, 'openclaw.json'), JSON.stringify({
    models: {providers: {mine: {baseUrl: 'https://x', apiKey: 'sk-user'}}}, talk: {voice: 'v'},
    plugins: {enabled: false, deny: ['pinkie-mode-architecture'], allow: [], entries: {'pinkie-mode-architecture': {enabled: false}}, load: {paths: [path.join(state, 'extensions/pinkie-mode-architecture'), '/tmp/evil-plugin']}},
    agents: {defaults: {model: {primary: 'mine/m1'}}, list: [{id: 'main', workspace: '/tmp/fake-ws', model: 'mine/m1', contextInjection: 'never', tools: {deny: []}}, {id: 'unrestricted', workspace: '/tmp/free'}]},
    hooks: {internal: {entries: {'bootstrap-extra-files': {enabled: true}}}},
  }));
  return {root, bundle, home, state, appState};
}

test('dev build: does nothing', () => {
  const f = fixture({guard: false});
  assert.deepEqual(startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub}), {guard: false});
  assert.equal(fs.readFileSync(path.join(f.state, 'workspace/SOUL.md'), 'utf8'), 'evil soul');
  assert.equal(fs.existsSync(path.join(f.appState, 'guard')), false);
});

test('release build: restores product files, keeps user data and preferences', () => {
  const f = fixture();
  const result = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub});
  assert.equal(result.trusted, true);
  assert.equal(result.nonOfficial, false);
  const read = rel => fs.readFileSync(path.join(f.state, rel), 'utf8');
  assert.equal(read('workspace/SOUL.md'), 'official soul');
  assert.equal(read('workspace/DREAMS.md'), 'my dreams');
  assert.equal(read('workspace/USER.md'), 'user facts');
  assert.equal(read('workspace/memory/a.md'), 'memory');
  assert.equal(fs.existsSync(path.join(f.state, 'workspace/BOOTSTRAP.md')), false);
  assert.equal(read('extensions/pinkie-mode-architecture/index.mjs'), 'official plugin');
  assert.match(read('extensions/pinkie-mode-architecture/guard-build.json'), /"guard":true/);
  assert.match(read('workspace-thinking/skills/xlsx/SKILL.md'), /official/);
  assert.equal(fs.existsSync(path.join(f.state, 'user-skills/mine/SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(f.state, 'user-skills/fake')), false);
  const config = JSON.parse(read('openclaw.json'));
  assert.equal(config.plugins.enabled, undefined);
  assert.deepEqual(config.plugins.deny, []);
  assert.equal(config.plugins.entries['pinkie-mode-architecture'].enabled, true);
  assert.deepEqual(config.plugins.load.paths, [path.join(f.state, 'extensions/pinkie-mode-architecture')]);
  assert.equal(config.agents.list[0].workspace, path.join(f.state, 'workspace'));
  assert.equal(config.agents.list[0].contextInjection, undefined);
  assert.equal(config.agents.list[1].workspace, '/tmp/free');
  assert.equal(config.hooks.internal, undefined);
  assert.deepEqual(config.skills.load.extraDirs, [path.join(f.state, 'user-skills')]);
  // 用户白名单键原样保留
  assert.equal(config.models.providers.mine.apiKey, 'sk-user');
  assert.equal(config.agents.defaults.model.primary, 'mine/m1');
  assert.equal(config.agents.list[0].model, 'mine/m1');
  assert.equal(config.talk.voice, 'v');
  // 备份 + 状态标记
  assert.equal(fs.readFileSync(path.join(result.backup, 'personas/chat/SOUL.md'), 'utf8'), 'evil soul');
  const status = JSON.parse(fs.readFileSync(path.join(f.appState, 'guard/status.json'), 'utf8'));
  assert.ok(status.restored.length >= 5);
  assert.equal(status.history.length, 1);
  // 第二次启动：没有可恢复的，历史不变
  const again = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub});
  assert.equal(again.restored.length, 0);
  assert.deepEqual(again.configFixed, []);
  assert.equal(again.history.length, 1);
});

test('tampered or unsigned bundle is flagged and not used as a restore source', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.bundle, 'personas/chat/SOUL.md'), 'tampered in bundle');
  const result = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub});
  assert.equal(result.nonOfficial, true);
  assert.equal(fs.readFileSync(path.join(f.state, 'workspace/SOUL.md'), 'utf8'), 'evil soul');
  const unsigned = fixture({sign: false});
  assert.equal(startup({bundle: unsigned.bundle, home: unsigned.home, appState: unsigned.appState, key: pub}).nonOfficial, true);
});

test('release commit signature (Mac git updates) verifies only the exact version and commit', () => {
  const commit = 'b'.repeat(40);
  const sig = signBytes(releasePayload('2.6.0', commit), keyPem);
  assert.equal(verifyRelease('2.6.0', commit, sig, pub), true);
  assert.equal(verifyRelease('v2.6.0', commit, sig, pub), true);
  assert.equal(verifyRelease('2.6.1', commit, sig, pub), false);
  assert.equal(verifyRelease('2.6.0', 'c'.repeat(40), sig, pub), false);
  assert.equal(verifyRelease('2.6.0', commit, 'AAAA', pub), false);
});

test('repairConfig leaves an already-official config untouched', () => {
  const state = '/u/.openclaw';
  const config = {plugins: {entries: {}}, agents: {list: [{id: 'main', workspace: '/u/.openclaw/workspace'}]}, skills: {load: {extraDirs: ['/u/.openclaw/user-skills']}}};
  assert.deepEqual(repairConfig(config, {stateDir: state, userSkillsDir: '/u/.openclaw/user-skills'}), []);
});
