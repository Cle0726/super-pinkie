import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildManifest, signBytes, startup, verifyRelease, releasePayload, repairConfig, stampPersonas, inspectPersonaMark, verifyCounterState, bundleIdentity} from '../installer/guard/guard.mjs';

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
  assert.deepEqual(config.plugins.entries['pinkie-mode-architecture'].hooks, {allowPromptInjection: true, allowConversationAccess: true}, 'hook grants put back');
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

test('24h 3-strike counter, clean reopen, re-offense exit, and 24h expiry', () => {
  const f = fixture();
  const baseMs = Date.parse('2026-11-18T10:00:00.000Z');
  const at = h => () => new Date(baseMs + h * 3600_000);
  const readAlert = () => JSON.parse(fs.readFileSync(path.join(f.appState, 'guard/pending-alert.json'), 'utf8'));

  // Strike 1
  const r1 = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub, now: at(0)});
  assert.equal(r1.strikesIn24h, 1);
  assert.equal(r1.limitReached, false);
  const a1 = readAlert();
  assert.equal(a1.count, 1);
  assert.equal(a1.limitReached, false);
  assert.ok(a1.categories.includes('人设和工作手册'));
  assert.ok(a1.backup);
  fs.rmSync(path.join(f.appState, 'guard/pending-alert.json'));

  // Strike 2
  put(path.join(f.state, 'workspace/SOUL.md'), 'evil 2');
  const r2 = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub, now: at(1)});
  assert.equal(r2.strikesIn24h, 2);
  assert.equal(r2.limitReached, false);
  fs.rmSync(path.join(f.appState, 'guard/pending-alert.json'));

  // Strike 3 -> limitReached
  put(path.join(f.state, 'workspace/SOUL.md'), 'evil 3');
  const r3 = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub, now: at(2)});
  assert.equal(r3.strikesIn24h, 3);
  assert.equal(r3.limitReached, true);
  assert.equal(readAlert().limitReached, true);
  fs.rmSync(path.join(f.appState, 'guard/pending-alert.json'));

  // Clean reopen -> allowed, count preserved, no alert
  const clean = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub, now: at(3)});
  assert.equal(clean.restored.length, 0);
  assert.equal(clean.strikesIn24h, 3);
  assert.equal(clean.limitReached, false);
  assert.equal(fs.existsSync(path.join(f.appState, 'guard/pending-alert.json')), false);

  // Re-offense within 24h -> immediate limitReached
  put(path.join(f.state, 'workspace/SOUL.md'), 'evil 4');
  const r4 = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub, now: at(4)});
  assert.equal(r4.strikesIn24h, 4);
  assert.equal(r4.limitReached, true);
  assert.equal(readAlert().limitReached, true);
  fs.rmSync(path.join(f.appState, 'guard/pending-alert.json'));

  // After > 24h from all prior strikes -> resets cleanly to 1
  put(path.join(f.state, 'workspace/SOUL.md'), 'evil 5');
  const r5 = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub, now: at(29)});
  assert.equal(r5.strikesIn24h, 1);
  assert.equal(r5.limitReached, false);
});

test('counter deletion or modification is treated as limit reached', () => {
  const f = fixture();
  const r1 = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub});
  assert.equal(r1.strikesIn24h, 1);
  const counterFile = path.join(f.appState, 'guard/counter.json');
  assert.equal(verifyCounterState(JSON.parse(fs.readFileSync(counterFile, 'utf8')), bundleIdentity(f.bundle), pub), true);

  // Edit counter.json to reset events
  const edited = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
  edited.events = [];
  fs.writeFileSync(counterFile, JSON.stringify(edited));
  const afterEdit = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub});
  assert.equal(afterEdit.counterTampered, true);
  assert.equal(afterEdit.limitReached, true);
  assert.equal(afterEdit.strikesIn24h, 3);
  assert.equal(verifyCounterState(JSON.parse(fs.readFileSync(counterFile, 'utf8')), bundleIdentity(f.bundle), pub), true);

  // Delete counter.json while receipt exists
  fs.rmSync(counterFile);
  const afterDelete = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub});
  assert.equal(afterDelete.counterTampered, true);
  assert.equal(afterDelete.limitReached, true);

  // Delete entire guard/ directory while extensions/*/guard-build.json receipt exists
  fs.rmSync(path.join(f.appState, 'guard'), {recursive: true, force: true});
  const afterWipe = startup({bundle: f.bundle, home: f.home, appState: f.appState, key: pub});
  assert.equal(afterWipe.counterTampered, true);
  assert.equal(afterWipe.limitReached, true);
});

