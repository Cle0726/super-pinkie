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
export async function harnessWithGame(opts = {}) {
  const service = await isolatedService();
  if (opts.seed !== false) seed(service, opts.seed || {});
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (cmd === 'shot') await shot();
}
