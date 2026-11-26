#!/usr/bin/env node
// 白板遮罩截图（协调者 11-25 18:36：白板打开 1440 / 820 × 日 / 夜，看遮罩压暗和顶栏不被切）+ #148（让开桌面壳窗口键 / 拖动条）。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真实安装的 Control UI + 碧琪注入，想法模式首页（home-thinking）。不连网关：白板请求在页面里接到内存里的几条示例元素。
// 每组拍两张：
//   wb-mask-<宽>-<日夜>       ：浏览器里的样子（没有桌面壳）
//   wb-mask-<宽>-<日夜>-shell ：照 app/windows_bridge_scripts.py 的位置和层级放了窗口键胶囊 / 拖动条替身（半透明标出来），看工具条有没有被盖
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

// 页面里：白板请求接到内存（照 mui4/probe-wb.js 的示例元素），其余请求照旧。
function seedBoard() {
  const t0 = Date.now();
  const items = {};
  let rev = 0;
  const put = (it, by) => { rev += 1; items[it.id] = {...it, rev, by, updatedAt: t0}; };
  put({id: 'note-aaaa1', kind: 'note', x: 40, y: 40, w: 180, h: 110, text: '周末去哪儿：海边还是山里？', color: 'sun'}, 'user');
  put({id: 'note-bbbb2', kind: 'note', x: 280, y: 60, w: 180, h: 110, text: '预算 2000 以内', color: 'mint'}, 'user');
  put({id: 'note-cccc3', kind: 'note', x: 160, y: 230, w: 200, h: 120, text: '碧琪：山里凉快，还能看星星', color: 'sky'}, 'pinkie');
  put({id: 'box-dddd4', kind: 'box', x: 20, y: 20, w: 470, h: 350, label: '出行'}, 'pinkie');
  put({id: 'link-eeee5', kind: 'link', from: 'note-aaaa1', to: 'note-cccc3', label: ''}, 'pinkie');
  put({id: 'ink-ffff6', kind: 'ink', points: [[560, 80], [600, 60], [640, 100], [690, 70], [730, 110]], width: 2}, 'user');
  const fake = {
    'pinkie.whiteboard.get': (p) => ({ok: true, rev, items: Object.values(items).filter((it) => (p.since ? it.rev > p.since : !it.deleted))}),
    'pinkie.whiteboard.apply': () => ({ok: true, rev, applied: [], conflicts: []}),
  };
  const sb = window.__laolaoSidebar || (window.__laolaoSidebar = {});
  const orig = typeof sb.gwRequest === 'function' ? sb.gwRequest.bind(sb) : null;
  try {
    sb.gwRequest = (method, params, timeout) => (fake[method] ? Promise.resolve(fake[method](params || {}))
      : orig ? orig(method, params, timeout) : Promise.reject(new Error('网关未连接')));
    return true;
  } catch { return false; }
}

// 照 app/windows_bridge_scripts.py：拖动条 z 2147483000、窗口键 z 2147483647。替身半透明上色，截图里看得出位置。
function shellStub(W) {
  for (const id of ['pinkie-native-drag-strip', 'pinkie-native-window-controls']) document.getElementById(id)?.remove();
  const narrow = W <= 900;
  const drag = document.createElement('div');
  drag.id = 'pinkie-native-drag-strip';
  drag.style.cssText = `position:fixed;z-index:2147483000;top:0;left:${narrow ? 54 : 264}px;right:204px;height:34px;background:rgba(80,160,255,.18);outline:1px dashed rgba(40,110,220,.7)`;
  const ctl = document.createElement('div');
  ctl.id = 'pinkie-native-window-controls';
  ctl.style.cssText = `position:fixed;z-index:2147483647;top:4px;right:${narrow ? 10 : 12}px;width:190px;height:36px;border-radius:14px;background:rgba(255,120,180,.55);outline:1px dashed rgba(200,40,110,.8);font:12px/36px sans-serif;text-align:center;color:#3a1028`;
  ctl.textContent = '窗口键（替身）';
  document.body.append(drag, ctl);
}

const installed = installRealControlUi({repoRoot: REPO_ROOT});
const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
const browser = await launchRealBrowser();
const lines = [];
const notes = [];
try {
  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'home-thinking', theme);
    try {
      await page.waitForFunction(() => typeof window.Pinkie?.whiteboard?.open === 'function', null, {timeout: 15_000});
      for (const [width, height] of [[1440, 900], [820, 900]]) {
        await page.setViewportSize({width, height});
        for (const shell of [false, true]) {
          await page.evaluate(() => window.Pinkie.whiteboard.isOpen() && window.Pinkie.whiteboard.close());
          await page.evaluate(() => { for (const id of ['pinkie-native-drag-strip', 'pinkie-native-window-controls']) document.getElementById(id)?.remove(); });
          if (shell) await page.evaluate(shellStub, width);
          const seeded = await page.evaluate(seedBoard);
          await page.evaluate(() => Promise.resolve(window.Pinkie.whiteboard.open()).catch(() => {}));
          await page.waitForTimeout(900);
          const info = await page.evaluate(() => {
            const r = document.querySelector('.pk-whiteboard').getBoundingClientRect();
            const s = document.querySelector('.pk-whiteboard__scrim');
            const b = document.querySelector('.topbar')?.getBoundingClientRect();
            return {top: Math.round(r.top), topbarBottom: b && b.height > 0 ? Math.round(b.bottom) : null, items: document.querySelectorAll('.pk-whiteboard [data-id]').length,
              scrim: Boolean(s && !s.hidden), modal: document.querySelector('.pk-whiteboard').getAttribute('aria-modal')};
          });
          const name = `wb-mask-${width}-${theme}${shell ? '-shell' : ''}`;
          const file = name + '.png';
          const buf = await page.screenshot({path: path.join(out, file)});
          lines.push({name, file, os: process.platform, browser: browser.__pinkieEngine || 'chromium', width, height, bytes: buf.length,
            sha256: crypto.createHash('sha256').update(buf).digest('hex'), seeded, ...info});
          notes.push(`${name}: top=${info.top} topbar=${info.topbarBottom} items=${info.items} scrim=${info.scrim} modal=${info.modal}`);
        }
        await page.evaluate(() => window.Pinkie.whiteboard.close());
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(notes.join('\n'));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