test('fresh install, signed bundle update, missing playbook script, and restore failure do not add false strikes', () => {
  // 1. Fresh install (no existing files overwritten)
  const freshRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-fresh-')));
  const fBundle = path.join(freshRoot, 'SuperPinkie');
  const fHome = path.join(freshRoot, 'home');
  const fAppState = path.join(freshRoot, 'app-state');
  put(path.join(fBundle, 'VERSION'), '2.5.50\n');
  put(path.join(fBundle, 'build-info.json'), JSON.stringify({guard: true, channel: 'release', version: '2.5.50'}));
  put(path.join(fBundle, 'personas/chat/SOUL.md'), 'official v1');
  put(path.join(fBundle, 'personas/chat/playbooks/machine-check.ps1'), 'echo ok');
  fs.writeFileSync(path.join(fBundle, 'guard-manifest.json'), JSON.stringify(buildManifest(fBundle, {commit: 'a'.repeat(40)})));
  fs.writeFileSync(path.join(fBundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(fBundle, 'guard-manifest.json')), keyPem));

  const seed = startup({bundle: fBundle, home: fHome, appState: fAppState, key: pub});
  assert.equal(seed.initialSeed, true);
  assert.equal(seed.strikesIn24h, 0);
  assert.equal(seed.history.length, 0);
  assert.equal(fs.existsSync(path.join(fAppState, 'guard/pending-alert.json')), false);

  // 2. Missing non-core playbook script (AV quarantine simulation) -> restored silently without strike
  fs.rmSync(path.join(fHome, '.openclaw/workspace/playbooks/machine-check.ps1'));
  const av = startup({bundle: fBundle, home: fHome, appState: fAppState, key: pub});
  assert.equal(fs.readFileSync(path.join(fHome, '.openclaw/workspace/playbooks/machine-check.ps1'), 'utf8'), 'echo ok');
  assert.equal(av.strikesIn24h, 0);
  assert.equal(fs.existsSync(path.join(fAppState, 'guard/pending-alert.json')), false);

  // 3. One real tamper strike, then normal signed bundle upgrade -> preserves 1 strike, no new strike or alert
  put(path.join(fHome, '.openclaw/workspace/SOUL.md'), 'tampered once');
  const s1 = startup({bundle: fBundle, home: fHome, appState: fAppState, key: pub});
  assert.equal(s1.strikesIn24h, 1);
  fs.rmSync(path.join(fAppState, 'guard/pending-alert.json'));

  put(path.join(fBundle, 'VERSION'), '2.5.51\n');
  put(path.join(fBundle, 'build-info.json'), JSON.stringify({guard: true, channel: 'release', version: '2.5.51'}));
  put(path.join(fBundle, 'personas/chat/SOUL.md'), 'official v2');
  fs.writeFileSync(path.join(fBundle, 'guard-manifest.json'), JSON.stringify(buildManifest(fBundle, {commit: 'b'.repeat(40)})));
  fs.writeFileSync(path.join(fBundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(fBundle, 'guard-manifest.json')), keyPem));
  const up = startup({bundle: fBundle, home: fHome, appState: fAppState, key: pub});
  assert.equal(up.isBundleTransition, true);
  assert.equal(up.strikesIn24h, 1);
  assert.equal(fs.readFileSync(path.join(fHome, '.openclaw/workspace/SOUL.md'), 'utf8'), 'official v2');
  assert.equal(fs.existsSync(path.join(fAppState, 'guard/pending-alert.json')), false);

  // 4. Restore failure (read-only workspace dir) -> prompts restoreFailed, does not count
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    put(path.join(fHome, '.openclaw/workspace/SOUL.md'), 'modified before ro');
    const wsDir = path.join(fHome, '.openclaw/workspace');
    fs.chmodSync(wsDir, 0o555);
    try {
      const failed = startup({bundle: fBundle, home: fHome, appState: fAppState, key: pub});
      assert.ok(failed.restoreFailed.length >= 1);
      assert.equal(failed.strikesIn24h, 1);
      const alert = JSON.parse(fs.readFileSync(path.join(fAppState, 'guard/pending-alert.json'), 'utf8'));
      assert.equal(alert.restoreFailed, true);
      assert.equal(alert.limitReached, false);
    } finally {
      fs.chmodSync(wsDir, 0o755);
    }
  }
});

