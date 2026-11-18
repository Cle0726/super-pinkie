const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
function job(name) {
  const marker = `  ${name}:\n`, start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing job ${name}`);
  const tail = workflow.slice(start + marker.length), next = tail.search(/^  [a-z][a-z-]*:\s*$/m);
  return next < 0 ? tail : tail.slice(0, next);
}
test('CI installs pinned browser dependencies and does not wait indefinitely', () => {
  for (const name of ['portable-checks', 'windows-checks', 'macos-check']) {
    const text = job(name);
    assert.match(text, /playwrightVersion/, `${name}: use the project-locked version`);
    assert.match(text, /ws@8\.23\.0/, `${name}: install WebSocket dependency`);
    assert.match(text, /install (?:--with-deps )?webkit/, `${name}: install WebKit`);
    assert.match(text, /NODE_PATH=/, `${name}: make packages visible to tests`);
  }
  assert.match(job('portable-checks'), /timeout-minutes: 30/);
  assert.match(job('windows-checks'), /timeout-minutes: 30/);
  assert.match(job('windows-checks'), /PINKIE_IMAGE_UI_ENGINE: chromium/);
  assert.match(job('windows-checks'), /tool-images-e2e\.test\.mjs/);
  assert.match(job('macos-check'), /PINKIE_IMAGE_UI_ENGINE: webkit/);
  assert.match(job('macos-check'), /tool-images-e2e\.test\.mjs/);
});
