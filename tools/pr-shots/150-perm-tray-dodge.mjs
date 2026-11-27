#!/usr/bin/env node
// #150 续做（mac2 #150 issuecomment-7183750963）的 PR 截图脚本，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/150-perm-tray-dodge.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI + Metre（tests/visual/lib/real-harness.mjs 的 metre-board 场景，关掉看板），和 mac2 的 B 路一样：
// 320 宽时「⋯」为躲右下角的麦克风（button.chat-send-btn / #laolao-native-dictation）让到行首，改前又落在左下角
// 浮着的托盘键 button.pinkie-tray-btn 底下，点中心打不开会话详情。360 宽作对照（改前就正常）。
// 每格（320 / 360 × 日 / 夜）拍三张：按键行（输入区）、点「⋯」中心后的整页、关掉详情后再 fit 一次的按键行（refit-row）；
// shots.jsonl 每行另记 fold / dodge / padLeft / statHit（「⋯」中心点下去是不是它自己）/ top（中心点最上层是谁）/ coveredBy / opened。
// report.json 另记 refit（再 fit 后的状态）和 forced（临时排到行首量一次的位置、被谁盖、按键行右沿，量完即还原）。
// 最后再把同一页放宽到 820 量一次，记下放宽后是否回到原位（fold 0、没有 data-dodge、没有让位距离）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = await import(pathToFileURL(path.join(root, 'tests/visual/lib/real-harness.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const HEIGHT = 900;
const lines = [], report = [];

const record = (name, file, extra) => {
  const buf = fs.readFileSync(path.join(out, file));
  // PNG IHDR：宽在 16–19 字节，高在 20–23 字节
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};
const shoot = async (page, name, sel, extra) => {
  const file = `${name}.png`;
  const target = sel ? page.locator(sel).first() : null;
  if (target && await target.count()) await target.screenshot({path: path.join(out, file)});
  else await page.screenshot({path: path.join(out, file)});
  record(name, file, extra);
};

