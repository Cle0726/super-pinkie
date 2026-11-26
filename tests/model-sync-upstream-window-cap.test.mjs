import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createModelSynchronizer} from '../services/mode-architecture/model-sync.mjs';

function fixture(customWindow, upstreamWindow, configured = customWindow) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-window-cap-'));
  fs.writeFileSync(path.join(stateDir, 'pinkie-model-setup.json'), JSON.stringify({
    providers: {}, disabled: {},
    capabilities: {'aws-quick/claude-test': {contextWindow: customWindow}},
  }));
  const config = {models: {providers: {'aws-quick': {baseUrl: 'http://127.0.0.1:1466/v1', apiKey: 'fixture', models: [
    {id: 'claude-test', name: 'Claude test', reasoning: true, input: ['text'], contextWindow: configured, contextTokens: configured},
  ]}}}};
  const warnings = [];
  let writes = 0;
  const api = {
    logger: {warn: (message) => warnings.push(message)},
    runtime: {
      state: {resolveStateDir: () => stateDir},
      config: {current: () => config, mutateConfigFile: async ({mutate}) => { writes++; mutate(config); }},
    },
  };
  const sync = createModelSynchronizer(api, {
    fetchImpl: async () => new Response(JSON.stringify({data: [{id: 'claude-test', context_window: upstreamWindow}]})),
  });
  const cleanup = () => fs.rmSync(stateDir, {recursive: true, force: true});
  return {config, warnings, sync, writes: () => writes, cleanup};
}

test('a custom window larger than the upstream declaration is capped to the upstream value with a notice', async () => {
  // aws-quick 复发：capabilities 写了 900000，上游只声明 128000，旧逻辑无条件跳过同步。
  const f = fixture(900000, 128000);
  try {
    const result = await f.sync.sync();
    const [entry] = f.config.models.providers['aws-quick'].models;
    assert.equal(entry.contextWindow, 128000);
    assert.equal(entry.contextTokens, 128000);
    assert.equal(result.contextUpdated, 1);
    assert.equal(f.writes(), 1);
    assert.equal(result.contextCapped.length, 1);
    assert.match(result.contextCapped[0], /aws-quick\/claude-test.*900000.*128000/);
    assert.equal(f.warnings.length, 1);
    assert.match(f.warnings[0], /900000.*128000/);
  } finally { f.cleanup(); }
});

test('a custom window at or below the upstream declaration is still respected', async () => {
  for (const [custom, upstream] of [[256000, 1000000], [128000, 128000]]) {
    const f = fixture(custom, upstream);
    try {
      const result = await f.sync.sync();
      assert.equal(f.config.models.providers['aws-quick'].models[0].contextWindow, custom);
      assert.equal(result.contextUpdated, 0);
      assert.deepEqual(result.contextCapped, []);
      assert.equal(f.writes(), 0);
      assert.deepEqual(f.warnings, []);
    } finally { f.cleanup(); }
  }
});

test('a custom window is kept when the upstream declares no window', async () => {
  const f = fixture(900000, undefined);
  try {
    const result = await f.sync.sync();
    assert.equal(f.config.models.providers['aws-quick'].models[0].contextWindow, 900000);
    assert.equal(result.contextUpdated, 0);
    assert.equal(f.writes(), 0);
  } finally { f.cleanup(); }
});
