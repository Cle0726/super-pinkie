import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createChannelReasoningGuard, isChatAppChannel, isChatAppSession, sessionsToQuiet} from '../services/mode-architecture/channel-reasoning.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('only Feishu / WeChat sessions are chat-app sessions; web sessions keep live thinking', () => {
  assert.ok(isChatAppSession('agent:learning:feishu:pinkie-learning:direct:ou_x'));
  assert.ok(isChatAppSession('agent:unrestricted:openclaw-weixin:bot:direct:o9'));
  assert.ok(!isChatAppSession('agent:main:dashboard:abc'));
  assert.ok(!isChatAppSession('agent:metre:main'));
  assert.ok(!isChatAppSession('agent:main:feishuish:x'), 'whole channel segment only');
  assert.ok(isChatAppChannel('feishu') && isChatAppChannel('openclaw-weixin') && !isChatAppChannel('webchat'));
  assert.deepEqual(sessionsToQuiet({
    'agent:learning:feishu:a:direct:1': {reasoningLevel: undefined},
    'agent:learning:feishu:a:direct:2': {reasoningLevel: 'off'},
    'agent:main:openclaw-weixin:b:direct:3': {reasoningLevel: 'stream'},
    'agent:main:dashboard:4': {reasoningLevel: 'stream'},
  }), ['agent:learning:feishu:a:direct:1', 'agent:main:openclaw-weixin:b:direct:3']);
});

test('the guard patches chat-app sessions off through sessions.patch and runs on their messages only', async () => {
  const calls = [];
  const access = {
    list: async agentId => ({entries: agentId === 'learning'
      ? {'agent:learning:feishu:a:direct:1': {}, 'agent:learning:dashboard:2': {}} : {}}),
    rpc: async (method, params) => { calls.push([method, params]); return {}; },
  };
  const guard = createChannelReasoningGuard({logger: {}}, {access, agents: ['main', 'learning']});
  assert.equal(guard.onMessage({}, {channelId: 'webchat'}, 'agent:main:dashboard:x'), null);
  assert.deepEqual(await guard.onMessage({}, {channelId: 'feishu'}, 'agent:learning:feishu:a:direct:1'),
    ['agent:learning:feishu:a:direct:1']);
  assert.deepEqual(calls, [['sessions.patch', {key: 'agent:learning:feishu:a:direct:1', agentId: 'learning', reasoningLevel: 'off'}]]);
});

test('the plugin wires the guard and both installers ship the module', () => {
  const index = read('services/mode-architecture/index.mjs');
  assert.match(index, /import \{createChannelReasoningGuard\} from '\.\/channel-reasoning\.mjs';/);
  assert.match(index, /channelReasoning\.sweep\(\)/);
  assert.match(index, /channelReasoning\.onMessage\(event, ctx, sessionKey\)/);
  assert.match(read('services/mode-architecture/setup.py'), /"channel-reasoning\.mjs"/);
  assert.match(read('installer/macos/apply-theme.sh'), / channel-reasoning\.mjs /);
});
