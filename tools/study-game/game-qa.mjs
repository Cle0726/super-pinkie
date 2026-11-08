// 学习台游戏 · 页面 QA（营地 / 战斗 / 商店 / 地图 / 考场）。隔离 harness + 隔离真后端（isolatedService），不连 18789，不碰用户 App 和 learning/。
// 用法：NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/game-qa.mjs <shot|camp|...> [--out=dir] [--theme=light|dark] [--width=1440] [--tier=standard]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startHarness, isolatedService} from '../study-desk/harness.mjs';
import {launch, openPage} from './ui-qa.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), cmd = args.find(a => !a.startsWith('--')) || 'shot';
const opt = (name, d) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const out = path.resolve(opt('out', path.join(repo, 'design/study-game/qa')));
fs.mkdirSync(out, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));

// 给隔离 store 塞一些游戏数据（只在临时目录里）：钱包、形态、怪、亲密度。
export function seed(service, {stars = 2860, seals = 7, shards = 12, forms = ['daily', 'learning', 'detective', 'pirate'], equipped = 'detective'} = {}) {
  const game = service.store.game;
  game.mutate(s => {
    game.grant(s, 'qa-seed-' + Date.now(), {type: 'qa', id: 'seed'}, [{kind: 'stars', amount: stars, reason: 'QA 起始'}, {kind: 'seals', amount: seals, reason: 'QA 起始'}, {kind: 'shards', amount: shards, reason: 'QA 起始'}]);
    for (const f of forms) if (!s.forms.owned.includes(f)) s.forms.owned.push(f);
    s.forms.equipped = equipped; s.forms.xp[equipped] = 820;
    s.pending = [];
  });
}
// 隔离 store 里生几只到期的错题怪（单选题种子），讨伐 / 战斗层 QA 用。
export const MONSTER_SEEDS = [
  {key: 'qa-tense', subject: '英语', topic: '一般现在时', question: 'She ___ to school by bus every day.', answer: 'goes', options: ['go', 'goes', 'went', 'going']},
  {key: 'qa-prep', subject: '英语', topic: '介词搭配', question: 'The new policy will have a great impact ___ local business.', answer: 'on', options: ['in', 'at', 'on', 'to']},
  {key: 'qa-word', subject: '英语词汇', topic: '词义辨析', question: '"ambulance" 的意思是？', answer: '救护车', options: ['大使馆', '救护车', '雄心', '含糊的']},
  {key: 'qa-read', subject: '英语阅读', topic: '细节理解', question: 'According to the notice, the library closes at ___ on Fridays.', answer: '6 p.m.', options: ['5 p.m.', '6 p.m.', '8 p.m.', '9 p.m.']},
  {key: 'qa-trans', subject: '英语翻译', topic: '被动语态', question: '"这座桥建于 1990 年" 最准确的翻译是？', answer: 'The bridge was built in 1990.', options: ['The bridge built in 1990.', 'The bridge was built in 1990.', 'The bridge is building in 1990.', 'The bridge has built in 1990.']},
];
export function seedMonsters(service, seeds = MONSTER_SEEDS, {due = true, level = [1, 2, 3, 1, 4]} = {}) {
  const game = service.store.game, M = game.modules.monsters;
  return game.mutate(s => seeds.map((seedQ, i) => { const m = M.spawn(s, seedQ); m.level = level[i % level.length]; if (due) { m.dueAt = Date.now() - 1000; m.state = 'due'; } return m.id; }));
}
export async function harnessWithGame(opts = {}) {
  const service = await isolatedService();
  if (opts.seed !== false) seed(service, opts.seed || {});
  if (opts.monsters) seedMonsters(service);
  const harness = await startHarness({handler: service.handler, ...(opts.harness || {})});
  return {service, harness, close: async () => { await harness.close(); await service.close(); }};
}
export async function deskReady(page, view = 'today') {
  await page.locator('#pinkie-study-desk').waitFor({timeout: 15000});
  await page.waitForFunction(() => window.__pinkieStudyDesk, null, {timeout: 15000});
  if (view) await page.evaluate(v => window.__pinkieStudyDesk.go(v), view);
  await wait(300);
  await page.waitForFunction(() => !document.querySelector('#pinkie-study-desk [aria-busy="true"]'), null, {timeout: 15000}).catch(() => {});
  await wait(1600);
}

async function shot() {
  const {harness, close} = await harnessWithGame();
  const browser = await launch();
  try {
    for (const theme of (opt('theme') ? [opt('theme')] : ['light', 'dark'])) {
      const width = Number(opt('width', 1440)), height = Math.round(width * 10 / 16);
      const {page, context} = await openPage(browser, harness, {width, height, theme, tier: opt('tier', 'standard'), dpr: Number(opt('dpr', 1))});
      await deskReady(page);
      const f = path.join(out, `${opt('name', 'today')}-${theme}-${width}.png`); await page.screenshot({path: f}); console.log(f);
      await context.close();
    }
  } finally { await browser.close(); await close(); }
}

