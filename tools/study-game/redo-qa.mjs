// REDO-1109 第一批截图：刷题页各入口、考点表、作答页（各题型 / 答对 / 答错 / 结算）、营地今日闭环、衣橱两栏、HUD 头像。
// WebKit + 隔离 harness（真题卷从学习数据只读拷进隔离目录），不碰 18789。
// NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/redo-qa.mjs [--sizes=1440x900,1280x800] [--themes=light,dark] [--only=a,b]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {harnessWithGame, deskReady, seedBank} from './game-qa.mjs';
import {openWk} from './review-qa.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const out = path.resolve(opt('out', path.join(repo, '../../briefs/study-desk-game/qa-redo')));
fs.mkdirSync(out, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const sizes = opt('sizes', '1440x900,1280x800').split(',').map(s => s.split('x').map(Number));
const themes = opt('themes', 'light,dark').split(',');
const only = opt('only', '') ? opt('only').split(',') : null;

const go = (page, v) => page.evaluate(v => window.__pinkieStudyDesk.go(v), v);
const startSet = (page, params) => page.evaluate(async p => { const r = await window.__pinkieGamePractice.openSet(p); return Boolean(r); }, params);
const waitQ = page => page.waitForFunction(() => document.querySelector('.pkp-set .pk-drill-q, .pkp-set .pkb-result'), null, {timeout: 20000}).catch(() => {});
// 答当前题：right=true 用后端答案答对；false 故意答错
async function answer(page, right) {
  return page.evaluate(async right => {
    const pane = window.__pinkieStudyDesk.pane(); const set = pane.state.practiceSet;
    const q = document.querySelector('.pkp-set .pk-drill-q'); if (!q) return null;
    const opts = [...document.querySelectorAll('.pkp-set .pkb-opt, .pkp-set .pkp-letter')];
    const input = document.querySelector('.pkp-set .pkp-input'), essay = document.querySelector('.pkp-set .pkp-essay');
    // 偷看答案只在隔离环境：从 QA 钩子拿
    const key = await window.__qaKey?.(set.setId, document.querySelector('.pk-drill-count')?.textContent);
    if (opts.length) { const i = right ? key.index : (key.index + 1) % opts.length; opts[i].click(); }
    else if (input) { input.value = right ? key.text : 'zzz'; input.closest('form').requestSubmit(); }
    else if (essay) { essay.value = right ? key.text : ''; [...document.querySelectorAll('.pkp-set .pkg-btn')].find(b => /阅卷/.test(b.textContent)).click(); }
    return true;
  }, right);
}
const fb = page => page.waitForFunction(() => document.querySelector('.pkp-fb'), null, {timeout: 60000}).catch(() => {});
const next = page => page.evaluate(() => document.querySelector('.pkp-fb .pk-btn')?.click());

const {harness, service, close} = await harnessWithGame({monsters: false});
seedBank(service);
const game = service.store.game, pr = game.modules.practice;
// QA 钩子：页面按 setId + 进度拿当前题的答案（只在隔离 harness 里注入，生产没有）
harness.qaKey = (setId, count) => {
  const set = game.read().practice.sets[setId]; const idx = Number(String(count || '1').split('/')[0]) - 1;
  const it = pr.bank.item(set.items[idx]);
  if (it.options) return {index: it.answer};
  if (it.qkind === 'term-match') { const letters = String(pr.bank.load().materials[it.material] || '').split(/\n+/).map(l => (/^\s*([A-Z])\s*[—\-–:：.)）]/.exec(l) || [])[1]).filter(Boolean); return {index: Math.max(0, [...new Set(letters)].indexOf(it.answer))}; }
  if (Array.isArray(it.answer)) return {text: it.answer[0]};
  return {text: it.reference || ''};
};
service.routes.push({path: '/__qa/key', handler(req, res) { const u = new URL(req.url, 'http://x'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(harness.qaKey(u.searchParams.get('set'), u.searchParams.get('c')))); return true; }});
const shots = [];
const shoot = async (page, name) => { const f = path.join(out, `${name}.png`); await page.screenshot({path: f}); shots.push(path.basename(f)); };

