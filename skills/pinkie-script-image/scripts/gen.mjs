// 碧琪生图 / 生视频统一入口：网页版（ChatGPT / Gemini）+ 桌面豆包
// 用法:
//   node gen.mjs --via chatgpt --prompt "提示词" --out 出图.png [--ref 参考图 ...] [--n 2] [--aspect 竖|横|方]
//   node gen.mjs --via gemini  --prompt "提示词" --out 出图.png [--ref 首帧.png] [--kind image|video|music]
//   node gen.mjs --via doubao  --prompt "动作描述" --out 出片.mp4 --first 首帧.jpg [--model 2.0] [--ratio 9:16] [--dur 5]
//   node gen.mjs --doctor                     体检：每个引擎在不在、登录没登录
//   node gen.mjs --list                       列出可用引擎
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const flag = (k) => argv.includes(k);
const all = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : [])).filter(Boolean);

const VIA = opt('--via', '');
const PROMPT = opt('--prompt', '');
const OUT = opt('--out', '');
const REFS = all('--ref');
const FIRST = opt('--first', '');
const N = Number(opt('--n', '1'));
const ASPECT = opt('--aspect', '');
const KIND = opt('--kind', 'image');
const MODEL = opt('--model', '2.0');
const RATIO = opt('--ratio', '9:16');
const DUR = opt('--dur', '5');
const PY = process.env.PK_PYTHON || 'python';

const RATIO_HINT = {竖: '9:16 portrait', 横: '16:9 landscape', 方: '1:1 square'};

// ───────────────────────── 引擎探测 ─────────────────────────
const alive = async (port) => {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(1200)}); return r.ok; }
  catch { return false; }
};

// 在页面里求值（短连接，用完即关）。页面不在或求值失败就返回 undefined。
const evalInPage = async (port, match, expr, timeoutMs = 4000) => {
  let ws;
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = tabs.find((t) => t.type === 'page' && new RegExp(match).test(t.url));
    if (!page) return {found: false};
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP 连接超时')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(t); res(); }, {once: true});
      ws.addEventListener('error', (e) => { clearTimeout(t); rej(e); }, {once: true});
    });
    const value = await new Promise((res) => {
      const timer = setTimeout(() => res(undefined), timeoutMs);
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === 1) { clearTimeout(timer); res(m.result && m.result.result ? m.result.result.value : undefined); }
      });
      ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression: expr, returnByValue: true}}));
    });
    return {found: true, value};
  } catch {
    return {found: true, value: undefined};
  } finally {
    try { ws && ws.close(); } catch {}
  }
};

