// #424 820 截断复核（临时探针，确认后删除）：真页面 home-project，1440 / 820 × 日 / 夜，
// 量输入框下 #laolao-project-scope 的实际列宽、生效的 max-width / 字号、scrollWidth / clientWidth，
// 以及 .chat-main 容器宽（判断 ui-subtraction.css 的 @container pinkiechat (max-width: 680px) 块是否生效）。
// 每格量两次：当前样式；再注入一条同优先级的 `#laolao-project-scope{max-width:42%}`（模拟 68631c1f 的写法）。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + shots.jsonl + report.json。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const HEIGHT = 900;

function probe() {
  const n = document.getElementById('laolao-project-scope');
  if (!n) return {missing: true};
  const cs = getComputedStyle(n), host = n.parentElement, hs = getComputedStyle(host);
  const main = document.querySelector('.chat-main');
  const r = n.getBoundingClientRect();
  const props = ['max-width', 'font-size', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'width', 'margin-left'];
  const rules = [];
  const walk = (list, cond, href) => {
    for (const rule of list) {
      if (rule.cssRules && !(rule instanceof CSSStyleRule)) {
        const c = rule.conditionText || rule.containerQuery || rule.media?.mediaText || '';
        walk(rule.cssRules, cond.concat(`${rule.constructor.name.replace(/^CSS|Rule$/g, '')}(${rule.containerName || ''} ${c})`.trim()), href);
        continue;
      }
      if (!(rule instanceof CSSStyleRule)) continue;
      let hit = false;
      try { hit = n.matches(rule.selectorText); } catch {}
      if (!hit) continue;
      const set = props.filter((p) => rule.style.getPropertyValue(p)).map((p) => `${p}:${rule.style.getPropertyValue(p)}${rule.style.getPropertyPriority(p) ? '!' : ''}`);
      if (set.length) rules.push({sheet: href, cond: cond.join(' > '), sel: rule.selectorText.slice(0, 160), set});
    }
  };
  for (const s of document.styleSheets) {
    let list; try { list = s.cssRules; } catch { continue; }
    walk(list, [], String(s.href || 'inline').split('/').pop().split('?')[0]);
  }
  return {
    text: n.textContent, scroll: n.scrollWidth, client: n.clientWidth, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    style: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])),
    hostCols: hs.gridTemplateColumns, hostWidth: Math.round(host.getBoundingClientRect().width), hostClass: String(host.className).slice(0, 80),
    chatMainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
    mode: document.documentElement.getAttribute('data-laolao-mode'), rules,
  };
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const msg = (e) => String(e?.message || e).split('\n')[0];

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      let opened;
      try {
        opened = await H.openRealScenePage(browser, server.origin, 'home-project', theme, {timezoneId: 'Asia/Shanghai'});
      } catch (e) { report.push({theme, width, step: 'open', error: msg(e)}); console.log(`[424] ${width}-${theme} 打不开：${msg(e)}`); continue; }
      const {context, page} = opened;
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForTimeout(600);
        for (const variant of ['now', 'cap42']) {
          if (variant === 'cap42') { await page.addStyleTag({content: '#laolao-project-scope{max-width:42%}'}); await page.waitForTimeout(200); }
          const got = await page.evaluate(probe);
          const name = `scope-${width}-${theme}-${variant}`, file = `${name}.png`;
          const buf = await page.screenshot({path: path.join(out, file)});
          lines.push({name, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
          report.push({name, theme, width, variant, ...got});
          console.log(`[424] ${name}: scroll=${got.scroll} client=${got.client} max=${got.style?.['max-width']} col=${got.style?.['grid-column-start']} chatMain=${got.chatMainWidth} host=${got.hostWidth} cols=${got.hostCols}`);
          for (const r of got.rules || []) console.log(`[424]    ${r.sheet} ${r.cond ? '[' + r.cond + '] ' : ''}${r.sel} → ${r.set.join(' ')}`);
        }
      } catch (e) {
        report.push({theme, width, step: 'run', error: msg(e)}); console.log(`[424] ${width}-${theme} 出错：${msg(e)}`);
      } finally { await context.close().catch(() => {}); }
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
