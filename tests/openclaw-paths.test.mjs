import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentEntries,
  agentWorkspace,
  expandHome,
  findAgent,
  openclawAgentEnvPath,
  openclawConfigPath,
  openclawStateDir,
  readConfigFile,
  runtimeConfig,
} from '../services/mode-architecture/openclaw-paths.mjs';

const HOME = path.join(os.tmpdir(), 'pinkie-paths-home');

test('state dir: default ~/.openclaw', () => {
  assert.equal(openclawStateDir({}, HOME), path.join(HOME, '.openclaw'));
});

test('state dir: OPENCLAW_STATE_DIR wins over OPENCLAW_PROFILE', () => {
  const env = {OPENCLAW_STATE_DIR: '/opt/oc-state', OPENCLAW_PROFILE: 'work'};
  assert.equal(openclawStateDir(env, HOME), '/opt/oc-state');
});

test('state dir: OPENCLAW_PROFILE becomes ~/.openclaw-<profile>', () => {
  assert.equal(openclawStateDir({OPENCLAW_PROFILE: 'work'}, HOME), path.join(HOME, '.openclaw-work'));
  assert.equal(openclawStateDir({OPENCLAW_PROFILE: '  dev  '}, HOME), path.join(HOME, '.openclaw-dev'));
  // 空白和空字符串都当没设置
  assert.equal(openclawStateDir({OPENCLAW_PROFILE: '', OPENCLAW_STATE_DIR: ''}, HOME), path.join(HOME, '.openclaw'));
});

test('~ is expanded in OPENCLAW_STATE_DIR and OPENCLAW_CONFIG_PATH', () => {
  assert.equal(expandHome('~', HOME), HOME);
  assert.equal(expandHome('~/x/y', HOME), path.join(HOME, 'x/y'));
  assert.equal(expandHome('/abs/path', HOME), '/abs/path');
  assert.equal(expandHome('', HOME), '');
  assert.equal(openclawStateDir({OPENCLAW_STATE_DIR: '~/profile-state'}, HOME), path.join(HOME, 'profile-state'));
  assert.equal(openclawConfigPath({env: {OPENCLAW_CONFIG_PATH: '~/cfg/openclaw.json'}, home: HOME}),
    path.join(HOME, 'cfg/openclaw.json'));
  assert.equal(openclawConfigPath({env: {OPENCLAW_STATE_DIR: '/srv/oc'}, home: HOME}), '/srv/oc/openclaw.json');
  assert.equal(openclawConfigPath({env: {OPENCLAW_PROFILE: 'p1'}, home: HOME}), path.join(HOME, '.openclaw-p1/openclaw.json'));
  assert.equal(openclawConfigPath({env: {}, home: HOME}), path.join(HOME, '.openclaw/openclaw.json'));
});

test('agentEntries reads the new agents.entries object and derives ids from keys', () => {
  const config = {agents: {entries: {main: {workspace: '/w/main'}, project: {model: 'x', id: 'project'}}}};
  assert.deepEqual(agentEntries(config), [{id: 'main', workspace: '/w/main'}, {id: 'project', model: 'x'}]);
});

test('agentEntries still reads the legacy agents.list array', () => {
  const config = {agents: {list: [{id: 'main', workspace: '/w/main'}, {id: 'learning'}, {workspace: '/no-id'}]}};
  assert.deepEqual(agentEntries(config), [{id: 'main', workspace: '/w/main'}, {id: 'learning'}]);
});

test('agents.entries wins over agents.list when both exist', () => {
  const config = {agents: {
    entries: {main: {workspace: '/new/main'}, thinking: {}},
    list: [{id: 'main', workspace: '/old/main'}, {id: 'learning', workspace: '/old/learning'}],
  }};
  assert.deepEqual(agentEntries(config), [{id: 'main', workspace: '/new/main'}, {id: 'thinking'}]);
});

test('agentEntries never returns duplicate ids', () => {
  const fromList = {agents: {list: [{id: 'main', workspace: '/a'}, {id: 'main', workspace: '/b'}]}};
  assert.deepEqual(agentEntries(fromList), [{id: 'main', workspace: '/a'}]);
  const fromEntries = {agents: {entries: {main: {workspace: '/a'}, ' main ': {workspace: '/b'}}}};
  assert.equal(agentEntries(fromEntries).length, 1);
  assert.equal(agentEntries(fromEntries)[0].workspace, '/a');
});

