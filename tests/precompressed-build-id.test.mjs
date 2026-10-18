import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {refreshPrecompressed} from '../patch/lib-precompressed.mjs';

const runtime = '2026.10.4-release-383c124cc32f-2026-10-15T17-18-22.749Z';
const generation = 'a'.repeat(64);
const gatewayPattern = /^([a-zA-Z0-9._-]{1,96})-[a-f0-9]{64}$/u;

function fixture(t, buildId) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-build-id-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const root = path.join(temporary, 'control-ui');
  fs.mkdirSync(path.join(root, 'assets'), {recursive: true});
  const asset = path.join(root, 'assets', 'entry.js');
  const index = path.join(root, 'index.html');
  const manifest = path.join(root, 'asset-manifest.json');
  fs.writeFileSync(asset, 'export const value = 0;');
  fs.writeFileSync(index, `<html data-openclaw-control-ui-build-id="${buildId}"></html>`);
  fs.writeFileSync(manifest, JSON.stringify({version: 1, generation, assets: [
    {path: 'assets/entry.js', size: 0, sha256: generation},
  ]}));
  return {asset, index, manifest, id: () => /build-id="([^"]+)"/u.exec(fs.readFileSync(index, 'utf8'))[1]};
}

test('repeated asset patches keep the runtime identity and the full current generation', (t) => {
  const f = fixture(t, `${runtime}-${generation}`);
  for (let i = 1; i <= 6; i++) {
    fs.writeFileSync(f.asset, `export const value = ${i};`);
    assert.equal(refreshPrecompressed(f.asset).manifest, 'updated');
    const manifest = JSON.parse(fs.readFileSync(f.manifest, 'utf8'));
    assert.equal(f.id(), `${runtime}-${manifest.generation}`);
    assert.equal(gatewayPattern.exec(f.id())?.[1], runtime);
    assert.ok(f.id().length <= 161);
  }
  const stable = f.id();
  assert.equal(refreshPrecompressed(f.asset).manifest, 'unchanged');
  assert.equal(f.id(), stable);
});

test('an overlong identifier from the old append-only helper is repaired', (t) => {
  const f = fixture(t, `${runtime}-${generation}${'-123456abcdef'.repeat(4)}`);
  assert.ok(f.id().length > 161);
  refreshPrecompressed(f.asset);
  assert.equal(gatewayPattern.exec(f.id())?.[1], runtime);
  assert.equal(f.id(), `${runtime}-${JSON.parse(fs.readFileSync(f.manifest, 'utf8')).generation}`);
});

test('unknown runtime build formats are preserved', (t) => {
  const f = fixture(t, 'custom-unknown-shape');
  refreshPrecompressed(f.asset);
  assert.equal(f.id(), 'custom-unknown-shape');
});
