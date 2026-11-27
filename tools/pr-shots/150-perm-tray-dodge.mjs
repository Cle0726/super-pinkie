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
// 正反对照（#273 win-coord issuecomment-7211904180）：每格开两次页，head = 当前头；main = 同一页但 laolao-metre-perm.js 换成
// 合后 main（不带本单）那份，其余注入、CSS、夹具都一样。report 里 loaded.hasFix 能看出页面实际跑的是哪份。
// noanchor 档（#273 uireview issuecomment-7212133738）：#271 B28 在 laolao-metre-skin.css:714 用 @supports (anchor-name) 把托盘键、
// 发送键锚到 composer 下沿，支持锚点的 Chromium 上碰不到托盘键；不支持的引擎（mac2 最早报的 WKWebView）退回 :903 / :904 / :960 的
// bottom: 49px。这一档在页面 CSSOM 里临时删掉那条 @supports 规则造出碰撞，量 fold / dodge / shift / firstMl / stat / statHit / coveredBy，
// 点「⋯」看详情开不开，再把规则插回原处。生产布局不动。
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

// 合后 main 的 laolao-metre-perm.js：CI 上只 checkout 了 PR 头、没有 main 的历史，按固定 SHA 从公开仓库取，核对 sha256 再用
// （main 39bc8763 上这个文件和本单分出去的 6e4ea1cc 上逐字节相同）。
const BASE = {sha: '39bc8763ca49bf83569276488bc70b7216a9ab42', sha256: '4968b20fceb4782ff483dd339905674716935546b09c28e094d7c55c8700781b'};
const baseSrc = await (async () => {
  const url = `https://raw.githubusercontent.com/Cle0726/super-pinkie/${BASE.sha}/ui/injections/laolao-metre-perm.js`;
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      if (got !== BASE.sha256) throw new Error(`sha256 ${got}，应为 ${BASE.sha256}`);
      return buf.toString('utf8');
    } catch (error) { last = error; await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw new Error(`取不到 main@${BASE.sha.slice(0, 8)} 的 laolao-metre-perm.js：${last?.message}`);
})();

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
  // 让位距离现在加在第一个键的 margin-left 上、记在 data-shift（clearCover 的 setShift）：force 时一并清掉，量完原样还原
  const first = box.querySelector('.pk-perm-chip');
  const saved = force ? {dodge: box.dataset.dodge, pad: box.style.paddingLeft, shift: box.dataset.shift, firstMl: first?.style.marginLeft || ''} : null;
  // force 是数字时再临时加这么多 px 的 padding-left，看真页面（父级 display: contents、本截是输入框 grid 的子项）里让位到底推不推得动「⋯」
  if (force) { box.dataset.dodge = '1'; box.style.paddingLeft = typeof force === 'number' ? force + 'px' : ''; delete box.dataset.shift; first?.style.removeProperty('margin-left'); }
  try {
    const r = stat.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const floats = [...(input?.querySelectorAll('button, summary, [role="button"]') || [])].filter((b) => !b.closest('.pk-perm-chips') && /^(?:absolute|fixed)$/.test(getComputedStyle(b).position))
      .map((b) => ({el: name(b), rect: R(b.getBoundingClientRect()), b: b.getBoundingClientRect()})).filter((f) => f.b.width > 0 && f.b.height > 0);
    const coveredBy = floats.filter((f) => Math.min(r.right, f.b.right) - Math.max(r.left, f.b.left) > 1 && Math.min(r.bottom, f.b.bottom) - Math.max(r.top, f.b.top) > 1).map((f) => f.el);
    // force 是数字时：在真页面样式表里找所有匹配 chips、设了 padding-left 的规则（含 @media / @layer 里的），看是谁把内联 padding-left 压成 0
    const padRules = [];
    if (typeof force === 'number') {
      const walk = (list, sheet) => {
        for (const r of list) {
          if (r.cssRules) walk(r.cssRules, sheet);   // @media / @layer / CSS 嵌套规则里的子规则也看
          if (!r.selectorText) continue;
          if (!r.selectorText || !r.style) continue;
          const v = r.style.getPropertyValue('padding-left') || r.style.getPropertyValue('padding-inline-start');
          if (!v) continue;
          let hit = false; try { hit = box.matches(r.selectorText); } catch {}
          if (hit) padRules.push({sheet, sel: r.selectorText.slice(0, 240), v, imp: r.style.getPropertyPriority('padding-left') || r.style.getPropertyPriority('padding-inline-start') || ''});
        }
      };
      // document.styleSheets 之外再看 adoptedStyleSheets（构造样式表）；读不到 cssRules 的跨源表记下来
      const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || []).map((s) => Object.assign(s, {__adopted: true}))];
      for (const sh of sheets) {
        const label = sh.__adopted ? 'adopted' : (sh.href || 'inline').replace(/^.*\//, '');
        let rules; try { rules = sh.cssRules; } catch { padRules.push({sheet: label, blocked: true}); continue; }
        walk(rules, label);
      }
    }
    const inlineStyle = box.getAttribute('style');
    const controls = box.parentElement?.getBoundingClientRect();
    return {found: true, forced: Boolean(force), fold: box.dataset.fold ?? null, dodge: box.dataset.dodge ?? null, padLeft: box.style.paddingLeft || null, shift: box.dataset.shift ?? null, firstMl: first?.style.marginLeft || null, label: stat.textContent.trim(),
      stat: R(r), center: [cx, cy], statHit: Boolean(top && stat.contains(top)), top: name(top),
      stack: document.elementsFromPoint(cx, cy).slice(0, 6).map(name), coveredBy, floats: floats.map(({el, rect}) => ({el, rect})),
      chips: R(box.getBoundingClientRect()), controls: controls ? R(controls) : null, controlsRight: controls ? Math.round(controls.right) : null,
      inputH: input ? Math.round(input.getBoundingClientRect().height) : null, inputRight: input ? Math.round(input.getBoundingClientRect().right) : null,
      // 计算样式：看真页面上 padding-left 为什么推不动「⋯」（9c94ea4d run 45943798642：pad40 时 chips 变宽、「⋯」不动）
      boxCss: (({display, paddingLeft, boxSizing, justifyContent, flexDirection, width, gridColumn, gridColumnStart, gridColumnEnd, direction}) => ({display, paddingLeft, boxSizing, justifyContent, flexDirection, width, gridColumn, gridColumnStart, gridColumnEnd, direction}))(getComputedStyle(box)),
      statCss: (({position, left, right, marginLeft, translate, transform, display, gridColumn}) => ({position, left, right, marginLeft, translate, transform, display, gridColumn}))(getComputedStyle(stat)),
      statParent: name(stat.parentElement), padRules, inlineStyle};
  } finally {
    if (saved) {
      if (saved.dodge === undefined) delete box.dataset.dodge; else box.dataset.dodge = saved.dodge;
      box.style.paddingLeft = saved.pad;
      if (saved.shift === undefined) delete box.dataset.shift; else box.dataset.shift = saved.shift;
      if (first) first.style.marginLeft = saved.firstMl;
    }
  }
};

