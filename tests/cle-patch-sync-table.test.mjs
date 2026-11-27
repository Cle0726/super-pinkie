// L82：tools/cle/patch-sync-table.mjs 的单测（含反例）。全部用临时目录里的夹具，不联网、不调真 gh。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  DEFAULT_REPO_ROOT,
  NOT_IN_CORE,
  STATUS,
  buildSyncTable,
  extractManifestFromTarball,
  fetchManifestFromRelease,
  listLocalPatches,
  parsePinkiePatches,
  renderMarkdown,
  runCli,
} from '../tools/cle/patch-sync-table.mjs';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const PATCHES = {
  'apply-alpha.mjs': 'console.log("alpha");\n',
  'apply-beta.mjs': 'console.log("beta v2");\n',
  'apply-gamma.mjs': 'console.log("gamma");\n',
  'apply-computer-v2.mjs': 'console.log("computer");\n',
  'reapply-unrestricted-patch.mjs': 'console.log("unrestricted");\n',
  // 这些都不是补丁，不该出现在表里。
  'apply-all.mjs': 'console.log("trial harness");\n',
  'lib-apply-dist.mjs': 'export {};\n',
  'trial-one.mjs': 'console.log("trial");\n',
};

function makeRepo() {
  const root = tmp('l82-repo-');
  fs.mkdirSync(path.join(root, 'patch/nested'), { recursive: true });
  for (const [name, body] of Object.entries(PATCHES)) fs.writeFileSync(path.join(root, 'patch', name), body);
  fs.writeFileSync(path.join(root, 'patch/nested/apply-deep.mjs'), 'nested, not top level\n');
  fs.writeFileSync(path.join(root, 'core-manifest.json'), JSON.stringify({
    default: 'cle',
    cle: { version: '9.9.9-c.9', tag: 'cle-core-v9.9.9-c.9', repo: 'Example/cle-core' },
  }));
  return root;
}

// alpha 对上；beta 是旧版 sha（碧琪后来又改过）；gamma 没登记；orphan 只在内核清单里。
function makeManifest(extra = []) {
  return JSON.stringify({
    schema: 1,
    patches: [
      { name: 'apply-alpha', file: 'patch/apply-alpha.mjs', sha256: sha(PATCHES['apply-alpha.mjs']) },
      { name: 'apply-beta', file: 'patch/apply-beta.mjs', sha256: sha('console.log("beta v1");\n') },
      { name: 'apply-orphan', file: 'patch/apply-orphan.mjs', sha256: sha('gone') },
      ...extra,
    ],
  });
}

function capture() {
  const sink = { text: '', write(chunk) { sink.text += chunk; return true; } };
  return sink;
}

// 最小 ustar 打包器，用来做内核 .tgz 夹具。
function tarEntry(name, body, type = '0') {
  const data = Buffer.from(body);
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, pad]);
}

function writeTgz(file, entries) {
  const parts = entries.map(([name, body, type]) => tarEntry(name, body, type));
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([...parts, Buffer.alloc(1024, 0)])));
  return file;
}

test('只列 patch/ 顶层 apply-*.mjs 与 reapply-*.mjs，不含 apply-all、lib、trial 和子目录', () => {
  const root = makeRepo();
  const names = listLocalPatches(root).map((p) => p.name);
  assert.deepEqual(names, ['apply-alpha', 'apply-beta', 'apply-computer-v2', 'apply-gamma', 'reapply-unrestricted-patch']);
  const alpha = listLocalPatches(root).find((p) => p.name === 'apply-alpha');
  assert.equal(alpha.file, 'patch/apply-alpha.mjs');
  assert.equal(alpha.sha256, sha(PATCHES['apply-alpha.mjs']));
});

