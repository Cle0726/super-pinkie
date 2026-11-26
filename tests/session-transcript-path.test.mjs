import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {SessionSearch} from '../services/mode-architecture/session-search.mjs';
import {createSessionAccess} from '../services/mode-architecture/session-titles.mjs';

const marker = 'PINKIE_LEAK';
const key = 'agent:main:dashboard:outside';

function layout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-session-path-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const sessions = path.join(root, 'sessions');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(sessions);
  fs.mkdirSync(outside);
  const secret = path.join(outside, 'secret.jsonl');
  fs.writeFileSync(secret, JSON.stringify({type: 'message', message: {role: 'user', content: marker}}) + '\n');
  const store = path.join(sessions, 'sessions.json');
  return {root, sessions, outside, secret, store};
}

function access(store) {
  return createSessionAccess({config: {session: {store}}}, {loadSdk: async () => null});
}

test('a sessionFile or sessionId outside the sessions directory is not opened', async t => {
  const dir = layout(t);
  const inside = path.join(dir.sessions, 'ok.jsonl');
  fs.writeFileSync(inside, JSON.stringify({type: 'message', message: {role: 'user', content: '正常记录'}}) + '\n');
  fs.writeFileSync(dir.store, JSON.stringify({
    [key]: {sessionId: 'ok', sessionFile: path.relative(dir.sessions, dir.secret), label: '新会话'},
    'agent:main:dashboard:abs': {sessionId: 'abs', sessionFile: dir.secret, label: '新会话'},
    'agent:main:dashboard:id': {sessionId: path.relative(dir.sessions, dir.secret).replace(/\.jsonl$/, ''), label: '新会话'},
    'agent:main:dashboard:ok': {sessionId: 'ok', sessionFile: 'ok.jsonl', label: '新会话'},
  }));
  const sessions = access(dir.store);
  for (const name of [key, 'agent:main:dashboard:abs', 'agent:main:dashboard:id']) {
    const entry = await sessions.entry(name);
    const leaked = entry?.transcript ? fs.readFileSync(entry.transcript, 'utf8').includes(marker) : false;
    assert.equal(entry, null, name);
    assert.equal(leaked, false, name);
  }
  const ok = await sessions.entry('agent:main:dashboard:ok');
  assert.match(fs.readFileSync(ok.transcript, 'utf8'), /正常记录/);
});

test('a transcript symlink that points outside the sessions directory is not opened', async t => {
  const dir = layout(t);
  fs.symlinkSync(dir.secret, path.join(dir.sessions, 'link.jsonl'));
  fs.writeFileSync(dir.store, JSON.stringify({
    [key]: {sessionId: 'link', sessionFile: 'link.jsonl', label: '普通会话标题'},
  }));
  const entry = await access(dir.store).entry(key);
  const leaked = entry?.transcript ? fs.readFileSync(entry.transcript, 'utf8').includes(marker) : false;
  assert.equal(entry, null);
  assert.equal(leaked, false);

  const search = new SessionSearch({access: {list: async () => ({entries: JSON.parse(fs.readFileSync(dir.store, 'utf8')), dir: dir.sessions})}});
  const result = await search.search({agentId: 'main', mode: 'chat', query: marker});
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 0);
  assert.equal(JSON.stringify(result).includes(marker), false);
});
