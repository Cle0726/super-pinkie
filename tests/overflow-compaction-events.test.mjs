import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from '../patch/apply-overflow-compaction-events.mjs';

const importLine = 'import { S as withX, c as emitAgentEvent, d as getY } from "./agent-events-ABC.js"';
const body = (outcome) => [
  'function run(params, log$1, provider, modelId, compactResult, overflowCompactionAttempts, MAX_OVERFLOW_COMPACTION_ATTEMPTS) {',
  'log$1.warn(`context overflow detected (attempt ${overflowCompactionAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}); attempting auto-compaction for ${provider}/${modelId}`);',
  `if (${outcome}) {`,
  'log$1.info(`auto-compaction succeeded for ${provider}/${modelId}; retrying prompt`);',
  'return "continue";',
  '}',
  'log$1.warn(`auto-compaction failed for ${provider}/${modelId}: ${compactResult.reason ?? "nothing to compact"}`);',
  'return "gave up";',
  '}',
].join('\n');
const runner = body('compactResult.compacted');

function load(source, events) {
  const code = source.replace(/^\/\*.*\*\/\n/u, '').replace(/^import .*\n/gmu, '');
  return new Function('pinkieEmitAgentEvent', `${code}\nreturn run;`)((event) => events.push(event));
}
const log = {warn() {}, info() {}};

test('mid-run compaction tells the chat page it started and that the run goes on', () => {
  const patched = transform(runner, importLine);
  assert.equal(transform(patched, importLine), patched, 'idempotent');
  assert.match(patched, /^\/\* pinkie-overflow-compaction-events:v1 \*\/\nimport \{ c as pinkieEmitAgentEvent \} from "\.\/agent-events-ABC\.js";/u, 'imports the same alias and file the runner uses');
  const events = [];
  const result = load(patched, events)({sessionKey: 'agent:metre:dashboard:x', runId: 'r1'}, log, 'p', 'm', {compacted: true}, 1, 3);
  assert.equal(result, 'continue');
  assert.deepEqual(events.map((e) => [e.runId, e.sessionKey, e.stream, e.data.phase, e.data.completed, e.data.willRetry]), [
    ['r1', 'agent:metre:dashboard:x', 'compaction', 'start', undefined, undefined],
    ['r1', 'agent:metre:dashboard:x', 'compaction', 'end', true, true],
  ]);
});

test('a failed mid-run compaction ends the notice without promising to continue', () => {
  const events = [];
  load(transform(runner, importLine), events)({sessionKey: 'agent:main:x', runId: 'r2'}, log, 'p', 'm', {compacted: false, reason: 'nothing'}, 1, 3);
  assert.deepEqual(events.map((e) => [e.data.phase, e.data.completed, e.data.willRetry]), [['start', undefined, undefined], ['end', false, false]]);
});

test('no session key, no event; a broken emitter never breaks the run', () => {
  const events = [];
  load(transform(runner, importLine), events)({runId: 'r3'}, log, 'p', 'm', {compacted: true}, 1, 3);
  assert.equal(events.length, 0);
  const code = transform(runner, importLine).replace(/^\/\*.*\*\/\n/u, '').replace(/^import .*\n/gmu, '');
  const run = new Function('pinkieEmitAgentEvent', `${code}\nreturn run;`)(() => { throw new Error('bus down'); });
  assert.equal(run({sessionKey: 'agent:main:x', runId: 'r4'}, log, 'p', 'm', {compacted: true}, 1, 3), 'continue');
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
