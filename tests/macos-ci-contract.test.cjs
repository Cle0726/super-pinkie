const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
test('macOS CI type-checks the same native Swift sources as the macOS build', () => {
  const build = fs.readFileSync(path.join(root, 'desktop/macos/build.sh'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const buildSources = [...build.matchAll(/"\$NATIVE_SOURCE_DIR\/([^"\n]+\.swift)"/g)].map(m => m[1]);
  const ciSources = [...workflow.matchAll(/"\$src\/([^"\n]+\.swift)"/g)].map(m => m[1]);
  assert.ok(buildSources.includes('Launcher.swift'), 'must inspect the actual build source list');
  assert.ok(buildSources.includes('ChatGPTBackgroundWorker.swift'), 'worker must be part of the actual build');
  for (const source of buildSources) assert.ok(ciSources.includes(source), `macOS CI omits ${source}`);
});
