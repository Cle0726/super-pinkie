import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable, Writable} from 'node:stream';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {GRADE_RULES} from '../services/mode-architecture/learning-game-exam.mjs';
import {LINE_RULES} from '../services/mode-architecture/learning-game-content.mjs';
import {registerLearningGame} from '../services/mode-architecture/learning-game.mjs';
import {findSets, setInfo, orderLines, splitParts, validRealSection, SPLIT_RULES, REAL_VERSION} from '../services/mode-architecture/learning-game-real.mjs';

function tmp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-real-')); t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; }
function touch(file, data = 'x') { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data); }

// 一个「U 盘」：两套真题 + 一份散卷（没答案，不能混进来）+ 两套模拟卷 + 「试题与解析」命名的试卷
function usb(t) {
  const base = tmp(t);
  const pack = path.join(base, '大学英语B级真题+解析+听力+2套模拟卷（更新到24年6月）');
  touch(path.join(pack, '2014年06月试题+解析+听力', '2014.06  B级真题（可复制搜索）.pdf'));
  touch(path.join(pack, '2014年06月试题+解析+听力', '2014.06  B级解析.pdf'));
  touch(path.join(pack, '2014年06月试题+解析+听力', '2014.06  B级听力音频.MP3'), Buffer.alloc(5000, 7));
  touch(path.join(pack, '2023年3月试题+解析+听力', '2023年3月B级能力考试试题与解析.pdf'));
  touch(path.join(pack, '2023年3月试题+解析+听力', '2023年3月试题解析.pdf'));
  touch(path.join(pack, '2023年3月试题+解析+听力', '2023年3月大学英语B级考试真题及详解含听力音频.mp3'), Buffer.alloc(3000, 1));
  touch(path.join(pack, '2套模拟卷', '英语B级模拟卷1.pdf'));
  touch(path.join(pack, '2套模拟卷', '英语B级模拟卷1-答案解析.pdf'));
  touch(path.join(pack, '2套模拟卷', '英语B级模拟卷1-听力音频.mp3'));
  touch(path.join(pack, '2套模拟卷', '英语B级模拟卷2.pdf'));
  touch(path.join(pack, '2套模拟卷', '英语B级模拟卷2-答案解析.pdf'));
  touch(path.join(base, '1', '2014.06  B级真题（可复制搜索）.pdf'));
  return base;
}

test('套卷识别：按文件夹配齐试卷 / 答案 / 录音；散卷不混入；「试题与解析」是试卷；模拟卷按序号配对', async t => {
  const base = usb(t);
  const sets = await findSets(base);
  assert.deepEqual(sets.map(s => s.id), ['real-2023-03', 'real-2014-06', 'mock-1', 'mock-2']);
  const s14 = sets.find(s => s.id === 'real-2014-06');
  assert.match(s14.paper, /2014年06月.*真题/);
  assert.match(s14.answer, /解析\.pdf$/);
  assert.match(s14.audio, /\.MP3$/);
  const s23 = sets.find(s => s.id === 'real-2023-03');
  assert.match(s23.paper, /试题与解析\.pdf$/);
  assert.match(s23.answer, /3月试题解析\.pdf$/);
  assert.equal(sets.find(s => s.id === 'mock-2').audio, null);
  assert.equal(setInfo('2套模拟卷', '英语B级模拟卷2.pdf').title, '官方模拟卷 2');
});

