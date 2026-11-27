#!/usr/bin/env node
// B62 对照脚本（只读，不改基线、不调阈值；合并前删掉，不进 main，同 #381 b51-probe 的做法）。
// 回 win-coord 7211852593：同一个 CI fixture（tests/visual/lib/harness.mjs 的 openScenePage）上，
// 把原来的「单拍」和 #416 的「隔两帧连拍到相邻两张相同」放在同一个页面里对照：
//   - 每轮开新上下文（和 visual-baseline 一样），先拍的那张就是原来单拍会交出去的首帧；
//     接着调用真正的 screenshotWhenSettled（截图被包了一层只做记录），它交出的是选中帧。
//   - 记：首帧 / 选中帧的 sha256、是否需要重拍（选中帧 ≠ 首帧）、拍了几张、never settled 次数、耗时。
//   - 轮与轮之间：首帧和第 1 轮首帧比（= 原单拍的 3 遍确定性），选中帧和第 1 轮选中帧比（= 新方案）。
//     有差就记像素数、包围框、最大通道差（口径同 #381 describeRepeatDiff），并对框里的元素。
//   - 同一页面里首帧和第 2 张不同，说明是「帧没画完」；只在不同上下文之间不同，说明是光栅波动，
//     连拍分不出来，也就修不了。两种情况分开计数。
// 存图：每个目标第 1 轮的首帧（和不同于首帧的选中帧）；每种差异各存第一次的原图和放大 8 倍的局部图。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + shots.jsonl，另写 b62-compare.json。
// 本机没有浏览器时用 --selftest 跑假页面，只验统计逻辑。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {
  SETTLE_MAX_SHOTS,
  launchVisualBrowser,
  openScenePage as realOpenScenePage,
  screenshotWhenSettled,
  startVisualServer,
} from '../../tests/visual/lib/harness.mjs';
import {decodePng, encodePng} from '../../tests/visual/lib/png-diff.mjs';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = path.resolve(outAt >= 0 && args[outAt + 1] ? args[outAt + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
const SELFTEST = args.includes('--selftest');
fs.mkdirSync(out, {recursive: true});
const ROUNDS = Number(process.env.B62_ROUNDS || (SELFTEST ? 4 : 25));
const TARGETS = (process.env.B62_TARGETS || (SELFTEST
  ? 'fake-unsettled-day,fake-raster-day,fake-stable-day'
  : 'long-conversation-day,sidebar-collapsed-day,sidebar-collapsed-night,home-learning-day,study-desk-day,model-picker-day'))
  .split(',').filter(Boolean);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const decoded = new Map();
const decode = (buf) => {
  const k = sha(buf);
  if (!decoded.has(k)) decoded.set(k, decodePng(buf));
  return decoded.get(k);
};

// 口径同 #381：通道容差 0，记差异像素数、包围框、最大单通道差
function pixelDiff(aBuf, bBuf) {
  const a = decode(aBuf), b = decode(bBuf);
  if (a.width !== b.width || a.height !== b.height) return {n: a.width * a.height, maxDelta: null, box: null, sizeMismatch: true};
  let n = 0, maxDelta = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let p = 0; p < a.data.length; p += 4) {
    const d = Math.max(Math.abs(a.data[p] - b.data[p]), Math.abs(a.data[p + 1] - b.data[p + 1]),
      Math.abs(a.data[p + 2] - b.data[p + 2]), Math.abs(a.data[p + 3] - b.data[p + 3]));
    if (!d) continue;
    n += 1; maxDelta = Math.max(maxDelta, d);
    const px = (p / 4) % a.width, py = Math.floor(p / 4 / a.width);
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  return n ? {n, maxDelta, box: {x0, y0, x1, y1}} : {n: 0, maxDelta: 0, box: null};
}

// 差异框外扩 12 px，最近邻放大 8 倍，左右并排：左 = 参照，右 = 这一张
function zoomPair(aBuf, bBuf, box) {
  const a = decode(aBuf), b = decode(bBuf);
  const pad = 12, k = 8, gap = 4;
  const cx0 = Math.max(0, box.x0 - pad), cy0 = Math.max(0, box.y0 - pad);
  const cx1 = Math.min(a.width - 1, box.x1 + pad), cy1 = Math.min(a.height - 1, box.y1 + pad);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
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
  return encodePng(W, H, rgba);
}

const shots = [];
function save(name, buf) {
  const file = `${name}.png`;
  const {width, height} = decode(buf);
  fs.writeFileSync(path.join(out, file), buf);
  shots.push({name, file, os: process.platform, browser: 'chromium', width, height, bytes: buf.length, sha256: sha(buf)});
}

async function describeBox(page, box) {
  if (!box || SELFTEST) return null;
  return page.evaluate((bx) => {
    const hit = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right < bx.x0 || r.left > bx.x1 + 1 || r.bottom < bx.y0 || r.top > bx.y1 + 1) continue;
      if (r.width * r.height > 200000) continue; // 跳过整页大容器
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      hit.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls} [${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}]`);
      if (hit.length >= 8) break;
    }
    return hit;
  }, box);
}

// --selftest 假页面：unsettled = 奇数轮首帧没画完、第 2 张起稳定；raster = 同页稳定、但奇偶轮上下文不同；
// stable = 一直一样。只验统计逻辑，不代表浏览器行为。
function tinyPng(dot = null) {
  const w = 8, h = 6, rgba = Buffer.alloc(w * h * 4, 200);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  if (dot) rgba[(dot[1] * w + dot[0]) * 4] -= dot[2];
  return encodePng(w, h, rgba);
}
let fakeRound = 0;
async function fakeOpenScenePage(_browser, _origin, scene) {
  fakeRound += 1;
  const round = fakeRound;
  let i = 0;
  const page = {
    async evaluate() {},
    async screenshot() {
      i += 1;
      if (scene === 'fake-unsettled') return i === 1 && round % 2 ? tinyPng([3, 2, 1]) : tinyPng();
      if (scene === 'fake-raster') return round % 2 ? tinyPng() : tinyPng([5, 4, 1]);
      return tinyPng();
    },
  };
  return {context: {async close() {}}, page, pageErrors: []};
}
const openScenePage = SELFTEST ? fakeOpenScenePage : realOpenScenePage;

const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const summaryOf = (d) => ({px: d.n, maxDelta: d.maxDelta, box: d.box});

const report = {os: process.platform, rounds: ROUNDS, targets: TARGETS, settleMaxShots: SETTLE_MAX_SHOTS, selftest: SELFTEST, results: []};
const server = SELFTEST ? {origin: 'http://127.0.0.1:1', close: async () => {}} : await startVisualServer();
const browser = SELFTEST ? null : await launchVisualBrowser();
const t0 = performance.now();
try {
  for (const target of TARGETS) {
    const theme = target.endsWith('-night') ? 'night' : 'day';
    const scene = target.replace(/-(day|night)$/, '');
    const rows = [];
    let refFirst = null, refSelected = null;
    let savedOrig = 0, savedSettle = 0, savedInPage = 0;
    for (let round = 1; round <= ROUNDS; round += 1) {
      const tStart = performance.now();
      const {context, page, pageErrors} = await openScenePage(browser, server.origin, scene, theme);
      const tOpen = performance.now();
      const taken = [], takenAt = [];
      const shoot = page.screenshot.bind(page);
      page.screenshot = async (opts) => {
        const buf = await shoot(opts);
        taken.push(buf); takenAt.push(performance.now());
        return buf;
      };
      let selected = null, neverSettled = false, error = null;
      try {
        selected = await screenshotWhenSettled(page, {label: target});
      } catch (e) {
        if (/never settled/.test(String(e?.message))) neverSettled = true;
        else error = String(e?.message || e);
      }
      const first = taken[0] || null;
      const row = {
        round,
        firstSha: first ? sha(first).slice(0, 16) : null,
        selectedSha: selected ? sha(selected).slice(0, 16) : null,
        shots: taken.length,
        retake: Boolean(first && selected && Buffer.compare(first, selected) !== 0),
        neverSettled,
        error,
        pageErrors,
        openMs: Math.round(tOpen - tStart),
        singleShotMs: takenAt.length ? Math.round(takenAt[0] - tOpen) : null,
        settleMs: takenAt.length ? Math.round(takenAt[takenAt.length - 1] - tOpen) : null,
      };
      // 同一页面里首帧 ≠ 第 2 张：帧没画完（连拍能纠正的那一类）
      if (taken.length >= 2 && Buffer.compare(taken[0], taken[1]) !== 0) {
        const d = pixelDiff(taken[0], taken[1]);
        row.inPage = {...summaryOf(d), where: await describeBox(page, d.box)};
        if (savedInPage < 1 && d.box) {
          savedInPage += 1;
          save(`${target}-r${round}-inpage-shot1`, taken[0]);
          save(`${target}-r${round}-inpage-shot2`, taken[1]);
          save(`${target}-r${round}-inpage-zoom8x`, zoomPair(taken[0], taken[1], d.box));
        }
      }
      if (round === 1) {
        refFirst = first; refSelected = selected;
        if (first) save(`${target}-r1-first`, first);
        if (selected && row.retake) save(`${target}-r1-selected`, selected);
      } else {
        // 原单拍口径：首帧 vs 第 1 轮首帧
        if (first && refFirst && Buffer.compare(first, refFirst) !== 0) {
          const d = pixelDiff(refFirst, first);
          row.vsRound1Original = {...summaryOf(d), where: await describeBox(page, d.box)};
          if (savedOrig < 1 && d.box) {
            savedOrig += 1;
            save(`${target}-r${round}-first`, first);
            save(`${target}-r${round}-first-vs-r1-zoom8x`, zoomPair(refFirst, first, d.box));
          }
        }
        // 新方案口径：选中帧 vs 第 1 轮选中帧
        if (selected && refSelected && Buffer.compare(selected, refSelected) !== 0) {
          const d = pixelDiff(refSelected, selected);
          row.vsRound1Settled = {...summaryOf(d), where: await describeBox(page, d.box)};
          if (savedSettle < 1 && d.box) {
            savedSettle += 1;
            save(`${target}-r${round}-selected`, selected);
            save(`${target}-r${round}-selected-vs-r1-zoom8x`, zoomPair(refSelected, selected, d.box));
          }
        }
      }
      await context.close();
      rows.push(row);
      const flag = [
        row.retake ? `retake(${row.shots} shots)` : `shots=${row.shots}`,
        row.inPage ? `in-page ${row.inPage.px}px Δ${row.inPage.maxDelta}` : '',
        row.vsRound1Original ? `first≠r1 ${row.vsRound1Original.px}px Δ${row.vsRound1Original.maxDelta}` : '',
        row.vsRound1Settled ? `selected≠r1 ${row.vsRound1Settled.px}px Δ${row.vsRound1Settled.maxDelta}` : '',
        row.neverSettled ? 'NEVER SETTLED' : '', row.error ? `error ${row.error}` : '',
      ].filter(Boolean).join(' ');
      console.log(`${target} r${round}: ${flag}; single ${row.singleShotMs}ms settle ${row.settleMs}ms`);
    }
    const later = rows.slice(1);
    const hist = {};
    for (const r of rows) hist[r.shots] = (hist[r.shots] || 0) + 1;
    const distinct = (key) => new Set(rows.map((r) => r[key]).filter(Boolean)).size;
    const worst = (key) => later.map((r) => r[key]).filter(Boolean).sort((a, b) => b.px - a.px)[0] || null;
    report.results.push({
      target,
      rounds: rows.length,
      original: {distinctFrames: distinct('firstSha'), roundsDifferFromRound1: later.filter((r) => r.vsRound1Original).length, worst: worst('vsRound1Original')},
      settled: {distinctFrames: distinct('selectedSha'), roundsDifferFromRound1: later.filter((r) => r.vsRound1Settled).length, worst: worst('vsRound1Settled')},
      retakeRounds: rows.filter((r) => r.retake).length,
      inPageDiffRounds: rows.filter((r) => r.inPage).length,
      neverSettled: rows.filter((r) => r.neverSettled).length,
      errors: rows.filter((r) => r.error).length,
      shotsHistogram: hist,
      ms: {openAvg: avg(rows.map((r) => r.openMs)), singleShotAvg: avg(rows.map((r) => r.singleShotMs).filter((x) => x != null)),
        settleAvg: avg(rows.map((r) => r.settleMs).filter((x) => x != null))},
      rows,
    });
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}
report.seconds = Math.round((performance.now() - t0) / 1000);
fs.writeFileSync(path.join(out, 'b62-compare.json'), JSON.stringify(report, null, 2));
fs.appendFileSync(path.join(out, 'shots.jsonl'), shots.map((l) => JSON.stringify(l) + '\n').join(''));
for (const r of report.results) {
  console.log(`b62-compare ${r.target}: rounds ${r.rounds}; original distinct ${r.original.distinctFrames}, ≠r1 ${r.original.roundsDifferFromRound1}; `
    + `settled distinct ${r.settled.distinctFrames}, ≠r1 ${r.settled.roundsDifferFromRound1}; retake ${r.retakeRounds}; in-page diff ${r.inPageDiffRounds}; `
    + `never settled ${r.neverSettled}; errors ${r.errors}; shots ${JSON.stringify(r.shotsHistogram)}; ms single ${r.ms.singleShotAvg} settle ${r.ms.settleAvg}`);
}
console.log(`b62-compare: ${report.results.length} targets × ${ROUNDS} rounds, ${report.seconds}s, ${shots.length} PNG → ${out}`);
