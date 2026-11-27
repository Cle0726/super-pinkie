// services/messaging-connect/publisher-patch.mjs 的单测：飞书存活补丁与 QQ 配对适配器合并成一份
// 「校验原包 → 写前全检 → 备份 + 临时文件 → 失败回滚」流程后，两边的报错文案和写盘行为要与合并前逐字一致。
// 不碰真实发布包和 ~/.openclaw：全部在临时目录里用合成文件跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyPublisherPatch, planPublisherPatch, sha256} from '../services/messaging-connect/publisher-patch.mjs';
import {QQ_PATCH} from '../services/messaging-connect/apply-qq-adapter.mjs';
import {FEISHU_PATCH} from '../services/messaging-connect/apply-feishu-liveness.mjs';

const REL = 'dist/a.js';
const REL2 = 'dist/b.js';

function tempRoot(t, spec, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-patch-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: spec.name, version: spec.version}));
  for (const [relative, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive: true});
    fs.writeFileSync(path.join(root, relative), source, {mode: 0o640});
    fs.chmodSync(path.join(root, relative), 0o640);
  }
  return root;
}

// 用真实 spec 的文案标签，换上合成文件的哈希与改写函数。
function synthetic(base, files, transform = source => `${source}// patched\n`) {
  const baselines = {}, patched = {}, transforms = {};
  for (const [relative, source] of Object.entries(files)) {
    baselines[relative] = sha256(source);
    patched[relative] = sha256(transform(source));
    transforms[relative] = transform;
  }
  return {...base, baselines, patched, transforms};
}

const listing = root => fs.readdirSync(path.join(root, 'dist')).sort();

// 合并前两个文件里各自写死的报错文案。
const LEGACY = {
  QQ: {
    spec: QQ_PATCH,
    requirement: 'QQ adapter requires verified @openclaw/qqbot 2026.7.1',
    regular: rel => `QQ publisher target must be a regular file: ${rel}`,
    changed: rel => `QQ publisher file changed: ${rel}; nothing was written`,
    mismatch: rel => `QQ adapter patch hash mismatch: ${rel}; nothing was written`,
    backup: rel => `QQ adapter backup changed: ${rel}; nothing was written`,
    temporary: rel => `QQ adapter temporary file already exists: ${rel}; nothing was written`,
    preflight: 'QQ publisher changed during adapter preflight; nothing was written',
  },
  Feishu: {
    spec: FEISHU_PATCH,
    requirement: 'Feishu liveness patch requires verified @openclaw/feishu 2026.7.1',
    regular: rel => `Feishu publisher target must be a regular file: ${rel}`,
    changed: rel => `Feishu publisher file changed: ${rel}; nothing was written`,
    mismatch: rel => `Feishu liveness patch hash mismatch: ${rel}; nothing was written`,
    backup: rel => `Feishu liveness backup changed: ${rel}; nothing was written`,
    temporary: rel => `Feishu liveness temporary file already exists: ${rel}; nothing was written`,
    preflight: 'Feishu publisher changed during liveness preflight; nothing was written',
  },
};

for (const [label, legacy] of Object.entries(LEGACY)) {
  test(`${label}：每条拒绝路径的报错文案与合并前逐字相同，且一个字节都不写`, t => {
    const files = {[REL]: 'original\n'};
    const spec = synthetic(legacy.spec, files);

    const wrongVersion = tempRoot(t, {...spec, version: '0.0.0'}, files);
    assert.throws(() => planPublisherPatch(wrongVersion, spec), {message: legacy.requirement});
    assert.throws(() => planPublisherPatch(tempRoot(t, {...spec, name: 'other'}, files), spec), {message: legacy.requirement});

    const folder = tempRoot(t, spec, {});
    fs.mkdirSync(path.join(folder, REL), {recursive: true});
    assert.throws(() => planPublisherPatch(folder, spec), {message: legacy.regular(REL)});

    const edited = tempRoot(t, spec, {[REL]: 'someone else edited this\n'});
    assert.throws(() => applyPublisherPatch(edited, spec), {message: legacy.changed(REL)});
    assert.equal(fs.readFileSync(path.join(edited, REL), 'utf8'), 'someone else edited this\n');

    const mismatch = tempRoot(t, spec, files);
    assert.throws(() => applyPublisherPatch(mismatch, {...spec, patched: {[REL]: '0'.repeat(64)}}), {message: legacy.mismatch(REL)});
    assert.deepEqual(listing(mismatch), ['a.js']);

    const badBackup = tempRoot(t, spec, files);
    fs.writeFileSync(path.join(badBackup, `${REL}.pinkie-original`), 'not the publisher baseline\n');
    assert.throws(() => applyPublisherPatch(badBackup, spec), {message: legacy.backup(REL)});
    assert.equal(fs.readFileSync(path.join(badBackup, REL), 'utf8'), 'original\n');

    const leftover = tempRoot(t, spec, files);
    fs.writeFileSync(path.join(leftover, `${REL}.pinkie-tmp`), 'stale\n');
    assert.throws(() => applyPublisherPatch(leftover, spec), {message: legacy.temporary(REL)});
    assert.equal(fs.readFileSync(path.join(leftover, REL), 'utf8'), 'original\n');

    // 预检之后、写入之前文件被别人改了：拒绝，且不留备份或临时文件。
    const racing = tempRoot(t, spec, files);
    const racingSpec = {...spec, transforms: {[REL]: source => {
      fs.writeFileSync(path.join(racing, REL), 'changed after preflight\n');
      return spec.transforms[REL](source);
    }}};
    assert.throws(() => applyPublisherPatch(racing, racingSpec), {message: legacy.preflight});
    assert.deepEqual(listing(racing), ['a.js']);
    assert.equal(fs.readFileSync(path.join(racing, REL), 'utf8'), 'changed after preflight\n');
  });
}