test('invisible provenance watermark stamps modes except neutral and decodes version + commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-stamp-'));
  put(path.join(root, 'chat/SOUL.md'), '# SOUL.md - 聊天\n\n正文内容\n');
  put(path.join(root, 'project/AGENTS.md'), '# AGENTS.md\n\n项目手册\n');
  put(path.join(root, 'neutral/SOUL.md'), '# SOUL.md - Neutral\n\nUntouched\n');
  const count = stampPersonas(root, {version: '2.5.49', commit: 'a69ac76e12345678', channel: 'release'});
  assert.equal(count, 2);
  // Idempotent on second run
  assert.equal(stampPersonas(root, {version: '2.5.49', commit: 'a69ac76e12345678', channel: 'release'}), 0);
  const soul = fs.readFileSync(path.join(root, 'chat/SOUL.md'), 'utf8');
  assert.equal(fs.readFileSync(path.join(root, 'neutral/SOUL.md'), 'utf8'), '# SOUL.md - Neutral\n\nUntouched\n');
  assert.equal(soul.includes('2.5.49'), false, 'version string is not visibly printed in Markdown');
  assert.equal(soul.includes('a69ac76e'), false, 'commit is not visibly printed in Markdown');
  const mark = inspectPersonaMark(soul);
  assert.deepEqual(mark, {found: true, version: '2.5.49', commit: 'a69ac76e1234', channel: 'release', tag: '', raw: 'SP|2.5.49|a69ac76e1234|release'});

  const guardPath = fileURLToPath(new URL('../installer/guard/guard.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [guardPath, 'inspect-mark', path.join(root, 'project/AGENTS.md')], {encoding: 'utf8'});
  assert.equal(res.status, 0);
  assert.equal(JSON.parse(res.stdout).commit, 'a69ac76e1234');
});

test('fresh install Launch #1 -> setup openclaw.json -> Launch #2 has zero false strikes, and Launch #3 tamper IS caught', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-launch2-')));
  const bundle = path.join(root, 'SuperPinkie');
  const home = path.join(root, 'home');
  const state = path.join(home, '.openclaw');
  const appState = path.join(root, 'app-state');
  put(path.join(bundle, 'VERSION'), '2.5.50\n');
  put(path.join(bundle, 'build-info.json'), JSON.stringify({guard: true, channel: 'release', version: '2.5.50'}));
  put(path.join(bundle, 'personas/chat/SOUL.md'), 'official soul');
  fs.writeFileSync(path.join(bundle, 'guard-manifest.json'), JSON.stringify(buildManifest(bundle, {commit: 'a'.repeat(40)})));
  fs.writeFileSync(path.join(bundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(bundle, 'guard-manifest.json')), keyPem));

  // Launch #1: openclaw.json does not exist yet (apply-bundled.sh / super_pinkie.py creates it afterward)
  const l1 = startup({bundle, home, appState, key: pub});
  assert.equal(l1.initialSeed, true);
  assert.equal(l1.configInitialized, false);
  assert.equal(l1.strikesIn24h, 0);
  assert.equal(fs.existsSync(path.join(appState, 'guard/pending-alert.json')), false);
  assert.equal(fs.existsSync(path.join(state, 'guard-receipt.json')), true);

  // Setup creates openclaw.json without skills.load.extraDirs
  put(path.join(state, 'openclaw.json'), JSON.stringify({
    plugins: {entries: {'pinkie-mode-architecture': {enabled: true, hooks: {allowPromptInjection: true, allowConversationAccess: true}}}},
    agents: {list: [{id: 'main', workspace: path.join(state, 'workspace')}]},
  }));

  // Launch #2: guard initializes skills.load.extraDirs silently -> zero false strike, no popup
  const l2 = startup({bundle, home, appState, key: pub});
  assert.equal(l2.configInitialized, true);
  assert.equal(l2.strikesIn24h, 0);
  assert.deepEqual(l2.configFixed, []);
  assert.equal(fs.existsSync(path.join(appState, 'guard/pending-alert.json')), false);
  const cfg = JSON.parse(fs.readFileSync(path.join(state, 'openclaw.json'), 'utf8'));
  assert.deepEqual(cfg.skills.load.extraDirs, [path.join(state, 'user-skills')]);

  // Launch #3: user later removes skills.load.extraDirs -> now IS caught as Strike #1
  delete cfg.skills.load.extraDirs;
  fs.writeFileSync(path.join(state, 'openclaw.json'), JSON.stringify(cfg));
  const l3 = startup({bundle, home, appState, key: pub});
  assert.equal(l3.strikesIn24h, 1);
  assert.deepEqual(l3.configFixed, ['skills.load.extraDirs']);
  assert.equal(fs.existsSync(path.join(appState, 'guard/pending-alert.json')), true);
});