const ENGINES = {
  chatgpt: {
    name: 'ChatGPT 网页版（Plus）',
    needs: '专用 Chrome 9333 + chatgpt.com 登录',
    async ready() {
      if (!(await alive(9333))) return {ok: false, why: '专用 Chrome 没开（跑 scripts/ensure-chrome.mjs）'};
      const r = await evalInPage(9333, 'chatgpt\\.com', `(() => {
        const t = document.body ? document.body.innerText : '';
        const hasBox = !!document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        const signedOut = /登录|Log in|Sign up/.test(t) && !/新聊天|New chat/.test(t);
        return JSON.stringify({hasBox, signedOut});
      })()`);
      if (!r.found) return {ok: false, why: '没有 chatgpt.com 标签页（跑 scripts/ensure-chrome.mjs --url https://chatgpt.com/）'};
      if (r.value === undefined) return {ok: false, why: '页面连上了但读不到内容（可能还在加载或卡住）'};
      const st = JSON.parse(r.value);
      if (st.signedOut) return {ok: false, why: 'ChatGPT 没登录，需要先生本人在这个窗口登录一次'};
      return {ok: true};
    },
  },
  gemini: {
    name: 'Gemini 网页版（Pro）',
    needs: '专用 Chrome 9333 + gemini.google.com 登录',
    async ready() {
      if (!(await alive(9333))) return {ok: false, why: '专用 Chrome 没开（跑 scripts/ensure-chrome.mjs）'};
      // 光看标签页在不在会误报：未登录时页面也开在 /app，只是正文几乎空、带 viewer-signed-out 标记
      const r = await evalInPage(9333, 'gemini\\.google\\.com', `(() => {
        const html = document.documentElement ? document.documentElement.outerHTML : '';
        const len = document.body ? (document.body.innerText || '').length : 0;
        const hasBox = !!document.querySelector('rich-textarea, [contenteditable="true"]');
        return JSON.stringify({len, hasBox, signedOut: html.includes('viewer-signed-out')});
      })()`);
      if (!r.found) return {ok: false, why: '没有 gemini.google.com 标签页（跑 scripts/ensure-chrome.mjs --url https://gemini.google.com/app）'};
      if (r.value === undefined) return {ok: false, why: '页面连上了但读不到内容（可能还在加载）'};
      const st = JSON.parse(r.value);
      if (st.signedOut) return {ok: false, why: 'Gemini 没登录（页面是 viewer-signed-out），需要先生本人在这个窗口登录一次'};
      if (!st.hasBox && st.len < 50) return {ok: false, why: `Gemini 页面几乎空白（${st.len} 字符），可能没登录或没加载完`};
      return {ok: true};
    },
  },
  doubao: {
    name: '豆包桌面版',
    needs: 'F:\\Doubao\\app\\Doubao.exe 带 --remote-debugging-port=9225 运行，且已登录',
    async ready() {
      if (!(await alive(9225))) return {ok: false, why: '豆包没开或没带调试端口（跑 scripts/ensure-doubao.ps1）'};
      const r = await evalInPage(9225, 'doubao', `(() => {
        const hasBox = !!document.querySelector('[data-testid=chat_input]');
        const who = (document.querySelector('[data-testid=sidebar_bottom]') || {}).innerText || '';
        return JSON.stringify({hasBox, who: who.split('\\n')[0]});
      })()`);
      if (r.value === undefined) return {ok: true};  // 读不到就不拦着，交给真正提交时校验
      const st = JSON.parse(r.value);
      if (!st.hasBox) return {ok: false, why: '豆包聊天页没找到输入框（可能没登录，或页面没加载完）'};
      return {ok: true, account: st.who};
    },
  },
};

if (flag('--list') || flag('--doctor')) {
  const rows = [];
  for (const [k, e] of Object.entries(ENGINES)) {
    const r = await e.ready();
    rows.push({engine: k, name: e.name, ok: r.ok, detail: r.ok ? '可用' : r.why, needs: e.needs});
  }
  console.log(JSON.stringify(rows, null, 2));
  process.exit(flag('--doctor') && rows.some((r) => !r.ok) ? 1 : 0);
}

if (!VIA || !PROMPT || !OUT) {
  console.error('用法: node gen.mjs --via chatgpt|gemini|doubao --prompt "..." --out 文件 [--ref 图] [--first 首帧]');
  console.error('      node gen.mjs --doctor   体检所有引擎');
  process.exit(1);
}

// ───────────────────────── ChatGPT 出图 ─────────────────────────
async function viaChatGPT() {
  const better = ASPECT && RATIO_HINT[ASPECT] ? `${RATIO_HINT[ASPECT]}，` : '';
  const full = `生成图片：${better}${PROMPT}\n\n画面里不要出现任何文字、水印或标志。`;
  const args = [full, '--out', OUT, '--n', String(N)];
  for (const r of REFS) args.push('--ref', r);
  return runScript('chatgpt_image.mjs', args);
}

