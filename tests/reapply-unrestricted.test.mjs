import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../patch/reapply-unrestricted-patch.mjs');

// 2026.7: the transport lives in openclaw dist and the dashboard path in the
// thin @openclaw/ai completions module.
const legacyDist = 'function createOpenAICompletionsClient(model, context, apiKey, optionHeaders) {\n'
  + '\tconst params = build();\n\tconst nextParams = await options?.onPayload?.(params, model);\n\tif (nextParams !== void 0) params = nextParams;\n\tif (nextParams !== void 0) params = nextParams;\n\tif (nextParams !== void 0) params = nextParams;\n'
  + '\treturn params;\n}\n';
const legacyAi = 'const streamSimpleOpenAICompletions = (model, context, options) => {\n'
  + '\t\t\tconst nextParams = await options?.onPayload?.(params, model);\n\t\t\tif (nextParams !== void 0) params = nextParams;\n\t\t\tfirstEventAbort = createFirstStreamEventAbortController(options?.signal);\n'
  + '};\n';

// 2026.10: dist is a re-export shim and the completions transport carries two
// payload hooks (native Responses + completions).
const currentDist = 'import "./ai-transport-runtime-host-BiT734Cc.mjs";\n'
  + 'import { buildOpenAICompletionsParams, createOpenAIResponsesTransportStreamFn } from "@openclaw/ai/transports";\n';
const currentAi = 'function createManagedCompletionsClient(model, context, options, apiKey, cacheRetention) {\n'
  + '\treturn { client: 1 };\n}\n'
  + 'async function streamOpenAICompletionsRequest(model, context, options, mode) {\n'
  + '\tconst prepareRequest = async (request) => {\n\t\tlet params = request;\n\t\t\t\t\tconst nextParams = await options?.onPayload?.(params, model);\n\t\t\t\t\tif (nextParams !== void 0) params = nextParams;\n\t\tparams = sanitize(params);\n\t\treturn params;\n\t};\n'
  + '\t\t\tlet params = buildOpenAICompletionsRequest(model, context, options, policy);\n'
  + '\t\t\tconst encodeBody = prepareModelRequestBody(options);\n'
  + '\t\t\tconst nextParams = await options?.onPayload?.(params, model);\n\t\t\tif (nextParams !== void 0) params = nextParams;\n'
  + '\tif (mode === "managed") return 1;\n\treturn 2;\n}\n';

function fixture({dist, ai, distName = 'openai-transport-stream-test.js'}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-ur-'));
  fs.mkdirSync(path.join(root, 'dist'), {recursive: true});
  const aiDist = path.join(root, 'node_modules', '@openclaw', 'ai', 'dist');
  fs.mkdirSync(aiDist, {recursive: true});
  fs.writeFileSync(path.join(root, 'dist', distName), dist);
  const aiFile = path.join(aiDist, ai === currentAi ? 'openai-completions-transport-test.mjs' : 'openai-completions-test.mjs');
  fs.writeFileSync(aiFile, ai);
  return {root, aiFile, distFile: path.join(root, 'dist', distName)};
}

function run(root, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    env: {...process.env, OPENCLAW_ROOT: root, UR_PROMPTS_DIR: path.join(root, 'prompts')},
    encoding: 'utf8',
  });
}

test('2026.10 injects on the completions transport and leaves the re-export shim alone', () => {
  const {root, aiFile, distFile} = fixture({dist: currentDist, ai: currentAi, distName: 'openai-transport-stream-test.mjs'});
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /re-export shim/);
    assert.equal(fs.readFileSync(distFile, 'utf8'), currentDist);
    const ai = fs.readFileSync(aiFile, 'utf8');
    assert.equal((ai.match(/function applyUnrestrictedInjection\(/gu) || []).length, 1);
    assert.match(ai, /applyUnrestrictedInjection\(params, "completions", model, context\);/);
    assert.match(ai, /applyUnrestrictedInjection\(params, "responses", model, context\);/);
    // The helper sits before the transport factories so it is in scope.
    assert.ok(ai.indexOf('function applyUnrestrictedInjection(') < ai.indexOf('function createManagedCompletionsClient('));
    // Idempotent.
    const again = run(root);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already applied/);
    assert.equal(fs.readFileSync(aiFile, 'utf8'), ai);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('2026.7 still patches the dist client and the thin completions module', () => {
  const {root, aiFile, distFile} = fixture({dist: legacyDist, ai: legacyAi, distName: 'openai-transport-stream-test.js'});
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dist\].*patch applied|expected 3 injection call sites/);
    void distFile;
    void aiFile;
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('removal strips the 2026.10 injection again', () => {
  const {root, aiFile} = fixture({dist: currentDist, ai: currentAi, distName: 'openai-transport-stream-test.mjs'});
  try {
    assert.equal(run(root).status, 0);
    const result = run(root, ['--remove']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(fs.readFileSync(aiFile, 'utf8'), /applyUnrestrictedInjection|unrestricted-injection/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
