// 学习台游戏 · 本机试玩台（开发用）。隔离 harness + 隔离真后端：不连 18789，不碰用户 App 和 learning/。
// 用法：node tools/study-game/play.mjs [--port=4477] [--papers=<真题卷目录>] [--stars=2860] [--forms=daily,knight,...] [--form=knight]
// 打开 http://127.0.0.1:4477/chat 就是学习台；页面上的每个 RPC 都走真后端（临时目录里的存档）。
// 真题卷受版权保护，不在仓库里：默认读 ../super-pinkie-handoff/papers（没有就空题库）。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startHarness, isolatedService} from '../study-desk/harness.mjs';
import {seed, seedMonsters} from './game-qa.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const port = Number(opt('port', process.env.PORT || 4477));
const papers = path.resolve(opt('papers', process.env.STUDY_GAME_PAPERS || path.join(repo, '../super-pinkie-handoff/papers')));

// 没有模型时给题库一个粗标注，只为了让考点表有东西可看（开发用，不写进用户数据）。
const ROUGH = [
  [/\b(by|in|on|at|for|with|of|from|to)\b\s*$/i, '介词与固定搭配'], [/\b(which|who|whom|whose|that)\b/i, '定语从句'], [/\b(if|unless|although|though|because|while|until|once)\b/i, '状语从句与连词'],
  [/\b(to \w+|\w+ing)\b/i, '非谓语'], [/\b(was|were|been|be)\s+\w+ed\b/i, '被动语态'], [/\b(has|have|had|will|would)\b/i, '时态'],
];
function roughTag(service) {
  const bank = service.store.game.modules.practice?.bank; if (!bank?.load) return 0;
  let n = 0;
  try {
    const data = bank.load();
    for (const it of data.items || []) {
      if (it.point) continue;
      const opts = (it.options || []).join(' | ');
      let point = null;
      if (it.qkind === 'choice') point = (ROUGH.find(([re]) => re.test(opts) || re.test(it.prompt || '')) || [null, '词义辨析'])[1];
      else if (it.qkind === 'word-form') point = /ly\b/.test(String(it.answer)) ? '变副词' : /(tion|ment|ness|ity|ance|ence|er|or)\b/.test(String(it.answer)) ? '变名词' : /(ful|ous|ive|able|al|ed|ing)\b/.test(String(it.answer)) ? '变形容词' : '动词时态语态';
      else if (it.qkind === 'passage-choice') point = /main|mainly|title|purpose/i.test(it.prompt || '') ? '主旨题' : /infer|imply|probably/i.test(it.prompt || '') ? '推断题' : '细节题';
      else if (it.qkind === 'translate-choice') point = '固定表达';
      if (point) { it.point = point; it.difficulty = it.difficulty || ['易', '中', '中', '难'][n % 4]; n += 1; }
    }
  } catch (e) { console.log('rough tag skipped:', e.message); }
  return n;
}

const service = await isolatedService();
seed(service, {stars: Number(opt('stars', 2860)), forms: opt('forms', 'daily,detective,alicorn,breezie,crystal,unrestricted,knight,zhuangyuan,pirate,chef,magical-girl').split(',').filter(Boolean), equipped: opt('form', 'daily')});
seedMonsters(service);
let installed = 0;
if (fs.existsSync(papers)) {
  const ex = service.store.game.modules.exam;
  for (const f of fs.readdirSync(papers)) {
    if (!/^(real|mock)-[\w-]+\.json$/.test(f)) continue;
    try { ex.installReal(JSON.parse(fs.readFileSync(path.join(papers, f), 'utf8'))); installed += 1; } catch (e) { console.log('paper', f, e.message); }
  }
  const pr = service.store.game.modules.practice; if (pr?.bank) pr.bank.cache = null;
}
const tagged = roughTag(service);
const harness = await startHarness({handler: service.handler, routes: service.routes || [], port});
console.log(JSON.stringify({url: harness.url, papers: installed, roughTagged: tagged, root: service.store.root}));
const stop = async () => { try { await harness.close(); await service.close(); } finally { process.exit(0); } };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
