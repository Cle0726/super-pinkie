import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {apply, transform} from '../patch/apply-local-unrestricted-policy.mjs';

// 2026.7 shape.
const legacy = 'function prepare(options) {\n\tconst ownerOnlyCoreToolDenylist = options?.senderIsOwner === false ? [...GATEWAY_OWNER_ONLY_CORE_TOOLS] : [];\n\treturn ownerOnlyCoreToolDenylist;\n}\n';
// 2026.10 shape (dist/agent-tools-*.mjs): reads input.senderIsOwner, keeps the
// portal/sessions/automations exceptions inline.
const current = 'function prepareSessionPortalToolAccess(input) {\n'
  + '\tconst sessionPortalTarget = input.senderIsOwner === false && !input.sandboxed ? prepareSessionPortalToolTarget(input) : void 0;\n'
  + '\tconst ownerOnlyCoreToolDenylist = input.senderIsOwner === false ? GATEWAY_OWNER_ONLY_CORE_TOOLS.filter((name) => (name !== "portal" || !sessionPortalTarget) && name !== "sessions" && (name !== "automations" || !input.hasAutomationGrant)) : [];\n'
  + '\treturn { sessionPortalTarget, ownerOnlyCoreToolDenylist };\n}\n';

function run(label, source, env) {
  const list = ['sessions', 'cron', 'gateway', 'nodes'];
  const context = vm.createContext({
    process: {env},
    GATEWAY_OWNER_ONLY_CORE_TOOLS: [...list],
    prepareSessionPortalToolTarget: () => ({ kind: 'portal' }),
  });
  const entry = label === '2026.7' ? 'prepare(input)' : 'prepareSessionPortalToolAccess(input).ownerOnlyCoreToolDenylist';
  vm.runInContext(source + `;globalThis.tools = (input) => ${entry};`, context);
  return context.tools;
}

for (const [label, source] of [['2026.7', legacy], ['2026.10', current]]) {
  test(`${label}: owner filter is dropped only when the launcher opts in`, () => {
    const patched = transform(source);
    assert.notEqual(patched, source);
    assert.match(patched, /cle-kk-local-unrestricted-policy:v1/);
    assert.equal(transform(patched), patched, 'idempotent');
    // The launcher must opt in explicitly; the default runtime keeps OpenClaw's
    // owner-only protection for every non-owner sender.
    const ownerList = label === '2026.7' ? ['sessions', 'cron', 'gateway', 'nodes'] : ['cron', 'gateway', 'nodes'];
    const strict = run(label, patched, {});
    assert.deepEqual([...strict({senderIsOwner: false})], ownerList);
    assert.deepEqual([...strict({senderIsOwner: true})], []);
    const desktop = run(label, patched, {CLE_KK_LOCAL_UNRESTRICTED: '1'});
    assert.deepEqual([...desktop({senderIsOwner: false})], [], 'desktop gateway keeps its tools');
    assert.deepEqual([...desktop({senderIsOwner: true})], []);
  });
}

test('the portal/sessions/automations exceptions survive the 2026.10 rewrite', () => {
  const patched = transform(current);
  assert.match(patched, /name !== "portal"/);
  assert.match(patched, /name !== "sessions"/);
  assert.match(patched, /name !== "automations"/);
  assert.doesNotMatch(patched, /const ownerOnlyCoreToolDenylist = input\.senderIsOwner === false \?/);
});

test('applies to the single 2026.10 .mjs agent-tools chunk and refuses ambiguity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-local-unrestricted-'));
  try {
    const dist = path.join(root, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'agent-tools-TEST.mjs'), current);
    fs.writeFileSync(path.join(dist, 'agent-tools.before-tool-call-TEST.mjs'), 'export {};');
    const env = {OPENCLAW_ROOT: root, PINKIE_STATE_ROOT: path.join(root, 'state')};
    const applyWithEnv = () => {
      const saved = {...process.env};
      Object.assign(process.env, env);
      try {
        return apply(root);
      } finally {
        for (const key of Object.keys(env)) delete process.env[key];
        Object.assign(process.env, saved);
      }
    };
    assert.equal(applyWithEnv().changed, true);
    assert.match(fs.readFileSync(path.join(dist, 'agent-tools-TEST.mjs'), 'utf8'), /CLE_KK_LOCAL_UNRESTRICTED/);
    assert.equal(fs.readFileSync(path.join(dist, 'agent-tools.before-tool-call-TEST.mjs'), 'utf8'), 'export {};');
    assert.equal(applyWithEnv().changed, false, 'idempotent');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
