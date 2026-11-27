// PR 截图工作流（.github/workflows/pr-shots.yml）的约定：只读、只拍指定的头、两个系统都拍、图和 jsonl 作为 artifact 上传。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/pr-shots.yml'), 'utf8');
const script = fs.readFileSync(path.join(root, 'tools/pr-shots/minimal.mjs'), 'utf8');

test('PR shots runs by hand with PR number, head SHA and script, and self-checks on its own PRs', () => {
  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      pr:[\s\S]*?      sha:[\s\S]*?      script:/);
  assert.match(workflow, /pull_request:\n    paths:\n      - \.github\/workflows\/pr-shots\.yml\n      - tools\/pr-shots\/\*\*/);
  assert.match(workflow, /default: tools\/pr-shots\/minimal\.mjs/);
});

test('PR shots is read-only and refuses a head other than the one asked for', () => {
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /write-all|contents: write|pull_request_target/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/, 'full SHA only');
  assert.match(workflow, /\[ "\$head" = "\$SHA" \]/, 'checked-out head must equal the requested SHA');
  assert.match(workflow, /\*\.\.\*/, 'script path may not climb out of the repo');
});

test('PR shots captures on Linux and Windows with the pinned browsers and uploads PNG + jsonl', () => {
  assert.match(workflow, /os: ubuntu-latest\n            label: linux/);
  assert.match(workflow, /os: windows-latest\n            label: windows/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /playwrightVersion/);
  assert.match(workflow, /ws@8\.23\.0/);
  assert.match(workflow, /install --with-deps chromium webkit/);
  assert.match(workflow, /NODE_PATH=/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(workflow, /shots\.jsonl/);
  assert.match(workflow, /0x89, 0x50, 0x4e, 0x47/, 'every listed file must be a PNG');
  assert.match(workflow, /name: pr-shots-\$\{\{ env\.PR \}\}-\$\{\{ env\.SHORT \}\}-\$\{\{ matrix\.label \}\}/);
  assert.match(workflow, /if-no-files-found: error/);
});

test('the minimal script follows the --out + shots.jsonl convention and stays off the gateway', () => {
  assert.match(script, /--out/);
  assert.match(script, /shots\.jsonl/);
  for (const key of ['name', 'file', 'os', 'browser', 'width', 'height', 'bytes', 'sha256']) assert.match(script, new RegExp('\\b' + key + '\\b'));
  assert.doesNotMatch(script, /gwRequest|WebSocket|18789|localhost/);
});
