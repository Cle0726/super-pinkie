// 默写判题抽检（ACCEPTANCE §1 最后一条）。隔离方式同 drill-model-sample.mjs：只读 App 的模型配置，
// 在临时目录里调 drill.judge，不写真实学习数据，不连 18789。结果已存在就直接退出，只跑一次。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LearningInteractionStore, LearningNotesOrganizer} from '../../services/mode-architecture/learning.mjs';
import {openclawConfigPath} from '../../services/mode-architecture/openclaw-paths.mjs';
import {LearningDrill, localJudge} from '../../services/mode-architecture/learning-drill.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(repo, 'design/study-desk-drill/judge-sample.json');
const source = path.join(repo, 'design/study-desk-drill/model-sample.json');
const KEY = 'agent:learning:drill-judge-sample';
if (fs.existsSync(output)) {
  console.log('判题抽检结果已在，不再调用模型：' + output);
  process.exit(0);
}

// 每张卡 5 条：完全对、换种说法对、半对、方向写反、空白。期望只作对照，不喂给模型。
const WRITES = {
  'net3-131': [
    ['完全对', '将 IP 地址解析为 MAC 地址', 'correct'],
    ['换说法对', '已知对方的 IP，用广播查出它的网卡物理地址', 'correct'],
    ['半对', '解析 IP 地址', 'partial'],
    ['方向写反', '将 MAC 地址解析为 IP 地址', 'wrong|partial'],
    ['空白', '', 'wrong'],
  ],
  'ee6-20': [
    ['完全对', '发射结正偏，集电结反偏', 'correct'],
    ['换说法对', '发正集反，BE 结正向偏置、BC 结反向偏置', 'correct'],
    ['半对', '发射结正偏', 'partial'],
    ['方向写反', '发射结反偏，集电结正偏', 'wrong|partial'],
    ['空白', '', 'wrong'],
  ],
};

const sample = JSON.parse(fs.readFileSync(source, 'utf8'));
const cards = sample.cards.filter(card => WRITES[card.id]);
if (cards.length !== 2) throw new Error('model-sample.json 里缺 net3-131 或 ee6-20');

const config = JSON.parse(fs.readFileSync(openclawConfigPath(), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-drill-judge-'));
const rows = [];
let model = '';
try {
  const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
  const api = {config, runtime: {config: {current: () => config}}};
  const organizer = new LearningNotesOrganizer(api, store);
  const drill = new LearningDrill(store, {organizer, now: () => Date.now()});
  const status = drill.modelStatus(KEY);
  model = status.modelName || status.model || '';
  if (!status.available) throw new Error('学习模式的内置模型当前不可用');
  const items = cards.map(card => ({
    itemId: card.id, mode: 'write', judge: 'model', prompt: card.question, answer: card.answer,
    keys: card.items?.keys || [], reveal: {question: card.question, answer: card.answer},
    cardRef: {book: 'notes', noteId: card.id, recallId: card.id},
  }));
  drill.save({sessionId: 'judge-sample', sessionKey: KEY, source: 'notes', createdAt: Date.now(), items, graded: {}, learned: {}, answers: []});
  // 先探一下模型通不通：探针本身就是第一条（完全对），不额外花一次。
  for (const card of cards) {
    for (const [kind, text, expect] of WRITES[card.id]) {
      const started = Date.now();
      // 模型失败时 judge 会退本地；单独算一次本地结果，用来分辨这条是不是模型判的。
      const local = localJudge({answer: card.answer, keys: card.items?.keys || [], text});
      const result = await drill.judge({sessionId: 'judge-sample', itemId: card.id, text});
      const ms = Date.now() - started;
      const fellBack = result.comment === '碧琪没来得及细看，按关键词判的';
      rows.push({card: card.id, question: card.question, answer: card.answer, kind, text, expect,
        verdict: result.verdict, missing: result.missing, comment: result.comment, ms, by: fellBack ? 'local' : 'model',
        ok: expect.split('|').includes(result.verdict), localVerdict: local.verdict});
      console.log(`${card.id} ${kind}: ${result.verdict} (${ms}ms, ${fellBack ? '本地' : '模型'}) ${result.comment}`);
    }
  }
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
const report = {
  at: new Date().toISOString(), model, timeoutMs: 25000,
  summary: {total: rows.length, byModel: rows.filter(row => row.by === 'model').length, ok: rows.filter(row => row.ok).length},
  rows,
};
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`判题抽检写好了：${output}（${report.summary.ok}/${rows.length} 合理，模型判 ${report.summary.byModel} 条，${model}）`);
