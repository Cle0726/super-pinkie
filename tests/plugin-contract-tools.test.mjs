// OpenClaw refuses to load the whole pinkie-mode-architecture plugin when a tool it registers is
// missing from contracts.tools (11-13: pinkie_search was added without it and every feature died).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../services/mode-architecture');

test('every tool the plugin registers is declared in contracts.tools', () => {
  const declared = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'openclaw.plugin.json'), 'utf8')).contracts.tools);
  const registered = new Set();
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.mjs'))) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of source.matchAll(/registerTool\??\.?\([^;]*?\{\s*name:\s*['"]([a-z_]+)['"]/gs)) registered.add(m[1]);
  }
  assert.ok(registered.has('pinkie_search'), 'the scan still finds registered tools');
  assert.deepEqual([...registered].filter(n => !declared.has(n)), []);
});
