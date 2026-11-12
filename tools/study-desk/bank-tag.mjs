// 真题题库全量标注（隔离跑，REDO-1109 E1）：只读 App 的模型配置和真实卷子，在 --data 隔离目录里建 game/papers（拷贝）+ game/bank，标完打印校验报告。
// 不连 18789，不写 ~/.openclaw，不写真实学习数据（装进学习数据是另一步：先备份再拷 bank/pretco-b.json）。
// node tools/study-desk/bank-tag.mjs --data=<隔离目录> [--papers=<卷子目录，默认真实学习数据的 game/papers>] [--concurrency=4] [--force] [--report-only]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LearningNotesOrganizer, requestLearningModel} from '../../services/mode-architecture/learning.mjs';
import {openclawConfigPath} from '../../services/mode-architecture/openclaw-paths.mjs';
import {QuestionBank} from '../../services/mode-architecture/learning-game-bank.mjs';

const arg = (k, d = null) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : (process.argv.includes(`--${k}`) ? true : d); };
if (!arg('data')) throw new Error('要 --data');
const data = path.resolve(arg('data'));
if (data.includes('/.openclaw') || data.includes('SuperPinkie/learning')) throw new Error('隔离目录不能指向真实数据：' + data);
const src = path.resolve(arg('papers', path.join(os.homedir(), 'Library/Application Support/SuperPinkie/learning/game/papers')));
const root = path.join(data, 'game');
fs.mkdirSync(path.join(root, 'papers'), {recursive: true});
for (const f of fs.readdirSync(src)) if (/^(real|mock)-[\w-]+\.json$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(root, 'papers', f));

let requestModel = null, organizer = null, calls = 0;
if (!arg('report-only')) {
  const config = JSON.parse(fs.readFileSync(openclawConfigPath(), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-bank-tag-'));
  const store = new LearningInteractionStore({root: tmp, workspace: path.join(tmp, 'workspace')});
  const api = {config, runtime: {config: {current: () => config}}};
  organizer = new LearningNotesOrganizer(api, store, {timeoutMs: 180000, deepTimeoutMs: 240000});
  requestModel = async (rules, payload, options) => { calls += 1; return requestLearningModel(organizer, rules, payload, options); };
}
const bank = new QuestionBank({root, requestModel});
const t0 = Date.now();
if (requestModel) {
  const timer = setInterval(() => console.log('…', Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(bank.status), 'calls', calls), 60000);
  try { await bank.tagAll({force: Boolean(arg('force')), concurrency: Number(arg('concurrency', 4))}); } finally { clearInterval(timer); }
  console.log('model', organizer.catalog().defaultRef, 'calls', calls, 'seconds', Math.round((Date.now() - t0) / 1000));
}
const rep = bank.report();
console.log(JSON.stringify({items: rep.items, tagged: rep.tagged, unclassified: rep.unclassified.length, problems: rep.problems}, null, 1));
console.log(Object.entries(rep.byPoint).sort().map(([k, v]) => `${k}\t${v}`).join('\n'));
fs.writeFileSync(path.join(data, 'bank-report.json'), JSON.stringify(rep, null, 1));