test('三类分得对：已搬 / 待同步（未登记、sha 不符）/ 不进内核（#21 #34），清单独有的单列', () => {
  const root = makeRepo();
  const table = buildSyncTable(listLocalPatches(root), parsePinkiePatches(makeManifest()));
  const status = Object.fromEntries(table.rows.map((row) => [row.name, row.status]));
  assert.deepEqual(status, {
    'apply-alpha': STATUS.MIGRATED,
    'apply-beta': STATUS.PENDING,
    'apply-gamma': STATUS.PENDING,
    'apply-computer-v2': STATUS.NOT_IN_CORE,
    'reapply-unrestricted-patch': STATUS.NOT_IN_CORE,
  });
  assert.deepEqual(table.counts, { [STATUS.MIGRATED]: 1, [STATUS.PENDING]: 2, [STATUS.NOT_IN_CORE]: 2 });
  assert.equal(table.total, 5);
  assert.match(table.rows.find((r) => r.name === 'apply-beta').reason, /sha256 对不上/);
  assert.match(table.rows.find((r) => r.name === 'apply-gamma').reason, /没有这一条/);
  assert.deepEqual(table.orphans.map((o) => o.name), ['apply-orphan']);
  // 表按 已搬 → 待同步 → 不进内核 排。
  assert.deepEqual(table.rows.map((r) => r.status), [STATUS.MIGRATED, STATUS.PENDING, STATUS.PENDING, STATUS.NOT_IN_CORE, STATUS.NOT_IN_CORE]);
});

test('反例（K3-2）：在本地改已搬补丁里的一个字，它就从「已搬」变成「待同步」', () => {
  const root = makeRepo();
  const recorded = parsePinkiePatches(makeManifest());
  const before = buildSyncTable(listLocalPatches(root), recorded).rows.find((r) => r.name === 'apply-alpha');
  assert.equal(before.status, STATUS.MIGRATED);
  fs.writeFileSync(path.join(root, 'patch/apply-alpha.mjs'), PATCHES['apply-alpha.mjs'].replace('alpha', 'alphA'));
  const after = buildSyncTable(listLocalPatches(root), recorded).rows.find((r) => r.name === 'apply-alpha');
  assert.equal(after.status, STATUS.PENDING);
  assert.notEqual(after.localSha256, after.coreSha256);
});

test('反例：只差一个换行符（CRLF）也算 sha 不符，不做文本归一化', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'patch/apply-alpha.mjs'), PATCHES['apply-alpha.mjs'].replace('\n', '\r\n'));
  const table = buildSyncTable(listLocalPatches(root), parsePinkiePatches(makeManifest()));
  assert.equal(table.rows.find((r) => r.name === 'apply-alpha').status, STATUS.PENDING);
});

test('#21 #34 即使内核清单登记了也仍归「不进内核」，并提示去核对', () => {
  const root = makeRepo();
  const extra = [{ name: 'apply-computer-v2', file: 'patch/apply-computer-v2.mjs', sha256: sha(PATCHES['apply-computer-v2.mjs']) }];
  const row = buildSyncTable(listLocalPatches(root), parsePinkiePatches(makeManifest(extra))).rows.find((r) => r.name === 'apply-computer-v2');
  assert.equal(row.status, STATUS.NOT_IN_CORE);
  assert.match(row.reason, /NOT_IN_CORE/);
});

test('清单格式不对就报错，不猜', () => {
  const good = { name: 'apply-alpha', file: 'patch/apply-alpha.mjs', sha256: 'a'.repeat(64) };
  const cases = [
    ['not json', /不是合法 JSON/],
    [JSON.stringify([]), /顶层必须是对象/],
    [JSON.stringify({ schema: 2, patches: [] }), /schema 应为 1/],
    [JSON.stringify({ schema: 1 }), /缺少 patches/],
    [JSON.stringify({ schema: 1, patches: [{ ...good, name: '' }] }), /缺少 name/],
    [JSON.stringify({ schema: 1, patches: [{ ...good, sha256: 'a'.repeat(63) }] }), /64 位十六进制/],
    [JSON.stringify({ schema: 1, patches: [{ ...good, file: 'patch/apply-beta.mjs' }] }), /对不上/],
    [JSON.stringify({ schema: 1, patches: [good, good] }), /登记了两次/],
  ];
  for (const [text, pattern] of cases) assert.throws(() => parsePinkiePatches(text), pattern, text);
  // 大写 sha256 按小写比。
  const parsed = parsePinkiePatches(JSON.stringify({ schema: 1, patches: [{ ...good, sha256: 'A'.repeat(64) }] }));
  assert.equal(parsed.get('apply-alpha').sha256, 'a'.repeat(64));
});

