// 背一背出题抽检。只读 App 的模型配置，在临时目录里调一次，不写真实学习数据，不连 18789。
// 20 张卡按产品队列每批最多 6 张。结果已存在就直接退出，避免再花一次额度。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LearningInteractionStore, LearningNotesOrganizer} from '../../services/mode-architecture/learning.mjs';
import {openclawConfigPath} from '../../services/mode-architecture/openclaw-paths.mjs';
import {LearningDrill, drillCardHash} from '../../services/mode-architecture/learning-drill.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(repo, 'design/study-desk-drill/model-sample.json');
const KEY = 'agent:learning:drill-sample';
const PICKS = [
  ['C语言', ['c8-86', 'c5-75', 'c7-84', 'c1-60', 'c6-79']],
  ['计算机网络', ['net5-145', 'net4-137', 'net3-131', 'net6-148', 'net1-124']],
  ['电工电子', ['ee2-7', 'ee3-10', 'ee4-12', 'ee7-23', 'ee6-20']],
  ['英语', ['e1-47', 'e1-38', 'e1-53', 'e1-44', 'e1-40']],
];

if (fs.existsSync(output)) {
  console.log('抽检结果已在，不再调用模型：' + output);
  process.exit(0);
}

const letters = ['A', 'B', 'C', 'D'];
const bank = new Map(JSON.parse(fs.readFileSync(new URL('../../services/mode-architecture/learning-zsb-data.json', import.meta.url), 'utf8')).bank.map(item => [item.id, item]));
const samples = PICKS.flatMap(([subject, ids]) => ids.map(id => {
  const item = bank.get(id);
  if (!item) throw new Error('题库里没有 ' + id);
  const index = letters.indexOf(String(item.a));
  const answer = index >= 0 && Array.isArray(item.o) ? item.o[index] : String(item.a);
  return {id, subject, question: String(item.q).replace(/\s+/g, ' ').trim(), answer, quote: String(item.x || answer)};
}));
if (samples.length !== 20) throw new Error('抽检卡必须是 20 张');

const configPath = openclawConfigPath();
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-drill-sample-'));
const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
const api = {config, runtime: {config: {current: () => config}}};
const organizer = new LearningNotesOrganizer(api, store);
const drill = new LearningDrill(store, {organizer, now: () => Date.now()});
const cards = samples.map(card => ({book: 'notes', recallId: card.id, noteId: card.id, ...card, hash: drillCardHash(card)}));

let model = '';
let saved = {};
try {
  const status = organizer.status(KEY);
  model = status.modelName || status.model || '';
  if (!status.available) throw new Error('学习模式的内置模型当前不可用');
  drill.enqueueCards(KEY, cards);
  if (drill.running) await drill.running;
  saved = drill.read().cards;
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
const report = {
  at: new Date().toISOString(),
  model,
  batches: '每批最多 6 张，这一次跑完 20 张',
  cards: samples.map(card => {
    const row = saved[card.id] || {};
    return {
      id: card.id, subject: card.subject, question: card.question, answer: card.answer, quote: card.quote,
      status: row.status || 'missing', error: row.error || '', items: row.items || {},
    };
  }),
};
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const ready = report.cards.filter(card => card.status === 'ready' && Object.keys(card.items).length).length;
console.log(`抽检写好了：${output}（${ready}/20 张有可用题，模型 ${model || '未命名'}）`);