test('认字排版：试卷同一行的两个选项并成一行；解析两栏先左后右，通栏标题切段', () => {
  const paper = [[0.1, 0.20, 0.4, '8. A) Find a new apartment.'], [0.55, 0.201, 0.8, 'B) Give up his plan.'], [0.1, 0.22, 0.4, 'C) Get a new job.'], [0.55, 0.221, 0.8, 'D) Put forward.']];
  assert.equal(orderLines(paper), '8. A) Find a new apartment.    B) Give up his plan.\nC) Get a new job.    D) Put forward.');
  const ans = [[0.1, 0.1, 0.9, 'Part I Listening Comprehension'], [0.1, 0.2, 0.46, 'L1'], [0.1, 0.22, 0.46, 'L2'], [0.52, 0.2, 0.9, 'R1'], [0.52, 0.22, 0.9, 'R2'], [0.1, 0.5, 0.9, 'Part II Vocabulary'], [0.1, 0.6, 0.46, 'L3'], [0.52, 0.6, 0.9, 'R3'], [0.1, 0.62, 0.46, 'L4'], [0.52, 0.62, 0.9, 'R4']];
  assert.deepEqual(orderLines(ans, {columns: true}).split('\n'), ['Part I Listening Comprehension', 'L1', 'L2', 'R1', 'R2', 'Part II Vocabulary', 'L3', 'L4', 'R3', 'R4']);
});

test('按部分切：罗马数字认错（Part H / Part Il）也能切开', () => {
  const t = 'Part l Listening x\nPart H Vocabulary & Structure y\nPart Il Reading Comprehension z\nPart IV Translation w\nPart V Writing v';
  const p = splitParts(t);
  assert.match(p.listening, /^Part l Listening/);
  assert.match(p.vocab, /^Part H Vocabulary/);
  assert.match(p.reading, /^Part Il Reading/);
  assert.ok(!p.reading.includes('Translation'));
  assert.match(p.writing, /Writing v$/);
});

test('拆卷校验：题型不对整部分不收；选项答案越界的题去掉并标出；分值按官方部分满分折算；翻译选择三选一', () => {
  assert.equal(validRealSection('vocab', {parts: [{id: 'A', kind: 'writing', items: []}]}), null);
  const v = validRealSection('vocab', {parts: [
    {id: 'A', kind: 'choice', each: 1, items: [{no: 21, stem: 'He ____ here.', options: ['is', 'are', 'am', 'be'], answer: 0}, {no: 22, stem: 'x ____', options: ['a', 'b', 'c', 'd'], answer: 7}]},
    {id: 'B', kind: 'word-form', each: 1, items: [{no: 31, stem: 'She ____ yesterday.', base: 'go', answer: ['went']}]},
  ]});
  assert.equal(v.parts[0].items.length, 1);
  assert.equal(v.parts[0].items[0].no, 21);
  assert.ok(v.flags.some(f => /没通过校验/.test(f)));
  // 每题分值按官方部分满分折算：词汇 15 分
  assert.equal(v.parts.reduce((n, p) => n + p.each * p.items.length, 0), 15);
  // 翻译选择只有三个选项照收；翻译选择 2 分一题，段落拿剩下的
  const tr = validRealSection('translation', {parts: [
    {id: 'A', kind: 'translate-choice', each: 1, items: Array.from({length: 4}, (_, i) => ({no: 63 + i, stem: `S${i}`, options: ['甲', '乙', '丙'], answer: 1}))},
    {id: 'B', kind: 'translate-passage', each: 8, items: [{no: 67, stem: 'Text', reference: '译文'}]},
  ]});
  assert.deepEqual(tr.parts.map(p => p.each), [2, 12]);
  assert.equal(tr.parts[0].items[0].options.length, 3);
  // 配对题：答案字母必须是材料里有的候选
  const tm = validRealSection('reading', {parts: [{id: 'Task 4', kind: 'term-match', each: 1, material: 'A — Exit\nB — Entrance', items: [{no: 46, stem: '出口', answer: 'A'}, {no: 47, stem: '入口', answer: 'K'}]}]});
  assert.equal(tm.parts[0].items.length, 1);
});