test('从内核 .tgz 里读 package/pinkie-patches.json（含 pax 长路径），没有就返回 null', () => {
  const dir = tmp('l82-tgz-');
  const withManifest = writeTgz(path.join(dir, 'with.tgz'), [
    ['package/package.json', '{"name":"openclaw"}'],
    ['package/pinkie-patches.json', makeManifest()],
  ]);
  assert.equal(extractManifestFromTarball(withManifest), makeManifest());
  const paxManifest = writeTgz(path.join(dir, 'pax.tgz'), [
    ['PaxHeader/x', '36 path=package/pinkie-patches.json\n', 'x'],
    ['package/truncated-name', makeManifest()],
  ]);
  assert.equal(extractManifestFromTarball(paxManifest), makeManifest());
  const without = writeTgz(path.join(dir, 'without.tgz'), [
    ['package/package.json', '{}'],
    ['package/dist/pinkie-patches.json', 'nested copy must not count'],
  ]);
  assert.equal(extractManifestFromTarball(without), null);
});

test('CLI：--manifest 出 Markdown 三类表；--fail-on-pending 有待同步时退出 1', () => {
  const root = makeRepo();
  const file = path.join(tmp('l82-cli-'), 'pinkie-patches.json');
  fs.writeFileSync(file, makeManifest());
  const out = capture();
  assert.equal(runCli(['--manifest', file, '--repo-root', root], { stdout: out, stderr: capture() }), 0);
  assert.match(out.text, /共 5 个：已搬 1 · 待同步 2 · 不进内核 2/);
  assert.match(out.text, /### 已搬（1）/);
  assert.match(out.text, /### 待同步（2）/);
  assert.match(out.text, /### 不进内核（2）/);
  assert.match(out.text, /内核清单有、碧琪 patch\/ 里没有（1）/);
  assert.equal(runCli(['--manifest', file, '--repo-root', root, '--fail-on-pending'], { stdout: capture(), stderr: capture() }), 1);
});

test('CLI：全部对上时 --fail-on-pending 退出 0；--json 可解析', () => {
  const root = makeRepo();
  const all = ['apply-alpha', 'apply-beta', 'apply-gamma'].map((name) => ({ name, file: `patch/${name}.mjs`, sha256: sha(PATCHES[`${name}.mjs`]) }));
  const file = path.join(tmp('l82-cli-'), 'pinkie-patches.json');
  fs.writeFileSync(file, JSON.stringify({ schema: 1, patches: all }));
  const out = capture();
  assert.equal(runCli(['--manifest', file, '--repo-root', root, '--json', '--fail-on-pending'], { stdout: out, stderr: capture() }), 0);
  const json = JSON.parse(out.text);
  assert.deepEqual(json.counts, { [STATUS.MIGRATED]: 3, [STATUS.PENDING]: 0, [STATUS.NOT_IN_CORE]: 2 });
  assert.deepEqual(json.orphans, []);
});

test('CLI：拿不到清单默认退出 2；--allow-missing 按空清单全部列为待同步', () => {
  const root = makeRepo();
  const tgz = writeTgz(path.join(tmp('l82-cli-'), 'old.tgz'), [['package/package.json', '{}']]);
  const err = capture();
  assert.equal(runCli(['--tarball', tgz, '--repo-root', root], { stdout: capture(), stderr: err }), 2);
  assert.match(err.text, /没拿到 pinkie-patches\.json/);
  const out = capture();
  assert.equal(runCli(['--tarball', tgz, '--repo-root', root, '--allow-missing', '--json'], { stdout: out, stderr: capture() }), 0);
  assert.deepEqual(JSON.parse(out.text).counts, { [STATUS.MIGRATED]: 0, [STATUS.PENDING]: 3, [STATUS.NOT_IN_CORE]: 2 });
});

test('CLI：参数错误退出 2（无来源、两个来源、未知参数、缺参数值）', () => {
  const root = makeRepo();
  for (const argv of [[], ['--manifest', 'a', '--tarball', 'b'], ['--bogus'], ['--manifest']]) {
    const err = capture();
    assert.equal(runCli([...argv, '--repo-root', root], { stdout: capture(), stderr: err }), 2, argv.join(' '));
    assert.match(err.text, /\[patch-sync-table\]/);
  }
});

// 假 gh：按 --pattern 把夹具文件写进 --dir，其余资产当作不存在。
function fakeGh(assets, calls) {
  return (cmd, args) => {
    calls.push(args);
    const asset = args[args.indexOf('--pattern') + 1];
    const dir = args[args.indexOf('--dir') + 1];
    if (!(asset in assets)) return { status: 1, stderr: `no asset ${asset}` };
    fs.copyFileSync(assets[asset], path.join(dir, asset));
    return { status: 0, stdout: '', stderr: '' };
  };
}

test('--release 默认用 core-manifest.json 的 cle.tag / cle.repo；优先取单独的清单资产', () => {
  const root = makeRepo();
  const file = path.join(tmp('l82-rel-'), 'pinkie-patches.json');
  fs.writeFileSync(file, makeManifest());
  const calls = [];
  const out = capture();
  assert.equal(runCli(['--release', '--repo-root', root], { stdout: out, stderr: capture(), run: fakeGh({ 'pinkie-patches.json': file }, calls) }), 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 5), ['release', 'download', 'cle-core-v9.9.9-c.9', '--repo', 'Example/cle-core']);
  assert.match(out.text, /Example\/cle-core@cle-core-v9\.9\.9-c\.9 资产 pinkie-patches\.json/);
});

test('--release <tag>：没有单独清单资产时退回从内核 .tgz 里读；两样都没有返回 null 并记下原因', () => {
  const dir = tmp('l82-rel-');
  const tgz = writeTgz(path.join(dir, 'k.tgz'), [['package/pinkie-patches.json', makeManifest()]]);
  const calls = [];
  const got = fetchManifestFromRelease({ tag: 'cle-core-v1-c.4', repo: 'Example/cle-core', run: fakeGh({ 'cle-core-v1-c.4.tgz': tgz }, calls) });
  assert.equal(got.text, makeManifest());
  assert.deepEqual(calls.map((a) => a[a.indexOf('--pattern') + 1]), ['pinkie-patches.json', 'cle-core-v1-c.4.tgz']);
  const none = fetchManifestFromRelease({ tag: 'cle-core-v1-c.3', repo: 'Example/cle-core', run: fakeGh({}, []) });
  assert.equal(none.text, null);
  assert.equal(none.errors.length, 2);
});

test('真仓库：#21 #34 两个「不进内核」的补丁文件确实存在（改名会让这里变红）', () => {
  const names = new Set(listLocalPatches(DEFAULT_REPO_ROOT).map((p) => p.name));
  for (const name of NOT_IN_CORE.keys()) assert.ok(names.has(name), `patch/${name}.mjs 不存在`);
  assert.ok(!names.has('apply-all'));
});

test('Markdown 渲染：空分类写（无），sha 截短到 12 位', () => {
  const table = buildSyncTable([{ name: 'apply-x', file: 'patch/apply-x.mjs', sha256: 'b'.repeat(64) }],
    new Map([['apply-x', { name: 'apply-x', sha256: 'b'.repeat(64) }]]));
  const md = renderMarkdown(table, 'fixture');
  assert.match(md, /### 待同步（0）\n\n（无）/);
  assert.match(md, new RegExp(`\`${'b'.repeat(12)}\``));
  assert.ok(!md.includes('b'.repeat(13)));
});