// 战斗层：讨伐列表 → 讨伐（真后端：hunt.start → drill.answer → game awards）→ 命中 / 闪开 / 连击接触表；量答题反馈延迟。
async function battle() {
  const {harness, service, close} = await harnessWithGame({monsters: false});
  const browser = await launch(); const report = {};
  try {
    for (const theme of (opt('theme') ? [opt('theme')] : ['light', 'dark'])) {
      seedMonsters(service);
      const width = Number(opt('width', 1440)), height = Math.round(width * 10 / 16);
      const {page, context} = await openPage(browser, harness, {width, height, theme, tier: opt('tier', 'standard'), dpr: Number(opt('dpr', 1))});
      await deskReady(page, 'gamehunt');
      await page.locator('.pkb-mon').first().waitFor({timeout: 8000});
      await page.screenshot({path: path.join(out, `hunt-list-${theme}-${width}.png`)});
      await page.locator('.pkb-hunt__go').click();
      await page.locator('.pkb-arena').waitFor({timeout: 15000});
      await page.locator('.pk-drill-stem').waitFor({timeout: 15000}); await wait(900);
      await page.screenshot({path: path.join(out, `battle-start-${theme}-${width}.png`)});
      const seeds = Object.fromEntries(MONSTER_SEEDS.map(m => [m.question, m.answer]));
      const lat = [];
      for (let k = 0; k < 5; k++) {
        const stem = await page.locator('.pk-drill-stem').innerText();
        const want = seeds[Object.keys(seeds).find(q => stem.includes(q.slice(0, 18)))];
        const wrong = k === 2; // 第三题故意答错：看闪开
        const opts = page.locator('.pk-drill-options .pk-choice');
        const n = await opts.count(); let pick = 0;
        for (let i = 0; i < n; i++) { const t = (await opts.nth(i).innerText()).replace(/^[A-D1-4]\s*/, '').trim(); if ((t === want) !== wrong) { pick = i; break; } }
        await opts.nth(pick).click(); await wait(200);
        await page.evaluate(() => {
          window.__qaMo?.disconnect(); window.__qaT = 0; window.__qaT0 = 0;
          document.querySelector('.pk-drill-check').addEventListener('pointerdown', () => { window.__qaT0 = performance.now(); }, {capture: true, once: true});
          // 第一次出现的新伤害数字 / 闪开（不是上一题留下的）= 反馈出现。
          window.__qaMo = new MutationObserver(recs => { if (window.__qaT || !window.__qaT0) return; for (const r of recs) for (const n of r.addedNodes) if (n.classList?.contains('pkb-pop')) { window.__qaT = performance.now() - window.__qaT0; return; } });
          window.__qaMo.observe(document.body, {childList: true, subtree: true});
        });
        if (k === 1) await page.evaluate(() => window.__pinkieGameFx._timeScale(.2));
        await page.locator('.pk-drill-check').click();
        if (k === 1 || k === 2) { for (const ms of [90, 260, 600]) { await wait(ms); await page.screenshot({path: path.join(out, `battle-${wrong ? 'dodge' : 'hit'}-${theme}-${ms}.png`)}); } await page.evaluate(() => window.__pinkieGameFx._timeScale(1)); }
        await wait(400); lat.push(await page.evaluate(() => Math.round(window.__qaT || -1)));
        await page.locator('.pk-sheet .pk-btn').first().click().catch(() => {}); await wait(500);
        if (!(await page.locator('.pk-drill-stem').count())) break;
      }
      report[theme] = {feedbackMs: lat};
      await wait(1500); await page.screenshot({path: path.join(out, `battle-after-${theme}-${width}.png`)});
      await context.close();
    }
  } finally { await browser.close(); await close(); }
  fs.writeFileSync(path.join(out, 'battle.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}

// 奖励播放：后端在别处产生的奖励（pending）→ 打开营地立刻补播 → 播完 ack → 刷新页面不重播。
async function awards() {
  const {harness, service, close} = await harnessWithGame();
  const browser = await launch(); const r = {};
  try {
    const game = service.store.game;
    game.mutate(s => game.grant(s, 'qa-award-1', {type: 'qa', id: 'a1'}, [{kind: 'stars', amount: 15, reason: '委托完成', fx: 'small'}, {kind: 'seals', amount: 2, reason: '守关首通', fx: 'medium'}, {kind: 'levelup', itemId: 'detective', amount: 6, reason: '名侦探碧琪亲密度 Lv6', fx: 'big'}]));
    r.pendingBefore = game.read().pending.length;
    const {page, context} = await openPage(browser, harness, {theme: opt('theme', 'light'), tier: 'standard'});
    await deskReady(page);
    await wait(500); await page.screenshot({path: path.join(out, 'awards-playing.png')});
    await wait(4200);
    r.pendingAfter = game.read().pending.length;
    r.hud = await page.evaluate(() => [...document.querySelectorAll('[data-game-hud]')].map(n => n.dataset.gameHud + ':' + n.querySelector('b').textContent));
    await page.reload(); await deskReady(page); await wait(1500);
    r.chipsAfterReload = await page.evaluate(() => document.querySelectorAll('.pk-award').length);
    await context.close();
  } finally { await browser.close(); await close(); }
  fs.writeFileSync(path.join(out, 'awards.json'), JSON.stringify(r, null, 2)); console.log(JSON.stringify(r));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (cmd === 'awards') await awards();
  if (cmd === 'shot') await shot();
  if (cmd === 'battle') await battle();
}