// 一套完整真题：每部分按官方结构给出（总分 100），听力 25 题 + 词汇 20 + 阅读 + 翻译 + 写作
const OFFICIAL = {
  listening: {parts: [
    {id: 'A', kind: 'listen-response', each: 0.5, note: '听问句选应答', items: Array.from({length: 7}, (_, i) => ({no: i + 1, options: ['a', 'b', 'RIGHT', 'd'], answer: 2, script: `SCRIPT Q${i}`}))},
    {id: 'B', kind: 'listen-dialogue', each: 0.5, note: '短对话', items: Array.from({length: 7}, (_, i) => ({no: i + 8, options: ['a', 'b', 'RIGHT', 'd'], answer: 2, script: 'W: hi M: SCRIPT'}))},
    {id: 'C', kind: 'listen-conversation', each: 0.5, note: '长对话', material: 'SECRET TRANSCRIPT', items: Array.from({length: 5}, (_, i) => ({no: i + 15, options: ['a', 'b', 'RIGHT', 'd'], answer: 2, script: 'Q?'}))},
    {id: 'D', kind: 'listen-dictation', each: 1.1, note: '听写', material: 'Looking for an apartment ___(20)___ is hard ___(21)___ …', items: Array.from({length: 5}, (_, i) => ({no: i + 20, stem: `blank ${i}`, answer: [`word${i}`]}))},
  ]},
  vocab: {parts: [
    {id: 'A', kind: 'choice', each: 0.5, items: Array.from({length: 10}, (_, i) => ({no: i + 25, stem: `S${i} ____`, options: ['a', 'b', 'RIGHT', 'd'], answer: 2, why: 'WHY'}))},
    {id: 'B', kind: 'word-form', each: 1, items: Array.from({length: 10}, (_, i) => ({no: i + 35, stem: `W${i} ____`, base: 'go', answer: [`form${i}`]}))},
  ]},
  reading: {parts: [
    {id: 'Task 1', kind: 'passage-choice', each: 2, material: 'Passage one', items: Array.from({length: 5}, (_, i) => ({no: i + 45, stem: `P${i}`, options: ['a', 'b', 'RIGHT', 'd'], answer: 2}))},
    {id: 'Task 2', kind: 'passage-choice', each: 2, material: 'Passage two', items: Array.from({length: 5}, (_, i) => ({no: i + 50, stem: `P${i}`, options: ['a', 'b', 'RIGHT', 'd'], answer: 2}))},
    {id: 'Task 3', kind: 'passage-short', each: 1, material: 'Passage three', items: Array.from({length: 5}, (_, i) => ({no: i + 55, stem: `Q${i}`, answer: [`short${i}`]}))},
    {id: 'Task 4', kind: 'term-match', each: 1, material: 'A — Exit\nB — Entrance\nC — Lift\nD — Stairs\nE — Toilet', items: Array.from({length: 5}, (_, i) => ({no: i + 60, stem: `中文${i}`, answer: 'ABCDE'[i]}))},
    {id: 'Task 5', kind: 'practical-fill', each: 1, material: 'Notice', items: Array.from({length: 5}, (_, i) => ({no: i + 65, stem: `F${i}`, answer: [`fill${i}`]}))},
  ]},
  translation: {parts: [
    {id: 'A', kind: 'translate-choice', each: 2, items: Array.from({length: 4}, (_, i) => ({no: i + 70, stem: `T${i}`, options: ['a', 'b', 'RIGHT', 'd'], answer: 2}))},
    {id: 'B', kind: 'translate-passage', each: 12, items: [{no: 74, stem: 'Translate this.', reference: 'REFERENCE 译文', rubric: 'RUBRIC'}]},
  ]},
  writing: {parts: [{id: 'A', kind: 'writing', each: 15, items: [{no: 75, stem: '写一封感谢信', reference: 'REFERENCE essay', rubric: 'RUBRIC'}]}]},
};
function splitModel({calls = []} = {}) {
  return async (rules, payload) => {
    if (rules === SPLIT_RULES) { calls.push(payload.section); return {value: {...OFFICIAL[payload.section], flags: []}}; }
    if (rules === GRADE_RULES) return {value: {score: payload.max, reason: '要点齐全'}};
    if (rules === LINE_RULES) return {value: {text: '真题满分！'}};
    return {unavailable: true};
  };
}
function realGame(t) {
  const fx = gameFixture(t);
  const base = usb(t);
  const data = tmp(t);
  const exam = fx.game.modules.exam;
  exam.real.dataRoot = data;
  // 认字在测试里不跑 pdftoppm / Vision：直接给文字
  exam.real.pdfText = async (b, rel) => ({rel, method: 'test', pages: [/解析/.test(rel) ? 'Part I Listening answers\nPart II Vocabulary answers' : 'Part I Listening\nPart II Vocabulary']});
  const prev = process.env.PINKIE_PRETCO_USB;
  process.env.PINKIE_PRETCO_USB = base;
  t.after(() => { if (prev == null) delete process.env.PINKIE_PRETCO_USB; else process.env.PINKIE_PRETCO_USB = prev; });
  return {...fx, exam, base, data};
}

