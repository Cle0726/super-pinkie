import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from '../patch/apply-overflow-compaction-events.mjs';
import {runner, drive, importLine} from './helpers/fake-overflow-runner.mjs';

const overflow = 'Context overflow: prompt too large for the model';
const params = (extra) => ({sessionKey: 'agent:main:x', runId: 'r', ...extra});

test('mid-run compaction tells the chat page it started and that the run goes on', () => {
  const patched = transform(runner, importLine);
  assert.equal(transform(patched, importLine), patched, 'idempotent');
  assert.match(patched, /^\/\* pinkie-overflow-compaction-events:v2 \*\/\nimport \{ c as pinkieEmitAgentEvent \} from "\.\/agent-events-ABC\.js";/u, 'imports the same alias and file the runner uses');
  const events = [];
  const result = drive(patched, [overflow, null], {...params({sessionKey: 'agent:metre:dashboard:x', runId: 'r1'}), emitter: (event) => events.push(event)});
  assert.equal(result.ok, true);
  assert.deepEqual(events.map((e) => [e.runId, e.sessionKey, e.stream, e.data.phase, e.data.completed, e.data.willRetry]), [
    ['r1', 'agent:metre:dashboard:x', 'compaction', 'start', undefined, undefined],
    ['r1', 'agent:metre:dashboard:x', 'compaction', 'end', true, true],
  ]);
});

test('a failed mid-run compaction ends the notice without promising to continue', () => {
  const events = [];
  drive(transform(runner, importLine), [overflow], {...params(), compacted: false, emitter: (event) => events.push(event)});
  assert.deepEqual(events.map((e) => [e.data.phase, e.data.completed, e.data.willRetry]), [['start', undefined, undefined], ['end', false, false]]);
});

test('no session key, no event; a broken emitter never breaks the run', () => {
  const events = [];
  drive(transform(runner, importLine), [overflow, null], {runId: 'r3', emitter: (event) => events.push(event)});
  assert.equal(events.length, 0);
  const result = drive(transform(runner, importLine), [overflow, null], {...params(), emitter: () => { throw new Error('bus down'); }});
  assert.equal(result.ok, true);
});

test('refuses to guess when the runtime changed', () => {
  assert.throws(() => transform('nothing here', importLine), /start anchor/u);
  assert.throws(() => transform(runner, 'import { x } from "./y.js"'), /emitAgentEvent import/u);
});

test('the chat page listens to Metre compaction events and the patch runs on install', () => {
  const compact = fs.readFileSync(new URL('../ui/injections/laolao-context-compact.js', import.meta.url), 'utf8');
  assert.match(compact, /\^agent:\(main\|project\|thinking\|learning\|unrestricted\|metre\):/u);
  const theme = fs.readFileSync(new URL('../installer/macos/apply-theme.sh', import.meta.url), 'utf8');
  assert.match(theme, /patch\/apply-overflow-compaction-events\.mjs/u);
  const all = fs.readFileSync(new URL('../patch/apply-all.mjs', import.meta.url), 'utf8');
  assert.match(all, /'apply-overflow-compaction-events\.mjs'/u);
});
