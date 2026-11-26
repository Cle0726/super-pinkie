#!/usr/bin/env node
// B51 排查脚本（只读，不改基线）：tests/visual-baseline.test.mjs 在 CI Linux 上偶发
// 「non-deterministic render: run 1 vs run N differed by 6–8 px」（sidebar-collapsed 日 / 夜）。
// 本机 Windows + Chrome 连拍 6 次都是 0 px，所以放到 pr-shots 的 Linux runner 上量：
//   A. 照 CI 的做法（同一浏览器、每次新上下文）连拍偶发场景 N 次，再把 24 个场景各拍 3 次做对照；
//   B. 同一页面里隔两帧再拍一次，看差异是「页面还在变」还是「每个上下文画得不一样」；
// 有差异就记差异框、框里的元素，存原图和放大 8 倍的局部图。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + shots.jsonl；另写 b51-probe.json。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  THEMES,
  VISUAL_SCENES,
  launchVisualBrowser,
  openScenePage,
  startVisualServer,
} from '../../tests/visual/lib/harness.mjs';
import {decodePng, encodePng} from '../../tests/visual/lib/png-diff.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const FLAKY_RUNS = Number(process.env.B51_RUNS || 15);
const FLAKY = (process.env.B51_TARGETS || 'sidebar-collapsed-day,sidebar-collapsed-night').split(',').filter(Boolean);

const shots = [];
const report = {os: process.platform, flakyRuns: FLAKY_RUNS, targets: FLAKY, phaseA: [], control: [], phaseB: []};

function pixelDiff(aBuf, bBuf) {
  const a = decodePng(aBuf), b = decodePng(bBuf);
  let n = 0, maxDelta = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let p = 0; p < a.data.length; p += 4) {
    const d = Math.max(
      Math.abs(a.data[p] - b.data[p]), Math.abs(a.data[p + 1] - b.data[p + 1]),
      Math.abs(a.data[p + 2] - b.data[p + 2]), Math.abs(a.data[p + 3] - b.data[p + 3]),
    );
    if (!d) continue;
    n += 1; maxDelta = Math.max(maxDelta, d);
    const px = (p / 4) % a.width, py = Math.floor(p / 4 / a.width);
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  return n ? {n, maxDelta, box: {x0, y0, x1, y1}, a, b} : {n: 0};
}

// 差异框外扩 12 px，最近邻放大 8 倍，左右并排：左 = run 1，右 = 这一次
function zoomPair(a, b, box) {
  const pad = 12, k = 8;
  const cx0 = Math.max(0, box.x0 - pad), cy0 = Math.max(0, box.y0 - pad);
  const cx1 = Math.min(a.width - 1, box.x1 + pad), cy1 = Math.min(a.height - 1, box.y1 + pad);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1, gap = 4;
  const W = (cw * 2 + gap) * k, H = ch * k;
  const rgba = Buffer.alloc(W * H * 4, 255);
  for (const [img, ox] of [[a, 0], [b, (cw + gap) * k]]) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < cw * k; x += 1) {
        const s = ((cy0 + Math.floor(y / k)) * img.width + cx0 + Math.floor(x / k)) * 4;
        const t = (y * W + ox + x) * 4;
        rgba[t] = img.data[s]; rgba[t + 1] = img.data[s + 1]; rgba[t + 2] = img.data[s + 2]; rgba[t + 3] = 255;
      }
    }
  }
  return {png: encodePng(W, H, rgba), width: W, height: H};
}