test('插盘备卷：拷听力、拆卷上架；大厅分「历年真题」/「仿真卷」两栏；再跑一轮不重复拆', async t => {
  const {game, exam, data} = realGame(t);
  const calls = [];
  game.requestModel = splitModel({calls});
  const st = await exam.real.sync();
  assert.equal(st.failed.length, 0, JSON.stringify(st.failed));
  assert.equal(st.ready, 4);
  assert.equal(calls.length, 4 * 5, '每套 5 个部分各拆一次');
  assert.equal(fs.statSync(path.join(data, 'pretco-b-audio', '2014年06月试题+解析+听力', '2014.06  B级听力音频.MP3')).size, 5000);
  const list = exam.papers({});
  assert.deepEqual(list.real.map(p => p.paperId), ['real-2023-03', 'real-2014-06', 'mock-1', 'mock-2']);
  assert.equal(list.real[1].audio, true);
  assert.equal(list.real[3].audio, false);
  assert.ok(list.papers.every(p => !p.paperId.startsWith('real-')), '真题不进仿真卷那栏');
  assert.equal(list.realStatus.found, 4);
  assert.equal(list.realStatus.ready, 4);
  const full = JSON.parse(fs.readFileSync(path.join(game.root, 'papers', 'real-2014-06.json'), 'utf8'));
  assert.equal(full.version, REAL_VERSION);
  assert.equal(full.check.total, 100);
  await exam.real.sync();
  assert.equal(calls.length, 20, '已备好的不再拆');
});

test('真题开考：公开卷不带答案 / 录音原文 / 解析；听写短文照常印；原录音 key 只对这份卷有效', async t => {
  const {game, exam} = realGame(t);
  game.requestModel = splitModel();
  await exam.real.sync();
  const s = exam.start({paperId: 'real-2014-06', requestId: 'r1'});
  const json = JSON.stringify(s);
  for (const bad of ['SCRIPT', 'SECRET TRANSCRIPT', 'REFERENCE', 'RUBRIC', 'WHY', 'form0', 'short0', 'fill0', '"answer"']) assert.ok(!json.includes(bad), `泄题：${bad}`);
  assert.equal(s.paper.kind, 'real');
  assert.equal(s.endsAt - Date.parse('2026-11-08T04:00:00Z'), 120 * 60000, '真题按官方 120 分钟');
  const listen = s.paper.sections[0];
  assert.ok(listen.items.every(it => !it.tts), '真题听力不用 TTS');
  assert.equal(listen.items[0].no, 1);
  assert.match(listen.items.find(it => it.kind === 'listen-dictation').material, /___\(20\)___/);
  assert.equal(listen.items.find(it => it.kind === 'listen-conversation').material || '', '');
  assert.match(s.audio.url, /^\/pinkie-exam-audio\/real-2014-06\?key=[a-f0-9]{64}$/);
  const key = new URL(s.audio.url, 'http://x').searchParams.get('key');
  assert.ok(exam.audioFile('real-2014-06', key).endsWith('.MP3'));
  assert.equal(exam.audioFile('real-2023-03', key), null, '别的卷子用不了这个 key');
  assert.equal(exam.audioFile('real-2014-06', 'f'.repeat(64)), null);
  assert.equal(exam.start({paperId: 'mock-2', requestId: 'r2'}).audio, null, '没有录音的卷不发 key');
});

