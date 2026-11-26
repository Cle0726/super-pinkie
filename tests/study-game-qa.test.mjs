// tools/study-game/{game-qa,review-qa,flow-qa}.mjs 纯逻辑单测：造数函数（seed / seedMonsters / seedPaper / seedBank）、
// 等待助手（deskReady / deskLayout）与 flow-qa 的导入契约。全部用假 service / 假 page，不起 harness、不起浏览器、不联网、不碰 18789。
// 三个脚本在导入时会按 --out= 建输出目录，所以先把 --out= 指到临时目录再动态导入，免得在仓库外建 briefs/ 目录。
// flow-qa.mjs 没有导出，导入即开跑整套 WebKit 流程，这里只做静态的导入契约检查，不导入它。
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'study-game-qa-test-'));
const savedArgv = [...process.argv];
const savedHome = process.env.HOME;
process.argv.push(`--out=${path.join(scratch, 'out')}`);
const gameQa = await import('../tools/study-game/game-qa.mjs');
const reviewQa = await import('../tools/study-game/review-qa.mjs');
const {PRETCO_B_FORMAT} = await import('../services/mode-architecture/learning-game-content.mjs');
process.argv.splice(0, process.argv.length, ...savedArgv);
after(() => {
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  fs.rmSync(scratch, {recursive: true, force: true});
});
const {MONSTER_SEEDS, deskReady, seed, seedBank, seedMonsters, seedPaper} = gameQa;
const {deskLayout} = reviewQa;
const repo = fileURLToPath(new URL('../', import.meta.url));

// 假的游戏 store：mutate 直接在内存 state 上跑，grant 只记账
function fakeService(state = {}) {
  const grants = [], spawned = [], written = [];
  const game = {
    state,
    mutate: fn => fn(state),
    grant: (s, id, source, items) => grants.push({id, source, items}),
    modules: {
      monsters: {spawn: (s, seedQ) => { const m = {id: `m${spawned.length + 1}`, key: seedQ.key, level: 0, state: 'new', dueAt: null}; spawned.push(m); return m; }},
      exam: {writeFull: paper => written.push(paper), ensure: s => (s.exam ??= {papers: {}})},
    },
  };
  return {service: {store: {game}}, grants, spawned, written};
}

test('导入时的输出目录落在 --out= 指定的临时目录里，导出的等待助手可用', () => {
  assert.ok(fs.statSync(path.join(scratch, 'out')).isDirectory());
  assert.equal(typeof deskReady, 'function');
  assert.equal(typeof deskLayout, 'function');
});

test('MONSTER_SEEDS：key 唯一，四个选项各不相同，答案在选项里', () => {
  assert.equal(MONSTER_SEEDS.length, 5);
  assert.equal(new Set(MONSTER_SEEDS.map(m => m.key)).size, MONSTER_SEEDS.length);
  for (const m of MONSTER_SEEDS) {
    assert.equal(m.options.length, 4, m.key);
    assert.equal(new Set(m.options).size, 4, m.key);
    assert.ok(m.options.includes(m.answer), m.key);
    assert.ok(m.subject && m.topic && m.question, m.key);
  }
});

test('seed：默认钱包三项、形态去重追加、装备形态 xp=820、清空待播奖励', () => {
  const state = {forms: {owned: ['daily'], equipped: 'daily', xp: {}}, pending: [{x: 1}]};
  const {service, grants} = fakeService(state);
  seed(service);
  assert.equal(grants.length, 1);
  assert.match(grants[0].id, /^qa-seed-\d+$/);
  assert.deepEqual(grants[0].source, {type: 'qa', id: 'seed'});
  assert.deepEqual(grants[0].items.map(i => [i.kind, i.amount]), [['stars', 2860], ['seals', 7], ['shards', 12]]);
  assert.deepEqual(state.forms.owned, ['daily', 'learning', 'detective', 'pirate']);
  assert.equal(state.forms.equipped, 'detective');
  assert.deepEqual(state.forms.xp, {detective: 820});
  assert.deepEqual(state.pending, []);
});

test('seed：自定义数额与形态', () => {
  const state = {forms: {owned: [], equipped: '', xp: {daily: 5}}, pending: []};
  const {service, grants} = fakeService(state);
  seed(service, {stars: 9600, seals: 24, shards: 30, forms: ['pirate', 'pirate'], equipped: 'pirate'});
  assert.deepEqual(grants[0].items.map(i => i.amount), [9600, 24, 30]);
  assert.deepEqual(state.forms.owned, ['pirate']);
  assert.deepEqual(state.forms.xp, {daily: 5, pirate: 820});
});

