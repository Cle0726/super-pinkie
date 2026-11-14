// tools-health-1113 A2: a mode database written by a newer OpenClaw is moved
// aside byte-for-byte, never deleted, so the runtime can rebuild one it reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {quarantineNewerAgentDatabases, runtimeDistDir, sqliteUserVersion, supportedAgentSchemaVersion} from '../services/mode-architecture/agent-db-guard.mjs';

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const old = new Date(2026, 10, 13, 11).getTime();

function fakeDb(file, version, {sidecars = true} = {}) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);');
  const insert = db.prepare('INSERT INTO notes(body) VALUES (?)');
  for (let i = 0; i < 200; i++) insert.run(`技能大赛笔记 ${i} `.repeat(20));
  db.exec(`PRAGMA user_version = ${version};`);
  db.close();
  if (sidecars) {
    fs.writeFileSync(file + '-wal', crypto.randomBytes(4096));
    fs.writeFileSync(file + '-shm', crypto.randomBytes(32768));
  }
  for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.utimesSync(f, old / 1000, old / 1000);
}

function setup() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-agentdb-'));
  const dbOf = id => path.join(stateDir, 'agents', id, 'agent', 'openclaw-agent.sqlite');
  return {stateDir, dbOf};
}

test('a schema-19 database (with -wal/-shm) is moved intact; a schema-1 one is left alone', () => {
  const {stateDir, dbOf} = setup();
  fakeDb(dbOf('project'), 19);
  fakeDb(dbOf('main'), 1);
  const before = Object.fromEntries(['', '-wal', '-shm'].map(s => [s, {sha: sha(dbOf('project') + s), size: fs.statSync(dbOf('project') + s).size}]));
  assert.equal(sqliteUserVersion(dbOf('project')), 19);
  const now = new Date(2026, 10, 13, 12).getTime();
  const config = {agents: {list: [{id: 'main'}, {id: 'project', agentDir: path.dirname(dbOf('project'))}, {id: 'learning'}]}};
  const report = quarantineNewerAgentDatabases({config, stateDir, supported: 1, now});
  assert.equal(report.length, 1);
  assert.equal(report[0].action, 'moved');
  const target = path.join(stateDir, 'backups', 'agent-db-20261113', 'project');
  assert.equal(report[0].to, target);
  for (const s of ['', '-wal', '-shm']) {
    assert.equal(fs.existsSync(dbOf('project') + s), false, `original${s} is gone from the mode folder`);
    const moved = path.join(target, 'openclaw-agent.sqlite' + s);
    assert.equal(sha(moved), before[s].sha, `backup${s} is byte-identical`);
    assert.equal(fs.statSync(moved).size, before[s].size);
  }
  assert.equal(sqliteUserVersion(dbOf('main')), 1, 'the readable one stays');
  // A second start finds nothing more to do.
  assert.deepEqual(quarantineNewerAgentDatabases({config, stateDir, supported: 1, now}), []);
});

test('a database touched in the last minute is not moved (someone may be writing it)', () => {
  const {stateDir, dbOf} = setup();
  fakeDb(dbOf('thinking'), 19);
  fs.utimesSync(dbOf('thinking') + '-wal', new Date(), new Date());
  const report = quarantineNewerAgentDatabases({config: {agents: {list: [{id: 'thinking'}]}}, stateDir, supported: 1});
  assert.equal(report[0].action, 'skipped-busy');
  assert.equal(sqliteUserVersion(dbOf('thinking')), 19);
});

test('a -shm rewritten just now (the runtime opened the db at startup and gave up) does not count as busy', () => {
  const {stateDir, dbOf} = setup();
  fakeDb(dbOf('learning'), 19);
  const now = Date.now();
  fs.utimesSync(dbOf('learning') + '-shm', new Date(now - 8000), new Date(now - 8000));
  const report = quarantineNewerAgentDatabases({config: {agents: {list: [{id: 'learning'}]}}, stateDir, supported: 1, now});
  assert.equal(report[0].action, 'moved');
  assert.equal(fs.existsSync(dbOf('learning')), false);
});

test('if any file of the set cannot be moved, the whole set goes back', () => {
  const {stateDir, dbOf} = setup();
  fakeDb(dbOf('main'), 19);
  const now = new Date(2026, 10, 13, 12).getTime();
  const target = path.join(stateDir, 'backups', 'agent-db-20261113', 'main');
  fs.mkdirSync(target, {recursive: true});
  fs.writeFileSync(path.join(target, 'openclaw-agent.sqlite-shm'), 'already here');
  const hash = sha(dbOf('main'));
  const report = quarantineNewerAgentDatabases({config: {agents: {entries: {main: {}}}}, stateDir, supported: 1, now});
  assert.equal(report[0].action, 'skipped-error');
  assert.equal(sha(dbOf('main')), hash);
  assert.ok(fs.existsSync(dbOf('main') + '-wal'), 'the -wal is back next to its database');
});

test('the supported version is read from the runtime bundle; unknown means do nothing', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-dist-'));
  assert.equal(supportedAgentSchemaVersion(dist), null);
  fs.writeFileSync(path.join(dist, 'openclaw-agent-db-DKpxi-Ll.js'), 'const OPENCLAW_AGENT_SCHEMA_VERSION = 1;\n');
  assert.equal(supportedAgentSchemaVersion(dist), 1);
  assert.deepEqual(quarantineNewerAgentDatabases({config: {agents: {list: [{id: 'main'}]}}, stateDir: dist, supported: null}), []);
  assert.equal(runtimeDistDir({PINKIE_OPENCLAW_RUNTIME: '/x/dist'}), '/x/dist');
  assert.equal(runtimeDistDir({}, ['node', path.join('/rt', 'openclaw', 'openclaw.mjs')]), path.join('/rt', 'openclaw', 'dist'));
  assert.equal(sqliteUserVersion(path.join(dist, 'missing.sqlite')), null);
});