function save(name, buf, width, height) {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  shots.push({name, file, os: process.platform, browser: 'chromium', width, height, bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex')});
}

async function describeBox(page, box) {
  return page.evaluate((bx) => {
    const hit = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right < bx.x0 || r.left > bx.x1 + 1 || r.bottom < bx.y0 || r.top > bx.y1 + 1) continue;
      if (r.width * r.height > 200000) continue; // 跳过整页大容器
      const cs = getComputedStyle(el);
      hit.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`
        + ` [${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}x${r.height.toFixed(2)}]`
        + ` opacity=${cs.opacity} bg=${cs.backgroundImage.slice(0, 60)} anims=${el.getAnimations ? el.getAnimations().length : '?'}`);
      if (hit.length >= 12) break;
    }
    const imgs = [...document.images].map((img) => `${img.className || img.tagName} ${img.currentSrc.split('/').pop()} complete=${img.complete} ${img.naturalWidth}x${img.naturalHeight}`);
    return {hit, imgs, fontsStatus: document.fonts ? document.fonts.status : 'n/a', docAnims: document.getAnimations ? document.getAnimations().length : '?'};
  }, box);
}

const server = await startVisualServer();
const browser = await launchVisualBrowser();
const t0 = Date.now();
try {
  // A：照 CI（每次新上下文），偶发场景 N 次
  for (const target of FLAKY) {
    const theme = target.endsWith('-night') ? 'night' : 'day';
    const scene = target.replace(/-(day|night)$/, '');
    let first = null, saved = 0;
    for (let i = 0; i < FLAKY_RUNS; i += 1) {
      const {context, page, pageErrors} = await openScenePage(browser, server.origin, scene, theme);
      try {
        const png = await page.screenshot({animations: 'disabled', type: 'png'});
        // B：同一页面隔两帧再拍
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const again = await page.screenshot({animations: 'disabled', type: 'png'});
        const inPage = pixelDiff(png, again);
        report.phaseB.push({target, run: i + 1, samePageDiffPx: inPage.n, box: inPage.box || null});
        if (!first) { first = png; report.phaseA.push({target, run: 1, diffPx: 0, pageErrors}); continue; }
        const d = pixelDiff(first, png);
        const row = {target, run: i + 1, diffPx: d.n, maxDelta: d.maxDelta || 0, box: d.box || null, pageErrors};
        if (d.n) {
          row.where = await describeBox(page, d.box);
          if (saved < 3) {
            saved += 1;
            if (saved === 1) save(`${target}-run1`, first, d.a.width, d.a.height);
            save(`${target}-run${i + 1}`, png, d.b.width, d.b.height);
            const z = zoomPair(d.a, d.b, d.box);
            save(`${target}-run${i + 1}-zoom8x`, z.png, z.width, z.height);
          }
        }
        report.phaseA.push(row);
        console.log(`A ${target} run ${i + 1}: ${d.n} px${d.n ? ` max Δ${d.maxDelta} box x=${d.box.x0}..${d.box.x1} y=${d.box.y0}..${d.box.y1}` : ''}; same-page 2nd shot: ${inPage.n} px`);
      } finally {
        await context.close();
      }
    }
  }
  // 对照：24 个场景各 3 次（和 CI 的 PINKIE_VISUAL_REPEAT=3 一样）；B51_CONTROL=0 跳过（本机冒烟用）
  for (const scene of process.env.B51_CONTROL === '0' ? [] : VISUAL_SCENES) {
    for (const theme of THEMES) {
      const name = `${scene.id}-${theme}`;
      let first = null;
      for (let i = 0; i < 3; i += 1) {
        const {context, page} = await openScenePage(browser, server.origin, scene.id, theme);
        try {
          const png = await page.screenshot({animations: 'disabled', type: 'png'});
          if (!first) { first = png; continue; }
          const d = pixelDiff(first, png);
          report.control.push({name, run: i + 1, diffPx: d.n, box: d.box || null});
          if (d.n) {
            console.log(`control ${name} run ${i + 1}: ${d.n} px box x=${d.box.x0}..${d.box.x1} y=${d.box.y0}..${d.box.y1}`);
            if (!shots.some((s) => s.name.startsWith(name))) {
              save(`${name}-run1`, first, d.a.width, d.a.height);
              save(`${name}-run${i + 1}`, png, d.b.width, d.b.height);
              const z = zoomPair(d.a, d.b, d.box);
              save(`${name}-run${i + 1}-zoom8x`, z.png, z.width, z.height);
            }
          }
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
report.seconds = Math.round((Date.now() - t0) / 1000);
const flakyHits = report.phaseA.filter((r) => r.diffPx).length;
const samePageHits = report.phaseB.filter((r) => r.samePageDiffPx).length;
const controlHits = report.control.filter((r) => r.diffPx).length;
report.summary = {flakyHits, samePageHits, controlHits};
fs.writeFileSync(path.join(out, 'b51-probe.json'), JSON.stringify(report, null, 2));
// 工作流要求至少一张 PNG：一张都没差时也存一张 run 1 当凭据
if (!shots.length) {
  const {context, page} = await (async () => {
    const s = await startVisualServer();
    const b = await launchVisualBrowser();
    const r = await openScenePage(b, s.origin, 'sidebar-collapsed', 'day');
    const png = await r.page.screenshot({animations: 'disabled', type: 'png'});
    save('sidebar-collapsed-day-ref', png, 1280, 800);
    await r.context.close(); await b.close(); await s.close();
    return {context: null, page: null};
  })();
  void context; void page;
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), shots.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`b51-probe: flaky diffs ${flakyHits}/${report.phaseA.length - FLAKY.length}, same-page diffs ${samePageHits}/${report.phaseB.length}, control diffs ${controlHits}/${report.control.length}, ${report.seconds}s → ${out}`);
