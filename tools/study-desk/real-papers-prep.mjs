// 历年真题拆卷（隔离跑）：只读 App 的模型配置和 U 盘，在临时目录里建游戏状态，拆好的卷子写进 --out。
// 不连 18789，不写 ~/.openclaw，不写真实学习数据；听力目录用 --audio 指向已拷好的本机目录（只读，大小一致就不再拷）。
// node tools/study-desk/real-papers-prep.mjs --data=<隔离数据目录> --out=<卷子输出目录> [--only=real-2014-06,mock-1] [--force] [--concurrency=3]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LearningNotesOrganizer, requestLearningModel} from '../../services/mode-architecture/learning.mjs';
import {openclawConfigPath} from '../../services/mode-architecture/openclaw-paths.mjs';
import {LearningGame} from '../../services/mode-architecture/learning-game.mjs';

const arg = (k, d = null) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : (process.argv.includes(`--${k}`) ? true : d); };
const data = path.resolve(arg('data'));
const out = path.resolve(arg('out'));
const usb = arg('usb', '/Volumes/Cle/学习/英语B级');
const liveAudio = arg('audio', path.join(os.homedir(), 'Library/Application Support/SuperPinkie/learning-materials/pretco-b-audio'));
if (!arg('data') || !arg('out')) throw new Error('要 --data 和 --out');
for (const p of [data, out]) if (p.includes('/.openclaw') || p.includes('SuperPinkie/learning')) throw new Error('隔离目录不能指向真实数据：' + p);
fs.mkdirSync(data, {recursive: true});
fs.mkdirSync(out, {recursive: true});
const audioLink = path.join(data, 'pretco-b-audio');
if (!fs.existsSync(audioLink) && fs.existsSync(liveAudio)) fs.symlinkSync(liveAudio, audioLink);
process.env.PINKIE_PRETCO_USB = usb;

const config = JSON.parse(fs.readFileSync(openclawConfigPath(), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-real-prep-'));
const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
const api = {config, runtime: {config: {current: () => config}}};
const organizer = new LearningNotesOrganizer(api, store, {timeoutMs: 240000, deepTimeoutMs: 300000});
let calls = 0;
const requestModel = async (rules, payload, options) => { calls += 1; return requestLearningModel(organizer, rules, payload, options); };
const game = new LearningGame(store, {requestModel, autoReal: false});
const exam = game.modules.exam;
exam.real.dataRoot = data;
exam.real.concurrency = Number(arg('concurrency', 3));
exam.realReady = id => !arg('force') && fs.existsSync(path.join(out, `${id}.json`));
exam.installReal = full => { fs.writeFileSync(path.join(out, `${full.paperId}.json`), JSON.stringify(full)); console.log('ready', full.paperId, JSON.stringify(full.check), 'flags', full.flags.length); };
const only = arg('only') ? String(arg('only')).split(',') : null;
const t0 = Date.now();
const timer = setInterval(() => console.log('…', Math.round((Date.now() - t0) / 1000) + 's', exam.real.status.state, exam.real.status.preparing || '', 'calls', calls), 60000);
try {
  const st = await exam.real.sync({only});
  console.log(JSON.stringify({...st, seconds: Math.round((Date.now() - t0) / 1000), calls, model: organizer.catalog().defaultRef}, null, 1));
} finally { clearInterval(timer); fs.rmSync(root, {recursive: true, force: true}); }