// ───────────────────────── Gemini 出图/出视频 ─────────────────────────
async function viaGemini() {
  if (!(await alive(9333))) throw new Error('专用 Chrome 没开，先跑 scripts/ensure-chrome.mjs');
  const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
  if (!tabs.find((t) => t.type === 'page' && /gemini\.google\.com/.test(t.url))) {
    await fetch(`http://127.0.0.1:9333/json/new?https://gemini.google.com/app`, {method: 'PUT'});
    await new Promise((r) => setTimeout(r, 8000));
  }
  const args = [KIND, PROMPT, '--out', OUT];
  if (REFS[0] || FIRST) args.push('--image', REFS[0] || FIRST);
  if (ASPECT) args.push('--aspect', ASPECT);
  return runNode('gemini_gen.mjs', args);
}

// ───────────────────────── 豆包出视频 ─────────────────────────
function viaDoubao() {
  const first = FIRST || REFS[0];
  if (!first) throw new Error('豆包要先有首帧图：--first 首帧.jpg（或 --ref）');
  if (!fs.existsSync(first)) throw new Error('首帧图不存在：' + first);
  // 豆包要 9:16 的首帧：不是就本地裁一张
  const args = ['doubao_gen.mjs', first, PROMPT, '--model', MODEL, '--ratio', RATIO, '--dur', DUR];
  const r = runNode(args[0], args.slice(1), true);
  const conv = (r.stdout.trim().split('\n').pop() || '').trim();
  if (!/^\d+$/.test(conv)) throw new Error('没拿到对话 id：' + r.stdout.slice(-300));
  console.error('已提交，对话 id = ' + conv + '，等渲染…');
  // 豆包 1–3 分钟出片；最多等 12 分钟
  for (let i = 0; i < 24; i++) {
    const g = runNode('doubao_get.mjs', [conv, OUT], true, true);
    if (g.ok) { console.log(OUT); return {stdout: OUT}; }
    if (!/还没生成好/.test(g.stdout + g.stderr)) throw new Error('下载失败：' + (g.stderr || g.stdout).slice(-300));
    console.error(`等 ${(i + 1) * 30}s…`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  }
  throw new Error('豆包 12 分钟还没出片，对话 id ' + conv + '（可以稍后手动下载）');
}

// ───────────────────────── 工具 ─────────────────────────
const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function runNode(script, args, inheritErr = false, soft = false) {
  const inScripts = path.join(SKILL_DIR, 'scripts', script);
  const inVendor = path.join(SKILL_DIR, 'vendor', script);
  const file = fs.existsSync(inScripts) ? inScripts : inVendor;
  if (!fs.existsSync(file)) throw new Error('找不到脚本 ' + script + '（先跑 scripts/install.mjs）');
  const r = spawnSync(process.execPath, [file, ...args], {encoding: 'utf8', env: process.env, maxBuffer: 1 << 26});
  if (inheritErr && r.stderr) process.stderr.write(r.stderr);
  if (soft) return {ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || ''};
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '脚本失败').slice(-1200));
  return r;
}
function runScript(script, args) { return runNode(script, args); }

// ───────────────────────── 分发 ─────────────────────────
try {
  const eng = ENGINES[VIA];
  if (!eng) throw new Error('没有这个引擎：' + VIA + '（可选 chatgpt / gemini / doubao）');
  const st = await eng.ready();
  if (!st.ok) throw new Error(`${eng.name} 现在用不了：${st.why}`);
  fs.mkdirSync(path.dirname(path.resolve(OUT)), {recursive: true});
  let r;
  if (VIA === 'chatgpt') r = await viaChatGPT();
  else if (VIA === 'gemini') r = await viaGemini();
  else r = viaDoubao();
  const out = path.resolve(OUT);
  if (!fs.existsSync(out)) throw new Error('脚本跑完了但没有产出文件：' + out);
  const st2 = fs.statSync(out);
  if (st2.size < 2000) throw new Error('产出文件太小（' + st2.size + ' 字节），八成是失败图');
  console.log(JSON.stringify({ok: true, engine: VIA, file: out, bytes: st2.size}));
} catch (e) {
  console.error('失败：' + (e && e.message ? e.message : e));
  process.exit(1);
}