const SCENES = {
  async home(page, tag) { await deskReady(page, 'today'); await go(page, 'gamepractice'); await page.waitForFunction(() => document.querySelector('.pkp-quick'), null, {timeout: 15000}); await wait(1200); await shoot(page, `practice-home-${tag}`);
    await page.evaluate(() => [...document.querySelectorAll('.pkp-points .pkg-seg button')].find(b => b.textContent === '阅读')?.click()); await wait(500); await shoot(page, `practice-points-reading-${tag}`); },
  async random(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'random', count: 10}); await waitQ(page); await wait(900); await shoot(page, `set-random-q-${tag}`);
    await answer(page, true); await fb(page); await wait(900); await shoot(page, `set-random-right-${tag}`); await next(page); await waitQ(page); await wait(600);
    await answer(page, false); await fb(page); await wait(900); await shoot(page, `set-random-wrong-${tag}`);
    for (let k = 0; k < 9; k++) { await next(page); await wait(500); if (await page.evaluate(() => Boolean(document.querySelector('.pkp-set .pkb-result')))) break; await waitQ(page); await answer(page, true); await fb(page); }
    await page.waitForFunction(() => document.querySelector('.pkp-set .pkb-result'), null, {timeout: 15000}).catch(() => {}); await wait(1600); await shoot(page, `set-random-result-${tag}`); },
  async wordform(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'kind', kind: 'vf'}); await waitQ(page); await wait(800); await page.evaluate(() => { const i = document.querySelector('.pkp-input'); if (i) i.value = 'payment'; }); await shoot(page, `set-wordform-${tag}`); },
  async reading(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'kind', kind: 'rd'}); await waitQ(page); await wait(900); await shoot(page, `set-reading-${tag}`); await answer(page, true); await fb(page); await wait(800); await shoot(page, `set-reading-right-${tag}`); },
  async match(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'kind', kind: 'r4'}); await waitQ(page); await wait(900); await shoot(page, `set-termmatch-${tag}`); },
  async practical(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'kind', kind: 'r5'}); await waitQ(page); await wait(900); await shoot(page, `set-practical-${tag}`); },
  async translation(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'kind', kind: 'translation'}); await waitQ(page); await wait(800); await shoot(page, `set-translation-choice-${tag}`);
    for (let k = 0; k < 4; k++) { await answer(page, true); await fb(page); await next(page); await waitQ(page); await wait(400); } await wait(600); await shoot(page, `set-translation-passage-${tag}`); },
  async writing(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'kind', kind: 'writing'}); await waitQ(page); await wait(800); await shoot(page, `set-writing-${tag}`); },
  async listening(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'listening'}); await waitQ(page); await wait(900); await shoot(page, `set-listening-${tag}`); },
  async point(page, tag) { await deskReady(page, 'today'); await startSet(page, {mode: 'point', point: 'vc/非谓语'}); await waitQ(page); await wait(900); await shoot(page, `set-point-${tag}`); },
  async camp(page, tag) { await deskReady(page, 'today'); await page.waitForFunction(() => document.querySelector('.pkg-stage.is-camp canvas, .pkg-stage canvas, .pkg-stage__biqi'), null, {timeout: 12000}).catch(() => {}); await wait(1800); await shoot(page, `camp-today-loop-${tag}`);
    const box = await page.evaluate(() => { const r = document.querySelector('.pkg-side')?.getBoundingClientRect(); return r ? {x: r.x, y: r.y, width: r.width, height: r.height} : null; });
    if (box) { const f = path.join(out, `camp-today-loop-crop-${tag}.png`); await page.screenshot({path: f, clip: box}); shots.push(path.basename(f)); }
    const hud = await page.evaluate(() => { const r = document.querySelector('.pkg-camp__top')?.getBoundingClientRect(); return r ? {x: r.x, y: r.y, width: Math.min(r.width, 520), height: r.height} : null; });
    if (hud) { const f = path.join(out, `hud-avatar-${tag}.png`); await page.screenshot({path: f, clip: hud}); shots.push(path.basename(f)); } },
  async wardrobe(page, tag) { await deskReady(page, 'today'); await go(page, 'gamewardrobe'); await wait(2600); await shoot(page, `wardrobe-two-columns-${tag}`); },
  async campforms(page, tag) {
    await deskReady(page, 'today');
    const forms = ['daily', 'unrestricted', 'alicorn', 'crystal', 'seapony', 'kirin', 'batpony', 'serious', 'breezie', 'changeling', 'lidong', 'detective'];
    for (const hour of [10, 21]) {
      const when = hour < 18 ? 'day' : 'night';
      for (const id of forms) {
        await page.evaluate(async ({id, hour}) => {
          window.__pkBeijingHour = hour;
          await window.__pinkieGame.call('forms.equip', {formId: id});
          window.__pinkieStudyDesk.go('today');
        }, {id, hour});
        await page.waitForFunction(fid => document.querySelector('.pkg-stage.is-camp') && (document.querySelector('.pkg-stage__tag b')?.textContent || '').length > 0, id, {timeout: 12000}).catch(() => {});
        await wait(1400);
        await shoot(page, `camp-${id}-${when}-${tag}`);
      }
    }
    const hud = await page.evaluate(() => { const r = document.querySelector('.pkg-who')?.getBoundingClientRect(); return r ? {x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16} : null; });
    if (hud) { const f = path.join(out, `hud-face-${tag}.png`); await page.screenshot({path: f, clip: hud}); shots.push(path.basename(f)); }
  },
};

