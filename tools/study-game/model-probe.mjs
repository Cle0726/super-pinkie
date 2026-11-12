#!/usr/bin/env node
// 碧琪上岸记 · 模型延迟探针（隔离：只读 App 的模型配置，临时目录，不连 18789）。
// 用法：node tools/study-game/model-probe.mjs [n=3]  → 台词 / 委托文案 / 变体 / 判卷各调 n 次，打印耗时。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LearningNotesOrganizer, requestLearningModel} from '../../services/mode-architecture/learning.mjs';
import {openclawConfigPath} from '../../services/mode-architecture/openclaw-paths.mjs';
import {LINE_RULES, QUEST_TEXT_RULES, VARIANT_RULES} from '../../services/mode-architecture/learning-game-content.mjs';
import {GRADE_RULES} from '../../services/mode-architecture/learning-game-exam.mjs';

const n = Number(process.argv[2] || 3);
const config = JSON.parse(fs.readFileSync(openclawConfigPath(), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-game-probe-'));
const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
const organizer = new LearningNotesOrganizer({config, runtime: {config: {current: () => config}}}, store);
const cases = {
  line: [LINE_RULES, {event: 'setFinish', context: {quiet: false, form: '立冬碧琪', streak: 5}}, 200],
  quest: [QUEST_TEXT_RULES, {date: '2026-11-09', term: '立冬', quiet: false, quests: [{id: 'q1', kind: 'answers', count: 20}, {id: 'q2', kind: 'sets', count: 2}]}, 600],
  variant: [VARIANT_RULES, {subject: '英语', topic: '时态', question: 'She has worked in this company ______ 2020.', answer: 'since', note: ''}, 2000],
  grade: [GRADE_RULES, {kind: 'writing', task: '回信谢绝 Tom 的生日聚会邀请（考试），祝福并约下次，80–100 词。', reference: '', rubric: '五档 14–15/11–13/8–10/5–7/0–4', max: 15, answer: 'Dear Tom, thank you invite me. I can not go party because I have exam in Saturday. I am very sorry. Happy birthday to you. we can meet next time. Li Ming'}, 800],
};
try {
  console.log('model', organizer.catalog().defaultRef);
  for (const [k, [rules, payload, maxTokens]] of Object.entries(cases)) {
    for (let i = 0; i < n; i += 1) {
      const t0 = Date.now();
      try {
        const r = await requestLearningModel(organizer, rules, payload, {timeoutMs: 90000, maxTokens});
        console.log(k, Date.now() - t0, 'ms', JSON.stringify(r.value ?? r.json ?? r).slice(0, 200));
      } catch (e) { console.log(k, Date.now() - t0, 'ms ERROR', String(e.message || e).slice(0, 200)); }
    }
  }
} finally { fs.rmSync(root, {recursive: true, force: true}); }
