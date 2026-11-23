// 返工自查：三种窗口 × 日夜 × 六种状态，截整窗（预览面板藏起来），量后台带和每个元素的位置。
// 用法：node va2.js <网址(不带 empty/night)> <输出目录> [尺寸,逗号分隔 如 1440x860,1024x720,820x640] [夜 0,1]
const pw = require('F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\node_modules\\playwright-core'); const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const [base, out, sizesArg = '1440x860,1024x720,820x640', nightsArg = '0,1'] = process.argv.slice(2);
  fs.mkdirSync(out, {recursive: true});
  const b = await pw.chromium.launch({headless: true, channel: 'chrome'});
  const report = [];
  for (const size of sizesArg.split(',')) for (const night of nightsArg.split(',')) {
    const [w, h] = size.split('x').map(Number);
    const ctx = await b.newContext({viewport: {width: w, height: h}}); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) errs.push(String(e).slice(0, 300)); });
    await p.goto(base + '&empty=0&night=' + night); await p.waitForTimeout(5000);
    const click = (id) => p.evaluate((id) => document.querySelector(`[data-preview-panel] [data-pv="${id}"]`)?.click(), id);
    const measure = (state) => p.evaluate((state) => {
      const R = (e) => { const r = e.getBoundingClientRect(); return {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom)}; };
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)');
      const res = {state, band: null, overlaps: [], overlapsVisible: [], clipped: [], bandOverflow: false, contrast: [], gaps: [], chips: []};
      const panel = document.querySelector('[data-preview-panel]');
      if (!band || band.hidden || !band.getClientRects().length) { res.band = {hidden: true}; }
      else {
        const br = band.getBoundingClientRect();
        res.band = {...R(band), hidden: false, gapBottom: Math.round(innerHeight - br.bottom), gapComposer: (() => { const c = document.querySelector('.agent-chat__input'); return c && c.getClientRects().length ? Math.round(br.top - c.getBoundingClientRect().bottom) : null; })(), tier: band.dataset.tier, text: band.innerText.replace(/\s+/g, ' ').trim(), inViewport: br.left >= 0 && br.top >= 0 && br.right <= innerWidth && br.bottom <= innerHeight};
        res.bandOverflow = band.scrollWidth > band.clientWidth + 1 || band.scrollHeight > band.clientHeight + 1;
        const cands = [...document.querySelectorAll('p, button, a, code, pre, li, h1, h2, h3, h4, h5, label, time, input, textarea, img, svg, canvas:not(.pk-metre-backdrop):not(.pk-metre-lights), [role=button], span')]
          .filter((e) => !band.contains(e) && !panel?.contains(e) && !e.closest('.pk-bs__pop'));
        for (const e of cands) {
          const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (e.tagName === 'SPAN' && (e.children.length || !(e.textContent || '').trim())) continue;
          const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
          const ix = Math.min(r.right, br.right) - Math.max(r.left, br.left), iy = Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top);
          if (ix <= 0.5 || iy <= 0.5) continue;
          const name = e.tagName + ':' + String(e.getAttribute('aria-label') || e.textContent || (typeof e.className === 'string' ? e.className : '') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
          res.overlaps.push(name);
          // 能看见的那一块（被滚动区裁掉的不算）
          let vr = {l: r.left, t: r.top, r: r.right, b: r.bottom};
          for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowY + s.overflowX)) { const q = a.getBoundingClientRect(); vr = {l: Math.max(vr.l, q.left), t: Math.max(vr.t, q.top), r: Math.min(vr.r, q.right), b: Math.min(vr.b, q.bottom)}; } }
          if (Math.min(vr.r, br.right) - Math.max(vr.l, br.left) > 0.5 && Math.min(vr.b, br.bottom) - Math.max(vr.t, br.top) > 0.5 && cs.opacity !== '0') res.overlapsVisible.push(name);
        }
        const chips = [...band.querySelectorAll(':scope > .pk-bs__seg')];
        const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return {L: 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]), a: m[3] ?? 1}; };
        const cr = (a, b) => { const x = lum(a).L, y = lum(b).L; return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
        chips.forEach((c, i) => {
          const cs = getComputedStyle(c), sq = c.querySelector(':scope > i'), txt = c.querySelector(':scope > span');
          const bg = lum(cs.backgroundColor).a > 0.5 ? cs.backgroundColor : getComputedStyle(document.body).backgroundColor;
          const cr2 = c.getBoundingClientRect();
          res.chips.push({seg: c.dataset.seg, w: Math.round(cr2.width), x: Math.round(cr2.left - br.left), text: c.innerText.trim()});
          if (c.scrollWidth > c.clientWidth + 1 || cr2.right > br.right + 0.5 || (txt && txt.getBoundingClientRect().right > cr2.right + 0.5) || cr2.height > 21) res.clipped.push(c.dataset.seg);
          res.contrast.push({seg: c.dataset.seg, tone: c.dataset.tone, text: cr(cs.color, bg), square: sq ? cr(getComputedStyle(sq).backgroundColor, bg) : null});
          if (i) res.gaps.push(Math.round(cr2.left - chips[i - 1].getBoundingClientRect().right));
        });
      }
      const pg = document.getElementById('pk-metre-board');
      if (pg && !pg.hidden && pg.getClientRects().length) {
        const comp = document.querySelector('.agent-chat__input'), cv = comp && getComputedStyle(comp).visibility !== 'hidden' && comp.getClientRects().length;
        const sc = pg.querySelector('.pk-metre-board__scroll');
        const a = pg.getBoundingClientRect(), c = comp?.getBoundingClientRect();
        res.board = {rect: R(pg), mode: document.documentElement.getAttribute('data-metre-board'), scroll: sc && R(sc), composerVisible: Boolean(cv),
          overlapsComposer: Boolean(cv && c && Math.min(a.right, c.right) > Math.max(a.left, c.left) && Math.min(a.bottom, c.bottom) > Math.max(a.top, c.top)),
          overlapsBand: Boolean(res.band && !res.band.hidden && Math.min(a.right, res.band.r) > Math.max(a.left, res.band.x) && Math.min(a.bottom, res.band.b) > Math.max(a.top, res.band.y)),
          notice: pg.querySelector('.pk-metre-board__notice')?.textContent || '', head: pg.innerText.replace(/\s+/g, ' ').slice(0, 160), stale: window.__pinkieMetreBoardData?.stale};
        // 每张卡都能滚到：最后一张卡的底能滚进可见区
        if (sc) { const last = [...sc.querySelectorAll('.pk-metre-board__card')].pop(); if (last) { sc.scrollTop = sc.scrollHeight; const lr = last.getBoundingClientRect(), sr = sc.getBoundingClientRect(); res.board.lastCardReachable = lr.bottom <= sr.bottom + 1; sc.scrollTop = 0; } }
      }
      res.gw = window.__pinkieRunStatus?.state?.conn?.online;
      return res;
    }, state);
    const shoot = async (state) => {
      await p.evaluate(() => { const q = document.querySelector('[data-preview-panel]'); if (q) q.style.display = 'none'; });
      await p.waitForTimeout(120);
      const m = await measure(state);
      await p.screenshot({path: path.join(out, `${w}-${night}-${state}.png`)});
      await p.evaluate(() => { const q = document.querySelector('[data-preview-panel]'); if (q) q.style.display = 'flex'; });
      report.push({size, night: Number(night), ...m});
      console.log(`${size} n${night} ${state.padEnd(8)} band=${m.band?.hidden ? 'hidden' : `${m.band.x},${m.band.y} ${m.band.w}x${m.band.h} ${m.band.tier} gapB=${m.band.gapBottom} gapC=${m.band.gapComposer}`} overlaps=${m.overlaps.length} vis=${m.overlapsVisible.length} clipped=${m.clipped.length} overflow=${m.bandOverflow} | ${m.band?.text || ''}${m.board ? ` | board ${m.board.mode} comp=${m.board.composerVisible} overComp=${m.board.overlapsComposer} overBand=${m.board.overlapsBand} last=${m.board.lastCardReachable} notice="${m.board.notice}"` : ''}`);
      if (m.overlaps.length) console.log('   overlaps: ' + m.overlaps.join(' | '));
    };
    await click('bs-ok'); await p.waitForTimeout(900); await shoot('chat');
    await click('bs-engines'); await p.waitForTimeout(1600); await shoot('engines');
    await p.evaluate(() => document.querySelector('.pk-bs__seg--pop')?.click()); await p.waitForTimeout(300);
    await p.evaluate(() => { const q = document.querySelector('[data-preview-panel]'); if (q) q.style.display = 'none'; });
    await p.screenshot({path: path.join(out, `${w}-${night}-engines-pop.png`)});
    await p.evaluate(() => { const q = document.querySelector('[data-preview-panel]'); if (q) q.style.display = 'flex'; });
    await p.keyboard.press('Escape');
    await click('bs-ok'); await p.waitForTimeout(600); await click('bs-run'); await p.waitForTimeout(1300); await shoot('running');
    await click('bs-ok'); await p.waitForTimeout(600); await click('bs-unsync'); await p.waitForTimeout(4400); await shoot('unsync');
    await click('bs-ok'); await p.waitForTimeout(600); await click('keys-run'); await p.waitForTimeout(3150); await shoot('unsync-page');   // 反方向：页面以为在跑、后台空闲
    await p.waitForFunction(() => /已和后台对齐|已对齐/.test(document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)')?.innerText || ''), null, {timeout: 4000}).catch(() => {}); await shoot('aligned');
    await click('bs-ok'); await p.waitForTimeout(600);
    await click('bs-down'); await p.waitForTimeout(900); await shoot('down');
    await click('bs-recover'); await p.waitForTimeout(1500);
    await p.evaluate(() => document.querySelector('.pk-metre-nav--board')?.click() || window.__pinkieMetreBoard?.open()); await p.waitForTimeout(1600); await shoot('recover-board');
    await p.evaluate(() => window.__pinkieMetreBoard?.close()); await p.waitForTimeout(600);
    await click('bs-ok'); await p.waitForTimeout(500);
    await p.evaluate(() => window.__pinkieMetreBoard?.open()); await p.waitForTimeout(1600); await shoot('board');
    if (errs.length) { console.log('   pageErrors: ' + errs.join(' || ')); report.push({size, night: Number(night), pageErrors: errs}); }
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  await b.close(); console.log('done', report.length);
})().catch((e) => { console.log('ERR', e); process.exit(1); });