test('seedMonsters：默认全部到期，等级按 level 数组循环，返回 spawn 出来的 id', () => {
  const {service, spawned} = fakeService();
  const before = Date.now();
  const ids = seedMonsters(service);
  assert.deepEqual(ids, ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.deepEqual(spawned.map(m => m.key), MONSTER_SEEDS.map(m => m.key));
  assert.deepEqual(spawned.map(m => m.level), [1, 2, 3, 1, 4]);
  for (const m of spawned) {
    assert.equal(m.state, 'due');
    assert.ok(m.dueAt < before && m.dueAt >= before - 1000 - 50, String(m.dueAt));
  }
});

test('seedMonsters：due=false 不改状态；level 比种子短时循环使用', () => {
  const {service, spawned} = fakeService();
  const seeds = MONSTER_SEEDS.slice(0, 3).map(m => ({...m, node: 'n1'}));
  seedMonsters(service, seeds, {due: false, level: [2, 3]});
  assert.deepEqual(spawned.map(m => [m.level, m.state, m.dueAt]), [[2, 'new', null], [3, 'new', null], [2, 'new', null]]);
});

// 跑一次 seedPaper，拿到写出的整卷和登记信息
async function paperOnce() {
  const {service, written} = fakeService();
  const paperId = await seedPaper(service);
  assert.equal(written.length, 1);
  return {paperId, paper: written[0], state: service.store.game.state};
}
const partsOf = paper => paper.sections.flatMap(sec => sec.parts.map(p => ({...p, section: sec.id})));

test('seedPaper：按 PRETCO_B_FORMAT 摆整卷，并在 store 里登记成 ready', async () => {
  const {paperId, paper, state} = await paperOnce();
  assert.match(paperId, /^paper-qa-[0-9a-z]+$/);
  assert.equal(paper.paperId, paperId);
  assert.equal(paper.exam, 'pretco-b');
  assert.deepEqual(paper.sections.map(s => [s.id, s.title, s.timeMin, s.points]), PRETCO_B_FORMAT.sections.map(s => [s.id, s.title, s.timeMin, s.points]));
  for (const [i, sec] of paper.sections.entries()) {
    const src = PRETCO_B_FORMAT.sections[i];
    assert.equal(sec.instructions, src.parts.map(p => p.note).join('；'));
    assert.deepEqual(sec.parts.map(p => [p.id, p.kind, p.note, p.each, p.items.length]), src.parts.map(p => [p.id, p.kind, p.note, p.each, p.count]));
  }
  assert.deepEqual(state.exam.papers[paperId], {paperId, exam: 'pretco-b', title: 'B 级仿真卷 · 11-08', createdAt: state.exam.papers[paperId].createdAt, status: 'ready'});
  assert.equal(typeof state.exam.papers[paperId].createdAt, 'number');
});

test('seedPaper：选择题答案下标落在选项范围内，填空答案是非空字符串数组', async () => {
  const {paper} = await paperOnce();
  for (const part of partsOf(paper)) {
    for (const [i, item] of part.items.entries()) {
      const tag = `${part.section}/${part.id}#${i}`;
      assert.ok(typeof item.stem === 'string' && item.stem.trim(), tag);
      if (Array.isArray(item.options)) {
        assert.equal(item.options.length, 4, tag);
        assert.ok(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < 4, tag);
      } else if (Array.isArray(item.answer)) {
        assert.ok(item.answer.length > 0 && item.answer.every(a => typeof a === 'string' && a.trim()), tag);
      }
    }
  }
});

test('seedPaper：配材料的题型都有材料，听写原文含每个空的标准答案，配对字母都在候选里', async () => {
  const {paper} = await paperOnce();
  const parts = partsOf(paper);
  const withMaterial = new Set(['listen-dictation', 'term-match', 'passage-choice', 'passage-short', 'practical-fill']);
  for (const p of parts) assert.equal(Boolean(p.material), withMaterial.has(p.kind), `${p.section}/${p.id}`);
  const dictation = parts.find(p => p.kind === 'listen-dictation');
  for (const item of dictation.items) assert.ok(item.answer.some(a => dictation.material.includes(a)), item.stem);
  const match = parts.find(p => p.kind === 'term-match');
  const letters = new Set([...match.material.matchAll(/^([A-J]) — /gm)].map(m => m[1]));
  assert.equal(letters.size, 10);
  for (const item of match.items) assert.ok(letters.has(item.answer), item.stem);
  for (const p of parts.filter(x => x.kind.startsWith('listen-') && x.kind !== 'listen-dictation')) {
    for (const item of p.items) assert.ok(item.tts, `${p.id} 缺 tts`);
  }
});

// 已知 bug（本 PR 不修，只钉住现状）：听力 A / B 节的答案用 i % 4 轮转生成，和题意对不上。
// - listen-response：第 1、3、4 题的标准答案分别是 "Yes, I do." / "Not at all." / "It's mine."，
//   正确应答是 "Sure, here you are." / "Nice to meet you, too." / "It's ten dollars."。
// - listen-dialogue：5 道题题干、录音完全相同，标准答案却在 0..3 之间轮转；按对话正确的只有 "He needs some help."。
// 带函数体且失败的 todo 会被 tools/release-gate/tap.mjs 记成失败，所以期望行为写成不带函数体的 test.todo。
test('seedPaper：听力 A / B 节答案按 i % 4 轮转（现状，已知 bug）', async () => {
  const {paper} = await paperOnce();
  const parts = partsOf(paper);
  const response = parts.find(p => p.kind === 'listen-response').items;
  const dialogue = parts.find(p => p.kind === 'listen-dialogue').items;
  assert.deepEqual(response.map(x => x.answer), [0, 1, 2, 3, 0]);
  assert.deepEqual(response.map(x => x.options[x.answer]), ['Yes, I do.', 'By bus.', 'Not at all.', 'It’s mine.', 'Room 302.']);
  assert.equal(new Set(dialogue.map(x => `${x.stem}|${x.tts}`)).size, 1);
  assert.deepEqual(dialogue.map(x => x.answer), [0, 1, 2, 3, 0]);
});
test.todo('seedPaper：listen-response 的标准答案应为 [1, 1, 0, 2, 0]（与问句匹配的应答）');
test.todo('seedPaper：listen-dialogue 同一段对话的 5 道题答案应一致，都是 "He needs some help."（下标 2）');

// seedBank 读 $HOME/Library/Application Support/SuperPinkie/...：用临时 HOME 摆一份假的真实数据
function fakeBankHome() {
  const home = path.join(scratch, `home-${Math.random().toString(36).slice(2)}`);
  const live = path.join(home, 'Library/Application Support/SuperPinkie/learning/game');
  fs.mkdirSync(path.join(live, 'papers'), {recursive: true});
  return {home, live};
}
function bankService(root) {
  const installed = [];
  const game = {root, modules: {
    exam: {installReal: full => installed.push(full.id), real: {audioRoot: () => path.join(root, 'audio/pretco-b')}},
    practice: {bank: {cache: 'stale'}},
  }};
  return {service: {store: {game}}, installed, game};
}

test('seedBank：只装 real-*/mock-* 卷，复制标注文件，给原录音做软链，清掉题库缓存', () => {
  const {home, live} = fakeBankHome();
  for (const [name, id] of [['real-2024-06.json', 'r1'], ['mock-1.json', 'm1'], ['draft-1.json', 'x'], ['real-2024.json.bak', 'y'], ['real-bad name.json', 'z']]) {
    fs.writeFileSync(path.join(live, 'papers', name), JSON.stringify({id}));
  }
  fs.mkdirSync(path.join(live, 'bank'));
  fs.writeFileSync(path.join(live, 'bank/pretco-b.json'), '{"tags":1}');
  const liveAudio = path.join(home, 'Library/Application Support/SuperPinkie/learning-materials/pretco-b-audio');
  fs.mkdirSync(liveAudio, {recursive: true});
  const root = path.join(scratch, `root-${Math.random().toString(36).slice(2)}`);
  const {service, installed, game} = bankService(root);
  process.env.HOME = home;
  const n = seedBank(service, {tags: undefined});
  assert.equal(n, 2);
  assert.deepEqual(installed.sort(), ['m1', 'r1']);
  assert.ok(fs.statSync(path.join(root, 'papers')).isDirectory());
  assert.equal(fs.readFileSync(path.join(root, 'bank/pretco-b.json'), 'utf8'), '{"tags":1}');
  assert.equal(fs.readlinkSync(path.join(root, 'audio/pretco-b')), liveAudio);
  assert.equal(game.modules.practice.bank.cache, null);
});

test('seedBank：显式 tags 文件优先；标注文件与录音目录都不存在时安静跳过', () => {
  const {home} = fakeBankHome();
  const tags = path.join(scratch, 'my-tags.json');
  fs.writeFileSync(tags, '{"mine":true}');
  const root = path.join(scratch, `root-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = home;
  const first = bankService(root);
  assert.equal(seedBank(first.service, {tags}), 0);
  assert.equal(fs.readFileSync(path.join(root, 'bank/pretco-b.json'), 'utf8'), '{"mine":true}');
  assert.equal(fs.existsSync(path.join(root, 'audio/pretco-b')), false);
  const root2 = path.join(scratch, `root-${Math.random().toString(36).slice(2)}`);
  const second = bankService(root2);
  assert.equal(seedBank(second.service, {tags: path.join(scratch, 'missing.json')}), 0);
  assert.equal(fs.existsSync(path.join(root2, 'bank')), false);
});

// 现状：本机没有真实学习数据（papers 目录不存在）时直接抛 ENOENT，而标注文件和录音缺失都会跳过。
// flow-qa.mjs 一开头就无条件调 seedBank，所以在没有学习数据的机器上整套流程起不来。
test('seedBank：真实数据的 papers 目录不存在时抛 ENOENT（现状）', () => {
  process.env.HOME = path.join(scratch, 'empty-home');
  const {service} = bankService(path.join(scratch, 'root-empty'));
  assert.throws(() => seedBank(service, {tags: undefined}), {code: 'ENOENT'});
});

// 假 page：记下调用顺序；waitFor / waitForFunction 的结果可以按次序指定
function fakePage({waitResults = []} = {}) {
  const calls = [];
  let waits = 0;
  return {
    calls,
    locator: selector => ({waitFor: opts => { calls.push(['locator.waitFor', selector, opts.timeout]); return Promise.resolve(); }}),
    waitForFunction: (fn, arg, opts) => { calls.push(['waitForFunction', opts.timeout]); const r = waitResults[waits++]; return r instanceof Error ? Promise.reject(r) : Promise.resolve(); },
    evaluate: (fn, arg) => { calls.push(['evaluate', arg]); return Promise.resolve(); },
  };
}

test('deskReady：等学习台挂载与全局对象，切到指定视图，忙碌等待超时被吞掉', async () => {
  const page = fakePage({waitResults: [undefined, new Error('busy timeout')]});
  await deskReady(page, 'gamehunt');
  assert.deepEqual(page.calls, [
    ['locator.waitFor', '#pinkie-study-desk', 15000],
    ['waitForFunction', 15000],
    ['evaluate', 'gamehunt'],
    ['waitForFunction', 15000],
  ]);
});

test('deskReady：view 为空时不切视图；学习台没挂上时把错误抛出来', async () => {
  const page = fakePage();
  await deskReady(page, null);
  assert.deepEqual(page.calls.map(c => c[0]), ['locator.waitFor', 'waitForFunction', 'waitForFunction']);
  const broken = fakePage({waitResults: [new Error('desk missing')]});
  await assert.rejects(deskReady(broken, 'today'), /desk missing/);
  assert.deepEqual(broken.calls.map(c => c[0]), ['locator.waitFor', 'waitForFunction']);
});

test('deskLayout：空值与 none 什么都不做，其他值交给页面切布局', async () => {
  for (const layout of [undefined, '', 'none']) {
    const page = fakePage();
    await deskLayout(page, layout);
    assert.deepEqual(page.calls, [], String(layout));
  }
  const page = fakePage();
  await deskLayout(page, 'triple-chat');
  assert.deepEqual(page.calls, [['evaluate', 'triple-chat']]);
});

// flow-qa.mjs / redo-qa.mjs / play.mjs 从 game-qa、review-qa 按名字导入；导出改名会让这些脚本在 Mac 上一启动就崩。
test('导入契约：study-game 各脚本从 game-qa / review-qa 导入的名字都真实导出', () => {
  const exportsOf = {'./game-qa.mjs': gameQa, './review-qa.mjs': reviewQa};
  const dir = path.join(repo, 'tools/study-game');
  let checked = 0;
  for (const file of ['flow-qa.mjs', 'redo-qa.mjs', 'play.mjs', 'review-qa.mjs']) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'(\.\/(?:game|review)-qa\.mjs)';$/gm)) {
      for (const name of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        assert.equal(typeof exportsOf[m[2]][name], 'function', `${file} 导入的 ${name} 不在 ${m[2]} 的导出里`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 10, `只检查到 ${checked} 个导入名`);
});