test('真题判分：按官方答案；全对 100 分；错题按原卷题号进错题怪', async t => {
  const {game, exam} = realGame(t);
  game.requestModel = splitModel();
  await exam.real.sync();
  const s = exam.start({paperId: 'real-2014-06', requestId: 'g1'});
  const answers = {};
  for (const sec of s.paper.sections) for (const it of sec.items) {
    const n = Number(it.id.split('-').pop()) - 1;
    if (it.options) answers[it.id] = 2;
    else if (it.kind === 'term-match') answers[it.id] = 'ABCDE'[n];
    else if (['translate-passage', 'writing'].includes(it.kind)) answers[it.id] = 'A real answer with several words in it.';
    else answers[it.id] = {'listen-dictation': `word${n}`, 'word-form': `Form${n}`, 'passage-short': `short${n}`, 'practical-fill': `fill${n}`}[it.kind];
  }
  exam.save({attemptId: s.attemptId, answers});
  exam.submit({attemptId: s.attemptId, requestId: 'g2'});
  await exam.grading.get(s.attemptId);
  const r = exam.result({attemptId: s.attemptId});
  assert.equal(r.status, 'done');
  assert.equal(r.score, 100);
  // 第二次：词汇 A 全错 → 扣 5 分，错题怪出现
  const s2 = exam.start({paperId: 'real-2023-03', requestId: 'g3'});
  const a2 = {};
  for (const sec of s2.paper.sections) for (const it of sec.items) if (it.options) a2[it.id] = it.id.startsWith('vocab-A') ? 0 : 2;
  exam.save({attemptId: s2.attemptId, answers: a2});
  exam.submit({attemptId: s2.attemptId, requestId: 'g4'});
  await exam.grading.get(s2.attemptId);
  const r2 = exam.result({attemptId: s2.attemptId});
  assert.equal(r2.sections.find(x => x.id === 'vocab').score, 0);
  assert.ok(r2.monstersSpawned.length > 0);
  assert.equal(exam.papers({}).real.find(p => p.paperId === 'real-2014-06').best, 100);
});

test('原录音 HTTP 路由：凭 key 给文件，支持 Range；key 不对 404', async t => {
  const {game, exam, store} = realGame(t);
  game.requestModel = splitModel();
  await exam.real.sync();
  const routes = [];
  const api = {registerGatewayMethod() {}, registerHttpRoute: r => routes.push(r), logger: {}};
  store.assertLearningSession = () => {};
  const g2 = registerLearningGame(api, store, {now: () => Date.parse('2026-11-08T04:00:00Z'), autoReal: false});
  const ex2 = g2.modules.exam;
  ex2.real.dataRoot = exam.real.dataRoot;
  const route = routes.find(r => r.path === '/pinkie-exam-audio/');
  assert.ok(route);
  const s = ex2.start({paperId: 'real-2014-06', requestId: 'h1'});
  const hit = (url, headers = {}) => new Promise(resolve => {
    const chunks = [];
    const res = new Writable({write(c, e, cb) { chunks.push(c); cb(); }});
    res.headers = {}; res.statusCode = 0;
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    const end = res.end.bind(res);
    res.end = (...a) => { end(...a); };
    res.on('finish', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    route.handler(Object.assign(Readable.from([]), {url, method: 'GET', headers}), res);
  });
  const full = await hit(s.audio.url);
  assert.equal(full.status, 200);
  assert.equal(full.body.length, 5000);
  assert.equal(full.headers['content-type'], 'audio/mpeg');
  const part = await hit(s.audio.url, {range: 'bytes=100-199'});
  assert.equal(part.status, 206);
  assert.equal(part.body.length, 100);
  assert.equal(part.headers['content-range'], 'bytes 100-199/5000');
  assert.equal((await hit('/pinkie-exam-audio/real-2014-06?key=' + 'a'.repeat(64))).status, 404);
});