test('pre-Batch-D upgrade, same-version hotfix rebuild, guard wipe after Launch #1, and active update lock behave safely', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-edge-')));
  const bundle = path.join(root, 'SuperPinkie');
  const home = path.join(root, 'home');
  const state = path.join(home, '.openclaw');
  const appState = path.join(root, 'app-state');
  put(path.join(bundle, 'VERSION'), '2.5.50\n');
  put(path.join(bundle, 'build-info.json'), JSON.stringify({guard: true, channel: 'release', version: '2.5.50'}));
  put(path.join(bundle, 'personas/chat/SOUL.md'), 'official v50a');
  fs.writeFileSync(path.join(bundle, 'guard-manifest.json'), JSON.stringify(buildManifest(bundle, {commit: 'a'.repeat(40)})));
  fs.writeFileSync(path.join(bundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(bundle, 'guard-manifest.json')), keyPem));

  // 1. Pre-Batch-D install had bundled-personas-2.5.50 and unstamped SOUL.md, no counter.json or guard-receipt.json
  put(path.join(appState, 'bundled-personas-2.5.50'), '1\n');
  put(path.join(state, 'workspace/SOUL.md'), 'old unstamped v50');
  const migrated = startup({bundle, home, appState, key: pub});
  assert.equal(migrated.counterTampered, false);
  assert.equal(migrated.isBundleTransition, true);
  assert.equal(migrated.strikesIn24h, 0);
  assert.equal(fs.existsSync(path.join(appState, 'guard/pending-alert.json')), false);

  // 2. Wipe entire guard/ dir right after Launch #1 (even without extensions/) -> caught via guard-receipt.json!
  fs.rmSync(path.join(appState, 'guard'), {recursive: true, force: true});
  const wiped = startup({bundle, home, appState, key: pub});
  assert.equal(wiped.counterTampered, true);
  assert.equal(wiped.limitReached, true);
  fs.rmSync(path.join(appState, 'guard/pending-alert.json'));

  // 3. Same-version signed hotfix rebuild (2.5.50 commit a -> 2.5.50 commit b) with bundled-personas-2.5.50 present -> NO false counterTampered
  put(path.join(bundle, 'personas/chat/SOUL.md'), 'official v50b hotfix');
  fs.writeFileSync(path.join(bundle, 'guard-manifest.json'), JSON.stringify(buildManifest(bundle, {commit: 'b'.repeat(40)})));
  fs.writeFileSync(path.join(bundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(bundle, 'guard-manifest.json')), keyPem));
  const hotfix = startup({bundle, home, appState, key: pub});
  assert.equal(hotfix.counterTampered, false);
  assert.equal(hotfix.isBundleTransition, true);
  assert.equal(hotfix.limitReached, false);
  assert.equal(hotfix.strikesIn24h, 3, 'prior strike count preserved across hotfix');
  assert.equal(fs.existsSync(path.join(appState, 'guard/pending-alert.json')), false);

  // 4. Active update lock (install-in-progress.json with live pid) -> no strike, no counterTampered, no pending-alert
  put(path.join(appState, 'updates/install-in-progress.json'), JSON.stringify({pid: process.pid}));
  put(path.join(state, 'workspace/SOUL.md'), 'mid-update content');
  const duringUpdate = startup({bundle, home, appState, key: pub});
  assert.equal(duringUpdate.updating, true);
  assert.equal(duringUpdate.counterTampered, false);
  assert.equal(duringUpdate.limitReached, false);
  assert.equal(duringUpdate.strikesIn24h, 3, 'did not add a 4th strike during active update');
  assert.equal(fs.existsSync(path.join(appState, 'guard/pending-alert.json')), false);
});
