// 验收用：WebKit（最接近 App 的 WKWebView）+ App 真实窗口尺寸 1280×800@2x + 用户真实的多卡布局，截游戏各页。隔离 harness，不碰 18789。
// 用法：NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/review-qa.mjs <views|...> [--engine=webkit] [--layout=triple-chat|single] [--theme=dark]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {harnessWithGame, deskReady, seedMonsters} from './game-qa.mjs';
import {launch, openPage} from './ui-qa.mjs';
import {wkPage} from './wk.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), cmd = args.find(a => !a.startsWith('--')) || 'views';
const opt = (name, d) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const out = path.resolve(opt('out', path.join(repo, '../../briefs/study-desk-game/qa-review/webkit')));
fs.mkdirSync(out, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const W = Number(opt('width', 1280)), H = Number(opt('height', 800));

// 原生 WKWebView 打开隔离 harness（初始化脚本和 ui-qa openPage 一样：特效档位、主题、rAF 计数）。
export async function openWk(harness, {width = W, height = H, theme = 'dark', tier = 'standard', query = '', still = !args.includes('--live')} = {}) {
  const page = await wkPage({width, height, dark: theme === 'dark'});
  await page.addInitScript(([tier, theme]) => {
    try { localStorage.setItem('pinkie.gamefx.v1', JSON.stringify({tier, custom: {}})); } catch {}
    const raw = window.requestAnimationFrame.bind(window); window.__rafCalls = 0;
    window.requestAnimationFrame = cb => { window.__rafCalls++; return raw(cb); };
    window.__qaErrors = []; addEventListener('error', e => window.__qaErrors.push(String(e.message))); addEventListener('unhandledrejection', e => window.__qaErrors.push('rej ' + String(e.reason?.message || e.reason)));
    const paint = () => { const d = document.documentElement; if (!d) return false; d.dataset.themeMode = theme === 'dark' ? 'dark' : 'light'; if (theme === 'dark') d.setAttribute('data-pinkie-night', ''); return true; };
    if (!paint()) document.addEventListener('readystatechange', paint, {once: true});
  }, [tier, theme]);
  // 锁屏时 WebKit 把窗口当 hidden：CSS 动画停在第一帧（opacity 0）。静态版式审查时把动画直接跳到终态。
  if (still) await page.addInitScript(() => { const add = () => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.append(st); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add, {once: true}); });
  await page.goto(harness.url + query);
  return page;
}

export async function deskLayout(page, layout) {
  if (!layout || layout === 'none') return;
  await page.evaluate(l => window.__pinkieStudyDesk.setLayout(l), layout);
  await wait(800);
}

async function views() {
  const {harness, service, close} = await harnessWithGame();
  seedMonsters(service);
  const list = (opt('views', 'today,gamemap,gameshop,gamegacha,gamewardrobe,gamecodex,gamehunt,gameexam')).split(',');
  try {
    for (const theme of (opt('theme') ? [opt('theme')] : ['dark', 'light'])) {
      const page = await openWk(harness, {theme, tier: opt('tier', 'standard')});
      await deskReady(page, null);
      await deskLayout(page, opt('layout', 'triple-chat'));
      for (const v of list) {
        await page.evaluate(v => window.__pinkieStudyDesk.go(v), v); await wait(Number(opt('settle', 2600)));
        const f = path.join(out, `${opt('tag', 'v')}-${v}-${theme}-${opt('layout', 'triple-chat')}.png`); await page.screenshot({path: f}); console.log(f);
      }
      console.log('errors', JSON.stringify(await page.evaluate(() => window.__qaErrors)));
      await page.close();
    }
  } finally { await close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await ({views}[cmd] || (() => { throw Error('unknown ' + cmd); }))();