test('应用成功：写入改后内容、保留原权限的原文件备份、不留临时文件，再跑一次是幂等的', t => {
  const files = {[REL]: 'first\n', [REL2]: 'second\n'};
  const spec = synthetic(QQ_PATCH, files);
  const root = tempRoot(t, spec, files);

  const plan = planPublisherPatch(root, spec);
  assert.deepEqual(plan.map(item => [item.relative, item.mode]), [[REL, 0o640], [REL2, 0o640]]);
  assert.deepEqual(listing(root), ['a.js', 'b.js'], 'plan 只读不写');

  const first = applyPublisherPatch(root, spec);
  assert.deepEqual(first, [
    {file: path.join(root, REL), changed: true, sha256: spec.patched[REL]},
    {file: path.join(root, REL2), changed: true, sha256: spec.patched[REL2]},
  ]);
  assert.deepEqual(listing(root), ['a.js', 'a.js.pinkie-original', 'b.js', 'b.js.pinkie-original']);
  assert.equal(fs.readFileSync(path.join(root, REL), 'utf8'), 'first\n// patched\n');
  assert.equal(fs.readFileSync(path.join(root, `${REL}.pinkie-original`), 'utf8'), 'first\n');
  assert.equal(fs.statSync(path.join(root, `${REL}.pinkie-original`)).mode & 0o777, 0o640);

  const second = applyPublisherPatch(root, spec);
  assert.deepEqual(second.map(item => item.changed), [false, false]);
  assert.deepEqual(second.map(item => item.sha256), [spec.patched[REL], spec.patched[REL2]]);
  assert.deepEqual(listing(root), ['a.js', 'a.js.pinkie-original', 'b.js', 'b.js.pinkie-original']);
});

test('写到一半失败：已换上的文件写回原文，删掉本次的备份和临时文件，原错误照抛', t => {
  const files = {[REL]: 'first\n', [REL2]: 'second\n'};
  const spec = synthetic(FEISHU_PATCH, files);
  const root = tempRoot(t, spec, files);
  const rename = fs.renameSync;
  let calls = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error('disk full'), {code: 'ENOSPC'});
    return rename(from, to);
  });
  assert.throws(() => applyPublisherPatch(root, spec), {message: 'disk full', code: 'ENOSPC'});
  t.mock.restoreAll();
  assert.equal(calls, 2);
  assert.deepEqual(listing(root), ['a.js', 'b.js']);
  assert.equal(fs.readFileSync(path.join(root, REL), 'utf8'), 'first\n');
  assert.equal(fs.readFileSync(path.join(root, REL2), 'utf8'), 'second\n');
});

test('已有正确的原文件备份时不重写备份，失败回滚也不删它', t => {
  const files = {[REL]: 'first\n'};
  const spec = synthetic(QQ_PATCH, files);
  const root = tempRoot(t, spec, files);
  const backup = path.join(root, `${REL}.pinkie-original`);
  fs.writeFileSync(backup, 'first\n');
  t.mock.method(fs, 'renameSync', () => { throw new Error('rename refused'); });
  assert.throws(() => applyPublisherPatch(root, spec), {message: 'rename refused'});
  t.mock.restoreAll();
  assert.deepEqual(listing(root), ['a.js', 'a.js.pinkie-original']);
  assert.equal(fs.readFileSync(backup, 'utf8'), 'first\n');
});
