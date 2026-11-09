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
  const harness = await startHarness({handler: service.handler, routes: service.routes || [], ...(opts.harness || {})});
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

// 商店 / 扭蛋 / 衣橱 / 图鉴：截图 + 买形态 + 心愿单 + 十连（3D 扭蛋机逐段截图）。
async function shop() {
  const {harness, service, close} = await harnessWithGame({seed: {stars: 9600, seals: 24, shards: 30}});
  const browser = await launch(); const r = {};
  try {
    for (const theme of (opt('theme') ? [opt('theme')] : ['light', 'dark'])) {
      const width = Number(opt('width', 1440)), height = Math.round(width * 10 / 16), tag = `${theme}-${width}`;
      const {page, context} = await openPage(browser, harness, {width, height, theme, tier: opt('tier', 'standard')});
      await deskReady(page, 'gameshop'); await page.locator('.pks-sku').first().waitFor({timeout: 8000}); await wait(700);
      await page.screenshot({path: path.join(out, `shop-${tag}.png`)});
      if (theme === 'light') {
        // 心愿单：钉一个买不起的 SSR（金印专柜），HUD 出进度条
        const pin = page.locator('.pks-shelf[data-shelf="seal"] .pks-pin').first(); if (await pin.count()) { await pin.click(); await wait(600); }
        // 买一个 R / SR 形态：两步确认 → 过场
        const buy = page.locator('.pks-shelf[data-shelf="permanent"] .pks-sku[data-kind="form"]:not([data-owned]) .pks-buy').first();
        await buy.click(); await wait(150); await buy.click();
        await page.waitForFunction(() => window.__pinkieGameFx.stats().cine, null, {timeout: 6000}).catch(() => {}); await wait(900);
        await page.screenshot({path: path.join(out, `shop-buy-cine-${tag}.png`)});
        await page.waitForFunction(() => !window.__pinkieGameFx.stats().cine, null, {timeout: 8000}).catch(() => {}); await wait(1200);
        r.afterBuy = await page.evaluate(() => ({stars: document.querySelector('[data-game-hud="stars"] b')?.textContent, owned: document.querySelectorAll('.pks-sku[data-owned]').length}));
        r.wallet = service.store.game.read().wallet;
      }
      await page.evaluate(() => window.__pinkieStudyDesk.go('gamegacha')); await page.locator('.pks-pull').first().waitFor({timeout: 8000});
      await page.waitForFunction(() => document.querySelector('.pks-ga__alcove')?.dataset.mode !== 'loading', null, {timeout: 12000}); await wait(1200);
      await page.screenshot({path: path.join(out, `gacha-${tag}.png`)});
      r[`gachaMode-${theme}`] = await page.evaluate(() => document.querySelector('.pks-ga__alcove').dataset.mode);
      const ten = page.locator('.pks-pull.is-ten'); await ten.click();
      for (const ms of [500, 1300, 2300, 3300]) { await wait(ms - (ms > 500 ? [500, 1300, 2300][[1300, 2300, 3300].indexOf(ms)] : 0)); await page.screenshot({path: path.join(out, `gacha-pull-${tag}-${ms}.png`)}); }
      await page.locator('.pks-results').waitFor({timeout: 15000}).catch(() => {}); await wait(1400);
      await page.screenshot({path: path.join(out, `gacha-results-${tag}.png`)});
      await page.locator('.pks-results__ok').click().catch(() => {}); await wait(800);
      await page.evaluate(() => window.__pinkieStudyDesk.go('gamewardrobe')); await page.locator('.pks-tile').first().waitFor({timeout: 8000}); await wait(900);
      await page.screenshot({path: path.join(out, `wardrobe-${tag}.png`)});
      await page.evaluate(() => window.__pinkieStudyDesk.go('gamecodex')); await page.locator('.pks-dex__card').first().waitFor({timeout: 8000}); await wait(700);
      await page.screenshot({path: path.join(out, `codex-${tag}.png`)});
      await page.evaluate(() => window.__pinkieStudyDesk.go('today')); await wait(2200);
      await page.screenshot({path: path.join(out, `camp-after-shop-${tag}.png`)});
      await context.close();
    }
    r.pending = service.store.game.read().pending.length;
  } finally { await browser.close(); await close(); }
  fs.writeFileSync(path.join(out, 'shop.json'), JSON.stringify(r, null, 2)); console.log(JSON.stringify(r));
}

