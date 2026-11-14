// tools-health-1113 C1: read, web_fetch, pinkie_search and code_search end their descriptions with
// Fable's sentence asking for independent calls in one reply. The runtime already runs them in parallel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HINT, marker, transform} from '../patch/apply-tool-parallel-hint.mjs';
import {createPinkieSearchTool} from '../services/mode-architecture/web-search-fallback.mjs';
import {createCodeSearchTool} from '../services/mode-architecture/code-tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'desktop/windows/mac-runtime/openclaw/dist');

test('the sentence is the one Fable wrote (PLAN section five)', () => {
  const plan = fs.readFileSync(path.join(root, 'briefs/tools-health-1113/PLAN.md'), 'utf8');
  assert.ok(plan.includes(`> ${HINT}`));
});

test('read and web_fetch descriptions get the sentence once; anything unexpected is refused', () => {
  const read = {anchor: 'until complete.`,', replace: `until complete. ${HINT}\`, /* ${marker} */`};
  const src = 'description: `Read ... until complete.`,\npromptSnippet: "x"';
  const out = transform(src, read);
  assert.ok(out.includes(`until complete. ${HINT}\``));
  assert.equal(transform(out, read), out, 'second run changes nothing');
  assert.throws(() => transform('description: `other`', read), /结构已变化/);
  assert.throws(() => transform(src + src, read), /出现 2 次/);
});

test('the Windows snapshot carries both patched descriptions', () => {
  const sessions = fs.readFileSync(path.join(dist, 'sessions-D8qGY7uC.js'), 'utf8');
  const tools = fs.readFileSync(path.join(dist, 'openclaw-tools-KulZ1cdH.js'), 'utf8');
  assert.ok(sessions.includes(`continue with offset until complete. ${HINT}\``));
  assert.ok(tools.includes(`no browser automation. ${HINT}"`));
  for (const text of [sessions, tools]) assert.equal(text.split(marker).length, 2);
});

test('the plugin search tools end with the same sentence', () => {
  assert.ok(createPinkieSearchTool().description.endsWith(HINT));
  assert.ok(createCodeSearchTool({}, {rootFor: () => root}).description.endsWith(HINT));
});
