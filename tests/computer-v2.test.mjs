import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../patch/apply-computer-v2.mjs');
const legacy = 'const COMPUTER_TOOL_ACTIONS = COMPUTER_USE_V1_ACTION_NAMES;\nconst EXECUTION_OWNED_ACTIONS = new Set([]);\n';
const refusal = '\tconst refusalCode = (result.isError ? result.errorCode : void 0) ?? structuredRefusalCode(result);\n'
  + '\tif (result.isError || refusalCode) {\n\t\tthrow new Error("COMPUTER_DRIVER_ERROR");\n\t}\n\treturn result;\n';

/** 2026.7 shipped .js chunks; 2026.10 emits .mjs. The sibling modules that
 * merely share the prefix (control/outcome/shared) must never be rewritten. */
function fakeRoot({extension}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-computer-v2-'));
  const dist = path.join(root, 'dist');
  const cua = path.join(dist, 'extensions', 'cua-computer');
  fs.mkdirSync(cua, {recursive: true});
  fs.writeFileSync(path.join(dist, `computer-tool-xn2S9vJM.${extension}`), legacy);
  for (const sibling of ['computer-tool-control-ZF49NJn1', 'computer-tool-outcome-8o2rLZXB', 'computer-tool-shared-B6dQ6PvX']) {
    fs.writeFileSync(path.join(dist, `${sibling}.${extension}`), legacy);
  }
  fs.writeFileSync(path.join(cua, 'index.js'), refusal);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [script], {env: {...process.env, OPENCLAW_ROOT: root}, encoding: 'utf8'});
}

for (const [label, extension] of [['2026.7', 'js'], ['2026.10', 'mjs']]) {
  test(`${label} computer tool advertises the v2 action union at turn start`, () => {
    const root = fakeRoot({extension});
    try {
      const result = run(root);
      assert.equal(result.status, 0, result.stderr);
      const source = fs.readFileSync(path.join(root, 'dist', `computer-tool-xn2S9vJM.${extension}`), 'utf8');
      assert.match(source, /COMPUTER_TOOL_ACTIONS = COMPUTER_USE_V2_ACTION_NAMES;/);
      assert.doesNotMatch(source, /COMPUTER_USE_V1_ACTION_NAMES/);
      for (const sibling of ['control-ZF49NJn1', 'outcome-8o2rLZXB', 'shared-B6dQ6PvX']) {
        assert.match(fs.readFileSync(path.join(root, 'dist', `computer-tool-${sibling}.${extension}`), 'utf8'),
          /COMPUTER_USE_V1_ACTION_NAMES/, 'sibling chunks keep their own schema');
      }
      const provider = fs.readFileSync(path.join(root, 'dist', 'extensions', 'cua-computer', 'index.js'), 'utf8');
      assert.match(provider, /const acceptedFocusedBringToFront = name === "bring_to_front"/);
      // Idempotent: a second run reports both parts as already enabled.
      const again = run(root);
      assert.equal(again.status, 0);
      assert.match(again.stdout, /already enabled/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
}

test('refuses a partial patch when the schema anchor disappears', () => {
  const root = fakeRoot({extension: 'mjs'});
  try {
    fs.writeFileSync(path.join(root, 'dist', 'computer-tool-xn2S9vJM.mjs'), 'const ACTIONS = 1;\n');
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing a silent partial patch/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
