#!/usr/bin/env node
// 碧琪上岸记 · 隔离真模型抽检（SESSION-B §B5）。只读 App 的模型配置；所有数据写在临时目录；不连 18789、不碰真实 learning/。
// 抽：考点地图 2 份、整卷 2 份（客观题逐题盲答复核）、错题怪变体 20 道、判卷 5 份（同一篇判 3 次看稳定性）、委托 7 天、台词 20 条。
// 用法：node tools/study-game/content-sample.mjs [--only=world,exam,variant,grade,quest,line] → briefs/study-desk-game/content-sample/<时间>.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LearningInteractionStore, LearningNotesOrganizer, requestLearningModel} from '../../services/mode-architecture/learning.mjs';
import {openclawConfigPath} from '../../services/mode-architecture/openclaw-paths.mjs';
import {LearningGame} from '../../services/mode-architecture/learning-game.mjs';
import {WORLD_RULES, REGIONS, validWorld} from '../../services/mode-architecture/learning-game-world.mjs';
import {GRADE_RULES} from '../../services/mode-architecture/learning-game-exam.mjs';
import {PRETCO_B_FORMAT, modelJson, blindCheck, fold} from '../../services/mode-architecture/learning-game-content.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const briefs = path.resolve(repo, '../../briefs/study-desk-game/content-sample');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = k => !only.length || only.includes(k);
fs.mkdirSync(briefs, {recursive: true});