// 量「⋯」：位置、中心点的 elementsFromPoint 栈、哪些浮着的键盖住了它、按键行（controls）的右沿。
// force=true：同一个任务里临时排到行首（data-dodge=1、去掉让位距离）同步量一次，量完原样还原；
// 只在 refit 之后、放宽之前用一次，给「让到行首后会被谁盖、让不让得开」留数据（uireview 2026-11-27T01:58Z）。
const probe = (force) => {
  const R = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  const name = (n) => n ? (n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '')) : null;
  const box = document.querySelector('.chat-main .agent-chat__composer-controls > .pk-perm-chips');
  const stat = box?.querySelector('.pk-perm-chip--stat');
  const input = box?.closest('.agent-chat__input');
  if (!stat) return {found: false};
  const saved = force ? {dodge: box.dataset.dodge, pad: box.style.paddingLeft} : null;
  // force 是数字时再临时加这么多 px 的 padding-left，看真页面（父级 display: contents、本截是输入框 grid 的子项）里让位到底推不推得动「⋯」
  if (force) { box.dataset.dodge = '1'; box.style.paddingLeft = typeof force === 'number' ? force + 'px' : ''; }
  try {
    const r = stat.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const floats = [...(input?.querySelectorAll('button, summary, [role="button"]') || [])].filter((b) => !b.closest('.pk-perm-chips') && /^(?:absolute|fixed)$/.test(getComputedStyle(b).position))
      .map((b) => ({el: name(b), rect: R(b.getBoundingClientRect()), b: b.getBoundingClientRect()})).filter((f) => f.b.width > 0 && f.b.height > 0);
    const coveredBy = floats.filter((f) => Math.min(r.right, f.b.right) - Math.max(r.left, f.b.left) > 1 && Math.min(r.bottom, f.b.bottom) - Math.max(r.top, f.b.top) > 1).map((f) => f.el);
    const controls = box.parentElement?.getBoundingClientRect();
    return {found: true, forced: Boolean(force), fold: box.dataset.fold ?? null, dodge: box.dataset.dodge ?? null, padLeft: box.style.paddingLeft || null, label: stat.textContent.trim(),
      stat: R(r), center: [cx, cy], statHit: Boolean(top && stat.contains(top)), top: name(top),
      stack: document.elementsFromPoint(cx, cy).slice(0, 6).map(name), coveredBy, floats: floats.map(({el, rect}) => ({el, rect})),
      chips: R(box.getBoundingClientRect()), controls: controls ? R(controls) : null, controlsRight: controls ? Math.round(controls.right) : null,
      inputH: input ? Math.round(input.getBoundingClientRect().height) : null, inputRight: input ? Math.round(input.getBoundingClientRect().right) : null};
  } finally {
    if (saved) {
      if (saved.dodge === undefined) delete box.dataset.dodge; else box.dataset.dodge = saved.dodge;
      box.style.paddingLeft = saved.pad;
    }
  }
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    for (const width of [320, 360]) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
      const base = `150b-${width}-${theme}`;
      try {
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForSelector('.chat-main .agent-chat__composer-controls > .pk-perm-chips', {state: 'attached', timeout: 15_000});
        await page.evaluate(() => window.PinkieMetrePerm?.fit?.());
        await page.waitForTimeout(1800);   // fitSoon 会在 60 / 400 / 1500ms 再量
        const row = await page.evaluate(probe);
        const {center, ...rec} = row;
        await page.mouse.move(0, 0);
        await shoot(page, `${base}-row`, '.chat-main .agent-chat__input', rec);
        let opened = false;
        if (center) {
          await page.mouse.click(...center);
          opened = await page.waitForSelector('.pk-perm-pop--detail', {timeout: 3000}).then(() => true, () => false);
        }
        await page.mouse.move(0, 0);
        await shoot(page, `${base}-detail`, null, {...rec, opened});
        await page.keyboard.press('Escape');
        // refit：麦克风等浮键可能在最后一次 fit 之后才到位、输入框高度没变就不会再量；手动再量一次看最终状态
        await page.evaluate(() => window.PinkieMetrePerm?.fit?.());
        await page.waitForTimeout(1800);
        const {center: _rc, ...refit} = await page.evaluate(probe);
        await page.mouse.move(0, 0);
        await shoot(page, `${base}-refit-row`, '.chat-main .agent-chat__input', {...refit, refit: true});
        // 临时排到行首量一次（同步还原，不拍图）：让到行首后会被谁盖、按键行右沿在哪
        const {center: _fc, ...forced} = await page.evaluate(probe, true);
        // 再临时加 40px 让位量一次：看 padding-left 在真页面上推不推得动「⋯」（同步还原，不拍图）
        const {center: _pc, ...forcedPad} = await page.evaluate(probe, 40);
        // 页面实际加载的 laolao-metre-perm.js 里有没有 clearCover 的 display: contents 兜底（af7ac0a2 的修复）
        const loaded = await page.evaluate(async () => {
          const src = [...document.scripts].map((s) => s.src).find((u) => /laolao-metre-perm\.js/.test(u)) || null;
          if (!src) return {src: null, hasFix: null};
          try { const t = await (await fetch(src)).text(); return {src, hasFix: /c\.width > 0 \? c\.right : input\.getBoundingClientRect\(\)\.right/.test(t)}; }
          catch (e) { return {src, hasFix: null, error: String(e)}; }
        });
        // 放宽：回到原位
        await page.setViewportSize({width: 820, height: HEIGHT});
        await page.evaluate(() => window.PinkieMetrePerm?.fit?.());
        await page.waitForTimeout(1800);
        const wide = await page.evaluate(probe);
        report.push({theme, width, row: rec, opened, refit, forced, forcedPad, loaded, wide: {fold: wide.fold, dodge: wide.dodge, padLeft: wide.padLeft, statHit: wide.statHit}, pageErrors});
      } catch (error) {
        report.push({theme, width, error: error.message, pageErrors});
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) {
  if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} 出错：${r.error}`);
  else {
    const cov = (p) => (p?.coveredBy?.length ? p.coveredBy.join('+') : '-');
    console.log(`pr-shots: ${r.theme} ${r.width} fold=${r.row.fold} dodge=${r.row.dodge} pad=${r.row.padLeft} statHit=${r.row.statHit} top=${r.row.top} coveredBy=${cov(r.row)} opened=${r.opened}`
      + ` | refit dodge=${r.refit?.dodge} pad=${r.refit?.padLeft} statHit=${r.refit?.statHit} top=${r.refit?.top} coveredBy=${cov(r.refit)}`
      + ` | forced stat=${JSON.stringify(r.forced?.stat)} coveredBy=${cov(r.forced)} controlsRight=${r.forced?.controlsRight} inputRight=${r.forced?.inputRight}`
      + ` | pad40 stat=${JSON.stringify(r.forcedPad?.stat)} chips=${JSON.stringify(r.forcedPad?.chips)} coveredBy=${cov(r.forcedPad)} statHit=${r.forcedPad?.statHit}`
      + ` | loaded hasFix=${r.loaded?.hasFix} src=${r.loaded?.src ? r.loaded.src.replace(/^.*\//, '') : null}`
      + ` | 820 fold=${r.wide.fold} dodge=${r.wide.dodge} pad=${r.wide.padLeft}`);
  }
}
