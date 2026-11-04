import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from '../patch/apply-preflight-compaction-events.mjs';

const runner = 'import { c as emitAgentEvent } from "./agent-events.js";\nimport { r as logVerbose } from "./globals.js";\n'
  + 'async function runPreflightCompactionIfNeeded(params) {\n'
  + '\tconst notifyCompaction = async (phase) => {\n\t\ttry {\n\t\t\tawait params.onCompactionNotice?.(phase);\n\t\t} catch (err) {}\n\t};\n'
  + '\treturn notifyCompaction;\n}\nexport { runPreflightCompactionIfNeeded };\n';

async function load(source, events) {
  const body = source.replace(/^\/\*.*\*\/\n/u, '').replace(/^import .*\n/gmu, '').replace(/^export .*\n/mu, '');
  return new Function('emitAgentEvent', 'logVerbose', `${body}\nreturn runPreflightCompactionIfNeeded;`)((event) => events.push(event), () => {});
}

test('pre-send compaction emits session-scoped start/end events and stays idempotent', async () => {
  const patched = transform(runner);
  assert.equal(transform(patched), patched);
  const events = [];
  const notices = [];
  const run = await load(patched, events);
  const notify = await run({sessionKey: 'agent:main:abc', onCompactionNotice: (phase) => notices.push(phase)});
  await notify('start');
  await notify('end');
  await notify('skipped');
  assert.deepEqual(notices, ['start', 'end', 'skipped']);
  assert.deepEqual(events.map((event) => [event.sessionKey, event.stream, event.data.phase, event.data.completed, event.data.skipped]), [
    ['agent:main:abc', 'compaction', 'start', undefined, undefined],
    ['agent:main:abc', 'compaction', 'end', true, undefined],
    ['agent:main:abc', 'compaction', 'end', false, true],
  ]);
  assert.equal(new Set(events.map((event) => event.runId)).size, 1);
});

test('the Windows snapshot carries the patched runner', () => {
  const file = new URL('../desktop/windows/mac-runtime/openclaw/dist/agent-runner.runtime-DtdxZiBX.js', import.meta.url);
  assert.match(fs.readFileSync(file, 'utf8'), /pinkie-preflight-compaction-events:v1/);
});

test('an unknown runner shape fails loudly instead of silently skipping', () => {
  assert.throws(() => transform('export {}'), /structure changed/);
});