// 上岸之书：3D 立体书（翻页、节点四态、怪物、起雾）+ 平面版。节点状态在隔离 store 里直接摆好。
async function map() {
  const {harness, service, close} = await harnessWithGame();
  const browser = await launch(); const r = {};
  try {
    const game = service.store.game; const W = game.modules.world;
    const world = W.world({exam: 'pretco-b'});
    const first = world.regions[0];
    // 摆四种状态 + 起雾 + 怪：第一区 1 金章、2 点亮、3 已探索（起雾）、其余迷雾；怪占领第 2 个节点
    const ids = first.nodes.map(n => n.id);
    game.mutate(s => { W.ensure(s); s.nodes[ids[0]] = {...(s.nodes[ids[0]] || {}), explored: true, lit: true, gold: true}; s.nodes[ids[1]] = {...(s.nodes[ids[1]] || {}), explored: true, lit: true}; s.nodes[ids[2]] = {...(s.nodes[ids[2]] || {}), explored: true}; });
    W.fadeByRegion = () => ({[first.id]: {due: 4, ratio: .62}}); // 第一区一部分卡到期 → 起雾
    seedMonsters(service, MONSTER_SEEDS.slice(0, 2).map((m, i) => ({...m, node: ids[1 + i]})), {due: false});
    r.decorated = W.world({exam: 'pretco-b'}).regions[0].nodes.map(n => `${n.name}:${n.state}:${n.fade ?? 0}:${n.monsters}`);
    for (const theme of (opt('theme') ? [opt('theme')] : ['light', 'dark'])) {
      const width = Number(opt('width', 1440)), height = Math.round(width * 10 / 16), tag = `${theme}-${width}`;
      const {page, context} = await openPage(browser, harness, {width, height, theme, tier: opt('tier', 'standard')});
      await deskReady(page, 'gamemap'); await page.locator('.pkw-tab').first().waitFor({timeout: 10000});
      await page.waitForFunction(() => !document.querySelector('.pkw-canvas[data-loading]'), null, {timeout: 15000}).catch(() => {}); await wait(2600);
      await page.screenshot({path: path.join(out, `map-3d-${tag}.png`)});
      if (opt('quick')) { await context.close(); continue; }
      r[`fx-${theme}`] = await page.evaluate(() => ({scene: window.__pinkieGameFx.stats().scene, webgl: window.__pinkieGameFx.stats().webgl}));
      // 点第 2 个节点 → 卡片
      const pos = await page.evaluate(() => { const h = document.querySelector('.pkw-canvas'); return h ? h.getBoundingClientRect().toJSON() : null; });
      const pt = await page.evaluate(() => { const inst = window.__pinkieGameWorld._page?.handle()?.instance; const mk = inst && inst._markers?.()[1]; return mk ? inst.screenOf(mk) : null; });
      if (pt) { await page.mouse.click(pt.x, pt.y); await wait(1200); }
      r[`card-${theme}`] = !(await page.locator('.pkw-card[hidden]').count());
      await page.screenshot({path: path.join(out, `map-3d-card-${tag}.png`)});
      // 翻页到第二区
      await page.locator('.pkw-tab').nth(1).click(); await wait(500); await page.screenshot({path: path.join(out, `map-3d-flip-${tag}.png`)}); await wait(2400);
      await page.screenshot({path: path.join(out, `map-3d-region2-${tag}.png`)});
      // 空闲：翻页结束 + 浮尘停了以后零帧
      await wait(6500); r[`idle-${theme}`] = await page.evaluate(async () => { const a = window.__pinkieGameFx.stats().frames, raf = window.__rafCalls; await new Promise(res => setTimeout(res, 2000)); return {frames: window.__pinkieGameFx.stats().frames - a, raf: window.__rafCalls - raf}; });
      // 翻页慢放接触表（0.2 倍）：折下 → 翻页 → 立起 → 节点出现
      await page.evaluate(() => window.__pinkieGameFx._timeScale(.2)); await page.locator('.pkw-tab').nth(2).click();
      const frames = []; for (let k = 0; k < 12; k++) { const f = path.join(out, `_flip-${tag}-${k}.png`); await page.screenshot({path: f, clip: await page.locator('.pkw-stage').boundingBox()}); frames.push(f); await wait(820); }
      await page.evaluate(() => window.__pinkieGameFx._timeScale(1));
      try { const {execFileSync} = await import('node:child_process'); execFileSync('magick', ['montage', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', ...frames, '-tile', '4x', '-geometry', '640x+6+6', '-background', theme === 'dark' ? '#111' : '#eee', path.join(out, `map-flip-sheet-${tag}.png`)]); frames.forEach(f => fs.unlinkSync(f)); } catch (e) { console.warn('montage', e.message); }
      // 平面版
      await page.locator('.pkw-mode button', {hasText: '平面'}).click(); await page.locator('.pkw-tab').first().click(); await wait(900);
      await page.screenshot({path: path.join(out, `map-flat-${tag}.png`)});
      await context.close();
    }
  } finally { await browser.close(); await close(); }
  fs.writeFileSync(path.join(out, 'map.json'), JSON.stringify(r, null, 2)); console.log(JSON.stringify(r));
}

// 考场：在隔离 store 里放一份按 PRETCO_B_FORMAT 摆好的整卷（离线，不调模型）。
export async function seedPaper(service) {
  const {PRETCO_B_FORMAT} = await import('../../services/mode-architecture/learning-game-content.mjs');
  const ex = service.store.game.modules.exam;
  const choice = (stem, options, answer) => ({stem, options, answer});
  const bank = {
    'listen-response': i => ({...choice('(听录音选答案)', [['Yes, I do.', 'Sure, here you are.', 'No, thanks.', 'It is on the desk.'], ['At nine o’clock.', 'By bus.', 'For two hours.', 'Last week.'], ['Nice to meet you, too.', 'I’m fine.', 'Not at all.', 'Go ahead.'], ['It’s sunny.', 'It’s Monday.', 'It’s ten dollars.', 'It’s mine.'], ['Room 302.', 'Mr. Li.', 'Tomorrow.', 'Very well.']][i], i % 4), tts: ['Could you pass me the report, please?', 'How do you usually get to work?', 'Nice to meet you, Mr. Brown.', 'How much is this notebook?', 'Where is the meeting room?'][i]}),
    'listen-dialogue': i => ({...choice('What does the man mean?', ['He will be late.', 'He has finished the work.', 'He needs some help.', 'He forgot the time.'], i % 4), tts: 'W: Have you finished the sales report yet?\nM: Not yet. Could you give me a hand with the figures?'}),
    'listen-dictation': i => ({stem: ['Our company was founded in ____.', 'We now have more than ____ employees.', 'Our main products are ____.', 'We sell them to ____ countries.', 'Please ____ us if you have any questions.'][i], answer: [['1998'], ['500', 'five hundred'], ['office furniture'], ['twenty', '20'], ['contact']][i]}),
    'choice': i => choice(['The meeting has been ____ until next Friday.', 'She is used to ____ up early.', 'Neither Tom nor I ____ at home yesterday.', 'Please fill in the form and hand it ____ to the clerk.', 'This is the ____ hotel I have ever stayed in.', 'He asked me ____ I could help him.', 'The goods will be delivered ____ three days.', 'It was in this room ____ the agreement was signed.', 'You’d better ____ the doctor at once.', 'The price ____ the delivery charge.'][i], [['put off', 'put on', 'put up', 'put out'], ['get', 'getting', 'got', 'gets'], ['was', 'were', 'is', 'are'], ['in', 'on', 'off', 'out'], ['better', 'good', 'best', 'well'], ['that', 'if', 'what', 'which'], ['within', 'during', 'among', 'since'], ['which', 'where', 'that', 'when'], ['see', 'seeing', 'to see', 'saw'], ['includes', 'including', 'include', 'included']][i], [0, 1, 0, 0, 2, 1, 0, 2, 0, 0][i]),
    'word-form': i => ({stem: ['The new machine works more ____ than the old one.', 'We are looking forward to ____ from you.', 'The ____ of the bridge took two years.', 'He ____ the company since 2015.', 'This book is ____ than that one.', 'All the products must be ____ before delivery.', 'She spoke ____ at the conference.', 'The manager has ____ the plan.', 'We need a ____ answer by Monday.', 'Thank you for ____ me.'][i], base: ['efficient', 'hear', 'build', 'join', 'interesting', 'check', 'confident', 'approve', 'decide', 'help'][i], answer: [['efficiently'], ['hearing'], ['building'], ['has joined'], ['more interesting'], ['checked'], ['confidently'], ['approved'], ['decisive'], ['helping']][i]}),
    'passage-choice': i => choice(['What is the notice mainly about?', 'When will the library be closed?', 'Who should students contact?', 'What can we learn from the passage?', 'The word “renovation” probably means ____.'][i], [['A change in opening hours', 'A new book fair', 'A lost card', 'A job offer'], ['On Friday afternoon', 'On Monday morning', 'All next week', 'During holidays'], ['The teacher', 'The front desk', 'The manager', 'The cleaner'], ['The library is free', 'Books can be renewed online', 'Food is allowed', 'Cards are not needed'], ['repair work', 'new rules', 'price rise', 'a party']][i], [0, 0, 1, 1, 0][i]),
    'passage-short': i => ({stem: ['The writer bought the printer from ____.', 'The printer stopped working after ____.', 'The writer wants the company to ____ it.', 'The order number is ____.', 'The writer can be reached by ____.'][i], answer: [['an online store'], ['two days'], ['replace'], ['A3087'], ['email']][i]}),
    'term-match': i => ({stem: ['禁止吸烟', '请勿触摸', '紧急出口', '小心地滑', '营业时间'][i], answer: 'ACEFH'[i]}),
    'practical-fill': i => ({stem: ['Name of the hotel: ____', 'Date of arrival: ____', 'Type of room: ____', 'Number of nights: ____', 'Contact phone: ____'][i], answer: [['Sunrise Hotel'], ['May 6th'], ['double room'], ['three', '3'], ['0771-3456789']][i]}),
    'translate-choice': i => choice(['Please let me know if you have any questions.', 'The new rule will come into effect next month.', 'We have received your order and will ship it soon.', 'Smoking is not allowed in this building.'][i], [['如有疑问请告诉我。', '请让我知道你有没有问题。', '我会告诉你问题。', '你的问题请让我知道吗。'], ['新规定下个月生效。', '新规则下个月来。', '下个月会有新效果。', '新规则在下月起作用了。'], ['我们已收到您的订单，将尽快发货。', '我们收到了订单并很快运走。', '你的订单被收到，很快到。', '我们会收到订单。'], ['本楼禁止吸烟。', '这栋楼不允许吸。', '吸烟在楼里是不。', '楼里不能吸烟吗。']][i], 0),
    'translate-passage': () => ({stem: 'Dear customers,\nOur store will be closed from May 1st to May 3rd for the holiday. During this period, you can still place orders on our website, and all orders will be delivered after May 4th. We are sorry for any inconvenience and thank you for your support.', reference: '亲爱的顾客：本店 5 月 1 日至 3 日放假休息……', rubric: '意思准确 8 + 通顺 4'}),
    'writing': () => ({stem: '以王明的名义给 Smith 先生写一封感谢信：1. 感谢他上周带你参观工厂；2. 学到了很多关于产品质量管理的知识；3. 希望以后保持联系。词数 80–100。', reference: 'Dear Mr. Smith, ...', rubric: '五档'}),
  };
  const sections = PRETCO_B_FORMAT.sections.map(sec => ({id: sec.id, title: sec.title, timeMin: sec.timeMin, points: sec.points, instructions: sec.parts.map(p => p.note).join('；'),
    parts: sec.parts.map(p => ({id: p.id, kind: p.kind, note: p.note, each: p.each,
      material: {'listen-dictation': 'Welcome to Greenfield Company. Our company was founded in 1998. We now have more than 500 employees. Our main products are office furniture, and we sell them to twenty countries. Please contact us if you have any questions.', 'term-match': 'A — No Smoking\nB — Fragile\nC — Hands Off\nD — Keep Dry\nE — Emergency Exit\nF — Caution: Wet Floor\nG — Staff Only\nH — Business Hours\nI — Push\nJ — Lost and Found', 'passage-choice': 'NOTICE\nThe City Library will be closed on Friday afternoon for renovation. Books due on that day can be returned on Monday without a fine, or renewed online. For more information, please ask at the front desk.', 'passage-short': 'Dear Sir,\nI bought a printer (order number A3087) from your online store last week. It stopped working after two days. I would like you to replace it as soon as possible. You can reach me by email.\nYours faithfully,\nLinda', 'practical-fill': 'Room Booking\nHotel: Sunrise Hotel · Guest: Zhang Wei · Arrival: May 6th · Room: double room · Nights: 3 · Tel: 0771-3456789'}[p.kind] || '',
      items: Array.from({length: p.count}, (_, i) => bank[p.kind](i))}))}));
  const paperId = 'paper-qa-' + Date.now().toString(36);
  ex.writeFull({paperId, exam: 'pretco-b', createdAt: Date.now(), sections});
  service.store.game.mutate(state => { ex.ensure(state).papers[paperId] = {paperId, exam: 'pretco-b', title: 'B 级仿真卷 · 11-08', createdAt: Date.now(), status: 'ready'}; });
  return paperId;
}

// 考场 QA：大厅 → 开考 → 答题 → 自动保存 → 刷新恢复 → 交卷 → 阅卷 → Boss 结算（慢放接触表）→ 报告。
async function exam() {
  const {harness, service, close} = await harnessWithGame();
  const browser = await launch(); const r = {};
  const {execFileSync} = await import('node:child_process');
  const sheet = (frames, name, bg) => { try { execFileSync('magick', ['montage', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', ...frames, '-tile', '4x', '-geometry', '560x+5+5', '-background', bg, path.join(out, name)]); frames.forEach(f => fs.unlinkSync(f)); } catch (e) { console.warn('montage', e.message); } };
  try {
    for (const theme of (opt('theme') ? [opt('theme')] : ['light', 'dark'])) {
      await seedPaper(service);
      const width = Number(opt('width', 1440)), height = Math.round(width * 10 / 16), tag = `${theme}-${width}`;
      let {page, context} = await openPage(browser, harness, {width, height, theme, tier: opt('tier', 'standard')});
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      await deskReady(page, 'gameexam'); await page.locator('.pke-prow .pkg-btn').first().waitFor({timeout: 10000}); await wait(900);
      await page.screenshot({path: path.join(out, `exam-lobby-${tag}.png`)});
      if (opt('quick')) { await context.close(); continue; }
      await page.locator('.pke-prow .pkg-btn').first().click(); await page.locator('.pke-hall').waitFor({timeout: 10000}); await wait(800);
      r[`fx-during-${theme}`] = await page.evaluate(() => window.__pinkieGameFx?.stats?.().frames ?? null);
      // 答几道：选择题点第一个选项，填空写 test
      const t0 = Date.now(); await page.locator('.pke-opt').first().click(); r[`feedback-ms-${theme}`] = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => res(document.querySelector('.pke-opt[aria-checked="true"]') ? 1 : 0)))) ? Date.now() - t0 : -1;
      await page.locator('.pke-opt').nth(5).click(); await page.locator('.pke-fill').first().fill('1998'); await page.locator('.pke-flag').nth(2).click();
      await page.screenshot({path: path.join(out, `exam-hall-listening-${tag}.png`)});
      for (const [i, name] of [[1, 'vocab'], [2, 'reading'], [3, 'translation'], [4, 'writing']]) {
        await page.locator('.pke-tab').nth(i).click(); await wait(400);
        if (name === 'vocab') { await page.locator('.pke-opt').nth(1).click(); await page.locator('.pke-fill').first().fill('efficiently'); }
        if (name === 'reading') { await page.locator('.pke-opt').first().click(); await page.locator('.pke-letter').first().click(); }
        if (name === 'translation') { await page.locator('.pke-opt').first().click(); await page.locator('.pke-write').fill('亲爱的顾客：本店将于 5 月 1 日至 3 日放假休息。'); }
        if (name === 'writing') await page.locator('.pke-write').fill('Dear Mr. Smith, Thank you very much for showing me around your factory last week. I learned a lot about quality management. I hope we can keep in touch. Yours sincerely, Wang Ming');
        await wait(300); await page.screenshot({path: path.join(out, `exam-hall-${name}-${tag}.png`)});
      }
      // 自动保存
      await wait(16000); r[`saved-${theme}`] = await page.locator('.pke-save').textContent();
      const att = Object.values(service.store.game.read().exam.attempts).find(a => !a.submittedAt);
      r[`serverAnswers-${theme}`] = Object.keys(att?.answers || {}).length;
      // 刷新 → 接着考
      await page.reload(); await deskReady(page, 'gameexam'); await page.locator('.pke-prow button').first().click(); await page.locator('.pke-hall').waitFor({timeout: 10000}); await wait(700);
      r[`resumed-${theme}`] = {kicker: await page.locator('.pke-top__id small').textContent(), answeredCells: await page.locator('.pke-cell.is-done').count(), flags: await page.locator('.pke-cell.is-flag').count()};
      await page.screenshot({path: path.join(out, `exam-hall-resumed-${tag}.png`)});
      // 交卷
      await page.locator('.pke-submit').click(); await wait(500); await page.screenshot({path: path.join(out, `exam-submit-confirm-${tag}.png`)});
      await page.evaluate(() => window.__pinkieGameFx?._timeScale?.(1));
      await page.addStyleTag({content: '#pinkie-study-desk .pke-boss,#pinkie-study-desk .pke-boss *{animation-duration:calc(var(--d,1)*1s)}'}).catch(() => {});
      await page.locator('.pke-modal .pkg-btn').click();
      await page.locator('.pke-boss, .pke-grading').first().waitFor({timeout: 30000}); await page.screenshot({path: path.join(out, `exam-grading-${tag}.png`)});
      await page.locator('.pke-boss').waitFor({timeout: 60000});
      const frames = []; for (let k = 0; k < 12; k++) { const f = path.join(out, `_boss-${tag}-${k}.png`); await page.screenshot({path: f}); frames.push(f); await wait(450); }
      sheet(frames, `exam-boss-sheet-${tag}.png`, theme === 'dark' ? '#111' : '#eee');
      await page.locator('.pke-report').waitFor({timeout: 40000}); await wait(1600);
      await page.screenshot({path: path.join(out, `exam-report-${tag}.png`), fullPage: true});
      r[`result-${theme}`] = await page.locator('.pke-score b').textContent();
      r[`errors-${theme}`] = errs;
      await context.close();
    }
  } finally { await browser.close(); await close(); }
  fs.writeFileSync(path.join(out, 'exam.json'), JSON.stringify(r, null, 2)); console.log(JSON.stringify(r));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (cmd === 'exam') await exam();
  if (cmd === 'map') await map();
  if (cmd === 'shop') await shop();
  if (cmd === 'awards') await awards();
  if (cmd === 'shot') await shot();
  if (cmd === 'battle') await battle();
}