const config = JSON.parse(fs.readFileSync(openclawConfigPath(), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-game-sample-'));
const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
const api = {config, runtime: {config: {current: () => config}}};
const organizer = new LearningNotesOrganizer(api, store);
const calls = [];
const requestModel = async (rules, payload, options) => {
  const t0 = Date.now();
  try {
    const r = await requestLearningModel(organizer, rules, payload, options);
    calls.push({rules: rules.slice(0, 24), ms: Date.now() - t0, ok: !r?.unavailable});
    return r;
  } catch (e) { calls.push({rules: rules.slice(0, 24), ms: Date.now() - t0, ok: false, error: String(e.message || e).slice(0, 120)}); throw e; }
};
let clock = Date.now();
const game = new LearningGame(store, {now: () => clock, requestModel});
const report = {at: new Date().toISOString(), model: null, sections: {}};
const log = m => console.log(new Date().toISOString().slice(11, 19), m);
const out = path.join(briefs, `${report.at.replace(/[:.]/g, '-')}.json`);
const save = () => fs.writeFileSync(out, JSON.stringify({...report, calls: summarize(calls)}, null, 1));
function summarize(list) {
  const by = {};
  for (const c of list) { const k = c.rules; (by[k] ||= {n: 0, fail: 0, ms: []}); by[k].n += 1; if (!c.ok) by[k].fail += 1; by[k].ms.push(c.ms); }
  for (const v of Object.values(by)) { v.ms.sort((a, b) => a - b); v.p50 = v.ms[Math.floor(v.ms.length / 2)]; v.max = v.ms.at(-1); delete v.ms; }
  return by;
}

try {
  const cat = organizer.catalog();
  report.model = cat.defaultRef;
  if (!cat.defaultRef) throw new Error('学习模式没有可用模型');
  log(`model ${cat.defaultRef}`);

  if (want('world')) {
    const maps = [];
    for (let i = 0; i < 2; i += 1) {
      const t0 = Date.now();
      const r = await modelJson(requestModel, WORLD_RULES, {format: PRETCO_B_FORMAT, regions: REGIONS.map(x => ({id: x.id, name: x.name})), lessonPoints: {e1: 2, e2: 5, e3: 2, e4: 3, e5: 1},
        learner: {words: ['appointment', 'deliver', 'receipt', 'available', 'schedule'], notes: ['一般过去时', '定语从句 which/that', '邀请信格式'], weak: ['被动语态', '非谓语']}}, {validate: validWorld, timeoutMs: 120000, maxTokens: 6000});
      maps.push({ok: Boolean(r), ms: Date.now() - t0, regions: r?.value.regions.map(x => ({id: x.id, nodes: x.nodes.map(n => `${n.name}｜${n.summary}`)}))});
      log(`world ${i + 1}: ${r ? 'ok' : 'FAIL'}`);
    }
    report.sections.world = maps;
    save();
  }

  if (want('exam')) {
    const papers = [];
    for (let i = 0; i < 2; i += 1) {
      const t0 = Date.now();
      const id = game.modules.exam.kick('pretco-b');
      await game.modules.exam.jobs.get(id);
      const full = game.modules.exam.readFull(id);
      const entry = {ok: Boolean(full), ms: Date.now() - t0, paperId: id};
      if (full) {
        let checked = 0, unique = 0, failedCheck = 0;
        const problems = [];
        for (const sec of full.sections) for (const p of sec.parts) for (const it of p.items) {
          if (!it.options) continue;
          const stem = p.material && !p.kind.startsWith('listen') ? `${p.material.slice(0, 1500)}\n\n${it.stem}` : (it.tts ? `${it.tts}\n${it.stem}` : it.stem);
          const ok = await blindCheck(requestModel, {stem, options: it.options, answer: it.answer});
          checked += 1;
          if (ok === true) unique += 1; else if (ok === null) failedCheck += 1; else problems.push({sec: sec.id, part: p.id, stem: it.stem.slice(0, 160), options: it.options, answer: it.answer});
        }
        entry.objective = {checked, unique, failedCheck, problems};
        entry.counts = full.sections.map(s => ({id: s.id, items: s.parts.reduce((n, p) => n + p.items.length, 0)}));
        entry.sample = full.sections.map(s => ({id: s.id, first: s.parts.map(p => ({part: p.id, material: (p.material || '').slice(0, 300), item: JSON.stringify(p.items[0]).slice(0, 400)}))}));
      }
      papers.push(entry);
      log(`paper ${i + 1}: ${entry.ok ? `ok ${entry.objective.unique}/${entry.objective.checked} unique` : 'FAIL'}`);
      save();
    }
    report.sections.exam = papers;
    save();
  }

  if (want('variant')) {
    const bank = JSON.parse(fs.readFileSync(path.join(repo, 'services/mode-architecture/learning-zsb-data.json'), 'utf8')).bank.filter(q => /^e1-/.test(q.id) && Array.isArray(q.o)).slice(0, 20);
    const results = [];
    for (const q of bank) {
      const answer = q.o['ABCD'.indexOf(String(q.a))];
      const m = {id: `m-${q.id}`, subject: '英语', topic: '词汇和语法', wins: [], level: 1, seed: {question: q.q, answer, options: q.o}};
      const v = await game.modules.monsters.variantFor(m).catch(e => ({error: String(e.message || e)}));
      results.push({id: q.id, seed: q.q.slice(0, 120), seedAnswer: answer, variant: v ? {stem: v.stem, options: v.options, answer: v.answer, source: v.source, verified: v.verified, same: fold(v.stem || '') === fold(q.q)} : null});
      log(`variant ${q.id}: ${v?.source || 'none'} ${v?.verified ? 'verified' : ''}`);
    }
    report.sections.variant = {n: results.length, model: results.filter(r => r.variant?.source === 'model').length, verified: results.filter(r => r.variant?.verified).length, sameAsSeed: results.filter(r => r.variant?.same).length, results};
    save();
  }

  if (want('grade')) {
    const task = '你的朋友 Tom 邀请你周六参加他的生日聚会，但你那天要参加英语考试。请写一封回信：1. 感谢邀请；2. 说明不能参加的原因；3. 表示祝福并约下次见面。80–100 词。';
    const ref = 'Dear Tom, Thank you very much for inviting me to your birthday party on Saturday. ...';
    const rubric = '五档：14–15 内容完整格式规范语言流畅；11–13 要点齐全少量错误；8–10 缺一个要点或错误较多；5–7 要点缺失多；0–4 跑题或无法理解。称呼、落款缺失扣 1–2 分。';
    const essays = {
      good: 'Dear Tom,\nThank you so much for inviting me to your birthday party this Saturday. I am really happy that you thought of me. Unfortunately, I cannot come because I have to take an important English exam that day, and I have been preparing for it for weeks. I hope you have a wonderful party with lots of fun and delicious cake. Happy birthday! Let us meet next weekend and I will bring you a small gift.\nBest wishes,\nLi Ming',
      mediocre: 'Dear Tom, thank you invite me. I can not go party because I have exam in Saturday. I am very sorry. Happy birthday to you. we can meet next time. Li Ming',
      offtopic: 'My favourite sport is basketball. I play basketball every day after school with my classmates. It makes me strong and happy. Basketball is the best sport in the world.',
      blank: '',
      copy: '你的朋友 Tom 邀请你周六参加他的生日聚会，但你那天要参加英语考试。',
    };
    const grades = {};
    for (const [k, text] of Object.entries(essays)) {
      const runs = [];
      for (let i = 0; i < (k === 'good' ? 3 : 1); i += 1) {
        if (!text.trim() || fold(text).includes(fold(task).slice(0, 20))) { runs.push({score: 0, reason: '空白 / 抄题（代码直接 0 分，不调用模型）'}); continue; }
        const r = await modelJson(requestModel, GRADE_RULES, {kind: 'writing', task, reference: ref, rubric, max: 15, answer: text}, {validate: v => (Number.isInteger(Number(v?.score)) ? {score: Number(v.score), reason: String(v.reason || '')} : null), timeoutMs: 60000, maxTokens: 800});
        runs.push(r ? r.value : {score: null, reason: 'FAIL'});
      }
      grades[k] = runs;
      log(`grade ${k}: ${runs.map(r => r.score).join('/')}`);
    }
    report.sections.grade = grades;
    save();
  }

  if (want('quest')) {
    const days = [];
    const start = Date.parse('2026-11-09T02:00:00Z');
    for (let d = 0; d < 7; d += 1) {
      clock = start + d * 86400000 + (d === 6 ? 27 * 86400000 : 0); // 第 7 天放到考前一周看安静文案
      const q = game.questsToday();
      await game.modules.content.questJobs.get(game.today());
      const after = game.questsToday();
      days.push({date: game.today(), quiet: game.state().quiet, quests: after.quests.map(x => `${x.title}｜${x.text}｜${x.target.kind}×${x.target.count}｜${x.source}`)});
      void q;
      log(`quest ${game.today()}: ${after.quests[0].source}`);
    }
    clock = Date.now();
    report.sections.quest = days;
    save();
  }

  if (want('line')) {
    // 台词池：第一次调用即时回本地并在后台写池子；等池子写好后再抽 20 条（平日 10 + 考前一周 10）。
    const events = ['setFinish', 'levelup', 'capture', 'boss', 'formSwitch', 'comeback', 'huntWin', 'gacha', 'questDone', 'examResult'];
    const lines = [];
    const pools = {};
    for (const quietDay of [false, true]) {
      clock = quietDay ? Date.parse('2026-12-09T02:00:00Z') : Date.now();
      const t0 = Date.now();
      const first = await game.modules.content.line({event: 'setFinish'});
      const firstMs = Date.now() - t0;
      const t1 = Date.now();
      await game.modules.content.lineJob;
      pools[quietDay ? 'quiet' : 'normal'] = {firstSource: first.source, firstMs, poolMs: Date.now() - t1, pool: game.read().lines?.pool || null};
      for (const ev of events) {
        const t2 = Date.now();
        const r = await game.modules.content.line({event: ev, context: {form: '立冬碧琪', streak: 5}});
        lines.push({ev, quiet: quietDay, ms: Date.now() - t2, ...r});
      }
    }
    clock = Date.now();
    report.sections.line = {n: lines.length, model: lines.filter(l => l.source === 'model').length, lines, pools};
    log(`lines: ${report.sections.line.model}/${lines.length} model`);
    save();
  }
} finally {
  save();
  fs.rmSync(root, {recursive: true, force: true});
  log(`saved ${out}`);
}
