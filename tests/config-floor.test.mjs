import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ensureManualLimits} from '../services/mode-architecture/config-floor.mjs';

const file = text => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'floor-')), 'openclaw.json'); if (text != null) fs.writeFileSync(p, text); return p; };

test('raises missing or low limits, keeps everything else, leaves a backup', () => {
  const p = file(JSON.stringify({gateway: {port: 1}, agents: {defaults: {timeoutSeconds: 5, bootstrapMaxChars: 20000}, list: [{id: 'main'}]}}));
  const result = ensureManualLimits(p);
  assert.deepEqual(result, {changed: true, raised: ['bootstrapMaxChars', 'bootstrapTotalMaxChars']});
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(data.agents.defaults.bootstrapMaxChars, 60000); assert.equal(data.agents.defaults.bootstrapTotalMaxChars, 200000);
  assert.equal(data.agents.defaults.timeoutSeconds, 5); assert.deepEqual(data.agents.list, [{id: 'main'}]); assert.equal(data.gateway.port, 1);
  assert.ok(fs.existsSync(`${p}.before-manual-limit`));
  assert.equal(ensureManualLimits(p).changed, false, 'second run changes nothing');
});
test('never lowers, never touches a config it cannot understand', () => {
  const high = file(JSON.stringify({agents: {defaults: {bootstrapMaxChars: 90000, bootstrapTotalMaxChars: 300000}}}));
  const before = fs.readFileSync(high, 'utf8');
  assert.equal(ensureManualLimits(high).changed, false); assert.equal(fs.readFileSync(high, 'utf8'), before);
  const broken = file('{not json');
  assert.equal(ensureManualLimits(broken).reason, 'unparsable'); assert.equal(fs.readFileSync(broken, 'utf8'), '{not json');
  assert.equal(ensureManualLimits(file(JSON.stringify({agents: []}))).reason, 'unexpected-shape');
  assert.equal(ensureManualLimits(file(null)).reason, 'no-config');
  const empty = file('{}');
  assert.equal(ensureManualLimits(empty).changed, true);
});