test('agentEntries tolerates missing or malformed config', () => {
  assert.deepEqual(agentEntries(), []);
  assert.deepEqual(agentEntries({}), []);
  assert.deepEqual(agentEntries({agents: {list: 'nope', entries: ['nope']}}), []);
  assert.deepEqual(agentEntries({agents: {list: [null, 3, {id: ''}]}}), []);
});

test('findAgent works on both formats', () => {
  assert.equal(findAgent({agents: {entries: {learning: {model: 'a/b'}}}}, 'learning').model, 'a/b');
  assert.equal(findAgent({agents: {list: [{id: 'learning', model: 'c/d'}]}}, 'learning').model, 'c/d');
  assert.equal(findAgent({agents: {}}, 'missing'), null);
  assert.equal(findAgent({}, ''), null);
});

test('agentWorkspace: configured workspace wins and expands ~', () => {
  assert.equal(agentWorkspace({agents: {entries: {main: {workspace: '~/ws/main'}}}}, 'main', {home: HOME}), path.join(HOME, 'ws/main'));
  assert.equal(agentWorkspace({agents: {list: [{id: 'project', workspace: '/data/project'}]}}, 'project', {home: HOME}), '/data/project');
});

test('agentWorkspace: defaults are <stateDir>/workspace and <stateDir>/workspace-<id>', () => {
  assert.equal(agentWorkspace({agents: {}}, 'main', {env: {}, home: HOME}), path.join(HOME, '.openclaw/workspace'));
  assert.equal(agentWorkspace({agents: {}}, 'learning', {env: {}, home: HOME}), path.join(HOME, '.openclaw/workspace-learning'));
  const env = {OPENCLAW_PROFILE: 'work'};
  assert.equal(agentWorkspace({}, 'main', {env, home: HOME}), path.join(HOME, '.openclaw-work/workspace'));
  assert.equal(agentWorkspace({}, 'thinking', {env, home: HOME}), path.join(HOME, '.openclaw-work/workspace-thinking'));
});

test('agentWorkspace: agents.defaults.workspace is the last fallback for non-main agents', () => {
  const config = {agents: {defaults: {workspace: '~/default-ws'}}};
  assert.equal(agentWorkspace(config, 'project', {home: HOME}), path.join(HOME, 'default-ws'));
  // main 有自己明确的缺省位置，不被 defaults 覆盖
  assert.equal(agentWorkspace(config, 'main', {home: HOME}), path.join(HOME, '.openclaw/workspace'));
});

test('runtimeConfig prefers the plugin API over the config file', () => {
  const apiConfig = {agents: {entries: {main: {workspace: '/from/api'}}}};
  const opts = {home: HOME};
  assert.equal(runtimeConfig({config: apiConfig}, opts), apiConfig);
  assert.equal(runtimeConfig({config: () => apiConfig}, opts), apiConfig);
  const runtime = {config: {current: () => apiConfig}};
  assert.equal(runtimeConfig({config: {agents: {entries: {main: {workspace: '/ignored'}}}}, runtime}, opts), apiConfig);
});

test('readConfigFile follows OPENCLAW_CONFIG_PATH', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-paths-'));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const dir = path.join(home, '.openclaw-prof');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'openclaw.json'), JSON.stringify({agents: {entries: {main: {}}}}));
  fs.writeFileSync(path.join(home, '__explicit__.json'), '{"probe":true}');
  t.after(() => fs.rmSync(path.join(home, '__explicit__.json'), {force: true}));
  assert.equal(readConfigFile({env: {OPENCLAW_CONFIG_PATH: path.join(home, '__explicit__.json')}, home}).probe, true);
  assert.equal(readConfigFile({env: {OPENCLAW_PROFILE: 'prof'}, home}).agents.entries.main.workspace, undefined);
  assert.deepEqual(readConfigFile({env: {OPENCLAW_PROFILE: 'other'}, home}), {});
});

test('openclawAgentEnvPath falls back to ~/.openclaw when the profile state dir has none', t => {
  const realHome = os.homedir();
  const created = !fs.existsSync(path.join(realHome, '.openclaw', 'agent-env'));
  if (created) fs.mkdirSync(path.join(realHome, '.openclaw', 'agent-env'), {recursive: true});
  t.after(() => {
    if (created) fs.rmSync(path.join(realHome, '.openclaw', 'agent-env'), {recursive: true, force: true});
  });
  const file = path.join(realHome, '.openclaw', 'agent-env', 'pinkie-probe.txt');
  fs.writeFileSync(file, 'ok');
  t.after(() => fs.rmSync(file, {force: true}));
  // 不依赖当前进程是否带 profile：两条路径都必须命中主目录那份
  assert.equal(openclawAgentEnvPath('pinkie-probe.txt'), file);
});
