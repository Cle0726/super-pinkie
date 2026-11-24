// 第 2 步录图：后台状态带的几种状态、按键的几种状态（日 / 夜各一遍）。用法：node film-keys.js <网址(不带 empty/night)> <输出目录> <0|1>
const pw = require('F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\node_modules\\playwright-core'); const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const [base, out, night] = process.argv.slice(2);
  fs.mkdirSync(out, {recursive: true}); for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), {recursive: true, force: true});
  const b = await pw.chromium.launch({headless: true, channel: 'chrome'});
  const ctx = await b.newContext({viewport: {width: 1440, height: 860}}); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await p.goto(base + '&empty=0&night=' + night); await p.waitForTimeout(5000);
  const shot = async (name, clip) => { await p.screenshot({path: path.join(out, name + '.png'), ...(clip ? {clip} : {})}); };
  const bandClip = async () => { const r = await p.evaluate(() => { const e = document.querySelector('.pk-metre-backstage'); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return {x: Math.max(0, b.left - 40), y: Math.max(0, b.top - 30), width: Math.min(1440, b.width + 80), height: b.height + 60}; }); return r; };
  const click = (id) => p.evaluate((id) => document.querySelector(`[data-preview-panel] [data-pv="${id}"]`)?.click(), id);
  const band = async (name) => { const c = await bandClip(); await shot('band-' + name, c || {x: 300, y: 0, width: 1000, height: 140}); const t = await p.evaluate(() => document.querySelector('.pk-metre-backstage')?.innerText || '(没有带子)'); console.log('band', name, '|', t.replace(/\s+/g, ' ')); };
  await shot('00-chat'); await band('ok-initial');
  for (const [id, wait] of [['bs-ok', 1500], ['bs-reconnect', 1500], ['bs-down', 1500], ['bs-ok', 1200], ['bs-queue', 1500], ['bs-engines', 2500]]) { await click(id); await p.waitForTimeout(wait); await band(id); }
  await click('bs-ok'); await p.waitForTimeout(800);
  await click('bs-unsync'); await p.waitForTimeout(1200); await band('unsync-1s'); await p.waitForTimeout(2600); await band('unsync-4s');
  console.log('pane state', await p.evaluate(() => { const s = document.querySelector('openclaw-chat-pane')?.state; return JSON.stringify({run: s?.chatRunId, stream: s?.chatStream, sending: s?.chatSending}); }));
  await p.waitForTimeout(1500); await band('unsync-6s');
  await p.evaluate(() => document.querySelector('.pk-bs__sync')?.click()); await p.waitForTimeout(150); await band('sync-clicked');
  await p.waitForTimeout(2500); await band('after-sync');
  // 按键：发送键（禁用 / 悬停 / 按下 / 焦点）、运行中（停止键）
  const send = 'openclaw-chat-pane .agent-chat__input button.chat-send-btn';
  const sc = async () => { const r = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left - 120, y: b.top - 40, width: b.width + 160, height: b.height + 70}; }, send); return r; };
  let c = await sc(); if (c) await shot('key-send-normal', c);
  await p.locator('.agent-chat__composer-combobox textarea').first().fill('试一下按键').catch(() => {});
  c = await sc(); if (c) { await shot('key-send-ready', c); await p.hover(send).catch(() => {}); await p.waitForTimeout(200); await shot('key-send-hover', c);
    await p.mouse.down(); await p.waitForTimeout(120); await shot('key-send-press', c); await p.mouse.move(5, 5); await p.mouse.up(); }
  await p.locator('.agent-chat__composer-combobox textarea').first().fill('').catch(() => {});
  await p.evaluate((s) => document.querySelector(s)?.focus(), send); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  c = await sc(); if (c) await shot('key-send-focus', c);
  await click('keys-run'); await p.waitForTimeout(700); c = await sc(); if (c) { await shot('key-stop-run-a', c); await p.waitForTimeout(417); await shot('key-stop-run-b', c); }
  await click('bs-ok'); await p.waitForTimeout(600);
  // 总谱头上的「暂停分谱 / 全体收住」和声部上的键
  await click('keys-board'); await p.waitForTimeout(1200); await shot('board');
  const bb = await p.evaluate(() => { const e = document.querySelector('.pk-metre-board__btn--stop'); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left - 160, y: b.top - 20, width: b.width + 200, height: b.height + 40}; });
  if (bb) { await shot('key-board-normal', bb); await p.hover('.pk-metre-board__btn--stop').catch(() => {}); await p.waitForTimeout(200); await shot('key-board-hover', bb); }
  console.log('errors:', errs.length ? errs.join(' || ') : 'none');
  await b.close();
})().catch((e) => { console.log('ERR', e); process.exit(1); });
