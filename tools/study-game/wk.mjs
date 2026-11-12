// 原生 WKWebView 驱动（和 超級碧琪.app 同一个 WebKit）。Playwright 的 WebKit 在这台 macOS 上截图是空的，所以自己起一个宿主。
// 只给 QA 用：page.evaluate / screenshot / waitForFunction / goto，接口照 Playwright 的子集。
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';

const here = path.dirname(fileURLToPath(import.meta.url));
function binary() {
  const src = path.join(here, 'wkhost/wkhost.swift'), bin = path.join(os.homedir(), 'Library/Caches/pinkie-qa/wkhost');
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) { fs.mkdirSync(path.dirname(bin), {recursive: true}); execFileSync('swiftc', ['-O', src, '-o', bin]); }
  return bin;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const KEYS = {Tab: [48, '\t'], 'Shift+Tab': [48, '\x19', true], Enter: [36, '\r'], Space: [49, ' '], Escape: [53, '\x1b'], ArrowLeft: [123, '\uF702'], ArrowRight: [124, '\uF703'], ArrowDown: [125, '\uF701'], ArrowUp: [126, '\uF700'],
  1: [18, '1'], 2: [19, '2'], 3: [20, '3'], 4: [21, '4'], a: [0, 'a'], b: [11, 'b'], c: [8, 'c'], d: [2, 'd']};
const keySpec = name => { const k = KEYS[name]; if (!k) throw Error('unknown key ' + name); return k; };
export async function wkPage({width = 1280, height = 800, dark = false} = {}) {
  const proc = spawn(binary(), [], {env: {...process.env, WK_W: String(width), WK_H: String(height), WK_DARK: dark ? '1' : '0'}, stdio: ['pipe', 'pipe', 'inherit']});
  const pending = new Map(); let seq = 0, ready, loaded = [];
  const readyP = new Promise(r => ready = r);
  readline.createInterface({input: proc.stdout}).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.event === 'ready') ready(); else if (m.event === 'loaded') { loaded.forEach(f => f()); loaded = []; }
    else if (pending.has(m.id)) { const {res, rej} = pending.get(m.id); pending.delete(m.id); m.ok ? res(m) : rej(Error(m.error)); }
  });
  await readyP;
  const send = o => new Promise((res, rej) => { const id = ++seq; pending.set(id, {res, rej}); proc.stdin.write(JSON.stringify({...o, id}) + '\n'); });
  const safe = expr => `const __r = await (${expr}); if (__r === undefined) return null; try { return JSON.parse(JSON.stringify(__r)); } catch { return String(__r); }`;
  const body = (fn, arg) => typeof fn === 'string' ? safe(fn) : safe(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
  const page = {
    async addInitScript(fn, arg) { await send({op: 'script', js: typeof fn === 'string' ? fn : `(${fn.toString()})(${JSON.stringify(arg ?? null)});`}); },
    async goto(url) { const p = new Promise(r => loaded.push(r)); await send({op: 'load', url}); await p; },
    async evaluate(fn, arg) { return (await send({op: 'eval', js: body(fn, arg)})).result; },
    async waitForFunction(fn, arg, {timeout = 15000} = {}) { const t = Date.now(); for (;;) { try { if (await page.evaluate(fn, arg)) return true; } catch {} if (Date.now() - t > timeout) throw Error('waitForFunction timeout'); await wait(150); } },
    async screenshot({path: file}) { await send({op: 'shot', path: file}); return file; },
    async windowId() { return (await send({op: 'winid'})).winid; },
    // 真键盘：page.keys('Tab', 'Tab', 'Enter', '1', 'a')
    async keys(...names) { await send({op: 'key', keys: names.map(keySpec)}); await wait(60); },
    async setDark(on) { await send({op: 'dark', on}); },
    // Playwright locator 子集：waitFor / click / count / first()。点击用 DOM click()（足够驱动界面，不是可信事件）。
    locator(sel, nth = 0) {
      const loc = {
        first: () => page.locator(sel, 0), nth: i => page.locator(sel, i),
        waitFor: ({timeout = 15000} = {}) => page.waitForFunction(([s, i]) => { const e = document.querySelectorAll(s)[i]; return !!e && e.getClientRects().length > 0; }, [sel, nth], {timeout}),
        click: async () => { await loc.waitFor(); await page.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; e.scrollIntoView({block: 'center'}); for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) e.dispatchEvent(new PointerEvent(t, {bubbles: true, cancelable: true, isPrimary: true})); e.click(); }, [sel, nth]); },
        count: () => page.evaluate(s => document.querySelectorAll(s).length, sel),
        textContent: () => page.evaluate(([s, i]) => document.querySelectorAll(s)[i]?.textContent, [sel, nth]),
      };
      return loc;
    },
    async close() { try { proc.stdin.write(JSON.stringify({op: 'quit'}) + '\n'); } catch {} await wait(200); proc.kill(); },
  };
  return page;
}