// noanchor 档第 1 步：删掉页面 CSSOM 里条件含 anchor-name 的 @supports 规则（含 @media / @layer 里嵌着的），记下删了几条、
// 删前删后托盘键和发送键计算出来的 bottom；删掉的规则和原位置留在 window.__pkNoAnchor，第 4 步原样插回
const cutAnchor = () => {
  const css = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return {bottom: s.bottom, positionAnchor: s.positionAnchor || null, rect: (({left, top, width, height}) => [left, top, width, height].map(Math.round))(el.getBoundingClientRect())}; };
  const TRAY = '.chat-main .agent-chat__input .pinkie-tray-btn', SEND = '.chat-main .agent-chat__input button.chat-send-btn';
  const before = {tray: css(TRAY), send: css(SEND)};
  const removed = [];
  let blocked = 0;
  // 从后往前删，插回时按删的反序（下标从小到大）插，位置就和原来一样
  const walk = (owner, list, where) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (typeof CSSSupportsRule !== 'undefined' && r instanceof CSSSupportsRule && /anchor-name/.test(r.conditionText)) {
        removed.push({owner, index: i, text: r.cssText, where});
        owner.deleteRule(i);
        continue;
      }
      if (r.cssRules && typeof r.deleteRule === 'function') walk(r, r.cssRules, where);
    }
  };
  for (const sh of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
    let rules; try { rules = sh.cssRules; } catch { blocked++; continue; }
    walk(sh, rules, (sh.href || 'inline').replace(/^.*\//, ''));
  }
  window.__pkNoAnchor = removed;
  return {removed: removed.length, where: removed.map((r) => r.where), blocked, before, after: {tray: css(TRAY), send: css(SEND)}};
};
// noanchor 档第 4 步：把删掉的规则插回原处，看托盘键回没回到锚点位置
const putAnchor = () => {
  const list = window.__pkNoAnchor || [];
  let restored = 0; const errors = [];
  for (const r of [...list].reverse()) { try { r.owner.insertRule(r.text, r.index); restored++; } catch (e) { errors.push(String(e)); } }
  delete window.__pkNoAnchor;
  const el = document.querySelector('.chat-main .agent-chat__input .pinkie-tray-btn');
  return {restored, errors, trayBottom: el ? getComputedStyle(el).bottom : null};
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
// main 档：openRealScenePage 自己开 context 再导航，这里在它开 context 时先挂上路由，把 laolao-metre-perm.js 换成 main 那份；
// 别的属性和方法原样转给真的 browser（夹具不改）
const mainBrowser = new Proxy(browser, {
  get(target, prop) {
    if (prop === 'newContext') {
      return async (...a) => {
        const context = await target.newContext(...a);
        await context.route(/\/laolao-metre-perm\.js(?:\?|$)/, (route) => route.fulfill({status: 200, contentType: 'application/javascript; charset=utf-8', body: baseSrc}));
        return context;
      };
    }
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
try {
  for (const variant of ['head', 'main']) for (const theme of ['day', 'night']) {
    for (const width of [320, 360]) {
      const {context, page, pageErrors} = await H.openRealScenePage(variant === 'main' ? mainBrowser : browser, server.origin, 'metre-board', theme);
      const base = `150b-${variant}-${width}-${theme}`;
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
        // 直接试三种让位 40px 的办法，看哪种在真页面上推得动「⋯」（每种量完同步还原，不拍图）
        const shifts = await page.evaluate(() => {
          const box = document.querySelector('.chat-main .agent-chat__composer-controls > .pk-perm-chips');
          const stat = box?.querySelector('.pk-perm-chip--stat');
          if (!stat) return null;
          const first = box.querySelector('.pk-perm-chip');
          const saved = {dodge: box.dataset.dodge, style: box.getAttribute('style'), firstStyle: first.getAttribute('style')};
          const measure = () => {
            const r = stat.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {x: Math.round(r.left), y: Math.round(r.top), statHit: Boolean(top && stat.contains(top))};
          };
          const restore = () => {
            if (saved.dodge === undefined) delete box.dataset.dodge; else box.dataset.dodge = saved.dodge;
            if (saved.style == null) box.removeAttribute('style'); else box.setAttribute('style', saved.style);
            if (saved.firstStyle == null) first.removeAttribute('style'); else first.setAttribute('style', saved.firstStyle);
            box.querySelector(':scope > .pk-shot-spacer')?.remove();
          };
          const out = {};
          const run = (k, apply) => { box.dataset.dodge = '1'; try { apply(); out[k] = measure(); } catch (e) { out[k] = {error: String(e)}; } finally { restore(); } };
          run('none', () => {});
          run('padImportant', () => box.style.setProperty('padding-left', '40px', 'important'));
          run('firstMargin', () => first.style.setProperty('margin-left', '50px', 'important'));
          run('spacer', () => { const s = document.createElement('span'); s.className = 'pk-shot-spacer'; s.style.cssText = 'display:inline-block;flex:none;width:40px;height:1px'; box.prepend(s); });
          return out;
        });
        // 页面实际加载的 laolao-metre-perm.js 里有没有 clearCover 的 display: contents 兜底（af7ac0a2 的修复）
        const loaded = await page.evaluate(async () => {
          const src = [...document.scripts].map((s) => s.src).find((u) => /laolao-metre-perm\.js/.test(u)) || null;
          if (!src) return {src: null, hasFix: null};
          // hasFix：display: contents 兜底（af7ac0a2）和第一个键 margin-left 让位（setShift）都在
          try { const t = await (await fetch(src)).text(); return {src, hasFix: /c\.width > 0 \? c\.right : input\.getBoundingClientRect\(\)\.right/.test(t) && /setShift\(box, shiftOf\(box\) \+ need\)/.test(t)}; }
          catch (e) { return {src, hasFix: null, error: String(e)}; }
        });
        // noanchor 档：删掉 @supports (anchor-name) 规则造出碰撞 → 重新 fit → 量 → 点「⋯」→ 插回规则（uireview 7212133738 第 1–4 步）
        let noanchor = null;
        try {
          const cut = await page.evaluate(cutAnchor);
          await page.evaluate(() => { window.dispatchEvent(new Event('resize')); window.PinkieMetrePerm?.fit?.(); });
          await page.waitForTimeout(1800);
          const {center: naCenter, ...na} = await page.evaluate(probe);
          await page.mouse.move(0, 0);
          await shoot(page, `${base}-noanchor-row`, '.chat-main .agent-chat__input', {...na, noanchor: true});
          let naOpened = false;
          if (naCenter) {
            await page.mouse.click(...naCenter);
            naOpened = await page.waitForSelector('.pk-perm-pop--detail', {timeout: 3000}).then(() => true, () => false);
          }
          await page.mouse.move(0, 0);
          await shoot(page, `${base}-noanchor-detail`, null, {...na, noanchor: true, opened: naOpened});
          await page.keyboard.press('Escape');
          const put = await page.evaluate(putAnchor);
          await page.evaluate(() => window.PinkieMetrePerm?.fit?.());
          await page.waitForTimeout(1800);
          const after = await page.evaluate(probe);
          noanchor = {cut, row: na, opened: naOpened, put, after: {fold: after.fold, dodge: after.dodge, shift: after.shift, firstMl: after.firstMl, statHit: after.statHit, coveredBy: after.coveredBy}};
        } catch (error) {
          noanchor = {error: String(error?.message || error)};
          await page.evaluate(putAnchor).catch(() => {});
        }
        // 放宽：回到原位
        await page.setViewportSize({width: 820, height: HEIGHT});
        await page.evaluate(() => window.PinkieMetrePerm?.fit?.());
        await page.waitForTimeout(1800);
        const wide = await page.evaluate(probe);
        report.push({variant, theme, width, row: rec, opened, refit, forced, forcedPad, shifts, loaded, noanchor, wide: {fold: wide.fold, dodge: wide.dodge, padLeft: wide.padLeft, shift: wide.shift, statHit: wide.statHit}, pageErrors});
      } catch (error) {
        report.push({variant, theme, width, error: error.message, pageErrors});
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
const cov = (p) => (p?.coveredBy?.length ? p.coveredBy.join('+') : '-');
// 正反对照一览：每格 head / main 的常态与 noanchor 档各一行
for (const r of report) {
  if (r.error) { console.log(`pr-shots: [对照] ${r.variant} ${r.theme} ${r.width} 出错：${r.error}`); continue; }
  const n = r.noanchor || {};
  console.log(`pr-shots: [对照] ${r.variant} ${r.theme} ${r.width} hasFix=${r.loaded?.hasFix}`
    + ` | 常态 fold=${r.refit?.fold} dodge=${r.refit?.dodge} shift=${r.refit?.shift} statHit=${r.refit?.statHit} coveredBy=${cov(r.refit)} opened=${r.opened}`
    + (n.error ? ` | noanchor 出错：${n.error}`
      : ` | noanchor 删=${n.cut?.removed}(${(n.cut?.where || []).join(',')}) trayBottom=${n.cut?.before?.tray?.bottom}→${n.cut?.after?.tray?.bottom} sendBottom=${n.cut?.before?.send?.bottom}→${n.cut?.after?.send?.bottom}`
        + ` fold=${n.row?.fold} dodge=${n.row?.dodge} shift=${n.row?.shift} firstMl=${n.row?.firstMl} stat=${JSON.stringify(n.row?.stat)} statHit=${n.row?.statHit} top=${n.row?.top} coveredBy=${cov(n.row)} opened=${n.opened}`
        + ` | 插回=${n.put?.restored} trayBottom=${n.put?.trayBottom} 插回后 dodge=${n.after?.dodge} shift=${n.after?.shift} statHit=${n.after?.statHit}`));
}
for (const r of report) {
  if (r.error) console.log(`pr-shots: ${r.variant} ${r.theme} ${r.width} 出错：${r.error}`);
  else {
    console.log(`pr-shots: ${r.variant} ${r.theme} ${r.width} fold=${r.row.fold} dodge=${r.row.dodge} pad=${r.row.padLeft} shift=${r.row.shift} firstMl=${r.row.firstMl} stat=${JSON.stringify(r.row.stat)} statHit=${r.row.statHit} top=${r.row.top} coveredBy=${cov(r.row)} opened=${r.opened}`
      + ` | refit dodge=${r.refit?.dodge} pad=${r.refit?.padLeft} shift=${r.refit?.shift} firstMl=${r.refit?.firstMl} stat=${JSON.stringify(r.refit?.stat)} statHit=${r.refit?.statHit} top=${r.refit?.top} coveredBy=${cov(r.refit)}`
      + ` | forced stat=${JSON.stringify(r.forced?.stat)} coveredBy=${cov(r.forced)} controlsRight=${r.forced?.controlsRight} inputRight=${r.forced?.inputRight}`
      + ` | pad40 stat=${JSON.stringify(r.forcedPad?.stat)} chips=${JSON.stringify(r.forcedPad?.chips)} coveredBy=${cov(r.forcedPad)} statHit=${r.forcedPad?.statHit}`
      + ` | loaded hasFix=${r.loaded?.hasFix} src=${r.loaded?.src ? r.loaded.src.replace(/^.*\//, '') : null}`
      + ` | pad40 boxCss=${JSON.stringify(r.forcedPad?.boxCss)} statCss=${JSON.stringify(r.forcedPad?.statCss)} statParent=${r.forcedPad?.statParent}`
      + ` | pad40 inlineStyle=${JSON.stringify(r.forcedPad?.inlineStyle)} padRules=${JSON.stringify(r.forcedPad?.padRules)}`
      + ` | shifts=${JSON.stringify(r.shifts)}`
      + ` | 820 fold=${r.wide.fold} dodge=${r.wide.dodge} pad=${r.wide.padLeft} shift=${r.wide.shift}`);
  }
}