try {
  for (const [w, h] of sizes) for (const theme of themes) {
    const tag = `${theme}-${w}`;
    for (const [name, fn] of Object.entries(SCENES)) {
      if (only && !only.includes(name)) continue;
      // 每个场景开一个干净的状态（今日闭环 / 题目做题记录不串）
      game.mutate(s => {
        s.practice = {rec: {}, sets: {}, unlocked: {}};
        // 换新提示是一次性的。隔离存档拥有退场旧形态，提示会挡住考点表，截图一律清掉。
        s.forms.v3done = true; s.forms.v3note = null; s.forms.v2note = null;
        if (name === 'camp' || name === 'campforms' || name === 'wardrobe' || name === 'random') {
          for (const id of ['daily', 'unrestricted', 'alicorn', 'crystal', 'seapony', 'kirin', 'batpony', 'serious', 'breezie', 'changeling', 'lidong', 'detective']) if (!s.forms.owned.includes(id)) s.forms.owned.push(id);
        }
        if (name === 'camp' && w === 1440) { const d = game.day(s); d.lessons = 1; d.realSets = 1; d.realCorrect = 7; }
        else if (name !== 'campforms') delete s.days[game.today()];
      });
      // 手账「今日 n 组」读 pact.drillFinished。隔离里只改了 days.realSets 时两行会对不上，这里跟真实 finish() 一样两边一起写。
      service.store.pact?.mutateDay?.(game.today(), day => { day.drillFinished = name === 'camp' && w === 1440 ? 1 : 0; });
      const page = await openWk(harness, {width: w, height: h, theme, init: ['window.__qaKey = (id, c) => fetch("/__qa/key?set=" + encodeURIComponent(id) + "&c=" + encodeURIComponent(c || "")).then(r => r.json())']});
      try { await fn(page, tag); } catch (e) { console.log('ERR', name, tag, e.message); }
      const errs = await page.evaluate(() => window.__qaErrors || []).catch(() => []);
      if (errs.length) console.log('PAGE ERRORS', name, tag, errs.join(' | '));
      await page.close();
    }
  }
} finally { await close(); }
console.log(shots.length, 'shots →', out);
