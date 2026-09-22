import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WebGptActivityStore, createWebGptActivityTool} from '../services/mode-architecture/web-gpt-activity.mjs';

test('web GPT activity is exact-session local evidence capped to 40 events', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new WebGptActivityStore({root});
  const first = 'agent:learning:one';
  const second = 'agent:learning:two';
  store.append(first, {stage: 'queued', text: '用户原文'});
  store.append(first, {stage: 'sent', text: '发出的完整控制消息'});
  assert.deepEqual(store.status(second).events, []);
  assert.deepEqual(store.status(first).events.map(item => item.stage), ['queued', 'sent']);
  assert.equal(store.status(first).events[1].text, '发出的完整控制消息');
  for (let index = 0; index < 45; index += 1) store.append(first, {stage: 'note', text: `记录 ${index}`});
  assert.equal(store.status(first).events.length, 40);
  assert.deepEqual(store.status(first, {limit: 1, offset: 0}).events.map(item => item.text), ['记录 44']);
  assert.deepEqual(store.status(first, {limit: 1, offset: 1}).events.map(item => item.text), ['记录 43']);
  assert.equal(store.status(first, {limit: 1}).totalEvents, 40);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(store.fileFor(first)).mode & 0o777, 0o600);
  }

  const tool = createWebGptActivityTool(store, {sessionKey: second});
  const result = await tool.execute('call-1', {action: 'received', content: '网页可见回复'});
  assert.equal(result.isError, false);
  assert.equal(store.status(second).events[0].text, '网页可见回复');
});
