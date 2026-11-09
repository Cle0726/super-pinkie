// ChatGPT 网页版出图（用户的 Plus 账号，专用 Chrome CDP 9333；codex 限流时的备用，用户 2026-10-20：不要用 Gemini）。
// 每次开一个新对话（临时聊天不能出图，2026-10-20 实测；对话会留在用户的历史里，不删），上传参考图，发提示词，等图出来，在页面里取原图下载。
// 用法: node 工具/gpt_web_gen.mjs "<提示词>" --out <输出.png> [--ref 图1 --ref 图2 ...] [--n 2]（--n = 同一个提示出几张，每张一个新对话）
// 前提: bash 工具/gemini_chrome.sh 打开专用 Chrome，并在 chatgpt.com 登录过一次。
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const prompt = argv[0];
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const refs = argv.flatMap((a, i) => (a === '--ref' ? [path.resolve(argv[i + 1])] : []));
const out = opt('--out');
const N = Number(opt('--n') || 1);
if (!prompt || !out) {
	console.error('用法: node 工具/gpt_web_gen.mjs "<提示词>" --out <输出.png> [--ref 图 ...] [--n 2]');
	process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
let tgt = targets.find((t) => t.type === 'page' && /chatgpt\.com/.test(t.url));
if (!tgt) tgt = await (await fetch('http://127.0.0.1:9333/json/new?https://chatgpt.com/', {method: 'PUT'})).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = {};
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (pend[m.id]) {
		pend[m.id](m);
		delete pend[m.id];
	}
};
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async (x) => {
	const r = await call('Runtime.evaluate', {expression: x, returnByValue: true, awaitPromise: true});
	return r.result && r.result.result ? r.result.result.value : undefined;
};
const clickAt = async ({x, y}) => {
	for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', {type, x, y, button: 'left', clickCount: 1});
};

async function one(outPath) {
	await call('Page.enable');
	await call('Page.navigate', {url: 'https://chatgpt.com/'});
	await sleep(6000);
	// 清掉上次没发出去的草稿（ChatGPT 会保留输入框里的附件和文字，新提示会叠上去）
	for (let k = 0; k < 12; k++) {
		const n = await ev(`(() => { const bs = [...document.querySelectorAll('button[aria-label^="移除"], button[aria-label^="Remove"]')]; bs.forEach(b => b.click()); return bs.length; })()`);
		if (!n) break;
		await sleep(500);
	}
	await ev(`(() => { const e = document.querySelector('#prompt-textarea, div[contenteditable=true]'); if (!e) return; e.focus(); document.execCommand('selectAll'); document.execCommand('delete'); })()`);
	await sleep(500);
	// 参考图：塞进 accept=image/* 且 multiple 的 input
	if (refs.length) {
		await call('DOM.enable');
		const doc = await call('DOM.getDocument', {depth: -1, pierce: true});
		const q = await call('DOM.querySelectorAll', {nodeId: doc.result.root.nodeId, selector: 'input[type=file]'});
		const ids = q.result.nodeIds;
		let target = null;
		for (const nid of ids) {
			const a = await call('DOM.getAttributes', {nodeId: nid});
			const at = a.result.attributes;
			const acc = at[at.indexOf('accept') + 1] || '';
			if (at.includes('multiple') && /^image\/\*$/.test(acc)) target = nid;
		}
		target = target || ids[ids.length - 1];
		await call('DOM.setFileInputFiles', {files: refs, nodeId: target});
		// 等缩略图上传完（发送按钮可用）
		for (let i = 0; i < 60; i++) {
			await sleep(1000);
			const n = await ev(`document.querySelectorAll('form img, [data-testid*=attachment] img, div[class*=attachment] img').length`);
			const busy = await ev(`!!document.querySelector('[role=progressbar], circle[stroke-dasharray]')`);
			if (n >= refs.length && !busy) break;
		}
		await sleep(1500);
	}
	// 输入框（ProseMirror contenteditable）
	const p = await ev(`(() => { const e = document.querySelector('#prompt-textarea, [contenteditable=true].ProseMirror, div[contenteditable=true]'); if (!e) return null; e.focus(); const b = e.getBoundingClientRect(); return {x: b.x + 20, y: b.y + b.height / 2}; })()`);
	if (!p) throw new Error('找不到输入框（登录过期？）');
	await clickAt(p);
	await call('Input.insertText', {text: prompt});
	await sleep(800);
	const before = await ev(`document.querySelectorAll('img').length`);
	// 附了几张图 + 长提示词时输入框会被撑高，发送按钮跑到窗口外面——按坐标点会点空（2026-10-20 用户发现）→ 直接在页面里 click()，不行再按回车
	let sent = false;
	for (let i = 0; i < 40 && !sent; i++) {
		sent = await ev(`(() => { const b = document.querySelector('[data-testid=send-button]:not([disabled]), button[aria-label="发送"]:not([disabled]), button[aria-label="发送提示"]:not([disabled])'); if (!b) return false; b.scrollIntoView({block: 'center'}); b.click(); return true; })()`);
		if (!sent) await sleep(1000);
	}
	if (!sent) {
		for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? String.fromCharCode(13) : undefined});
		await sleep(2000);
		sent = await ev(`document.querySelectorAll('[data-message-author-role=user]').length > 0`);
	}
	if (!sent) throw new Error('发送按钮一直不可用');
	console.error('已发送，等出图…');
	// 等图：助手回复里的生成图（src 来自 oaiusercontent / estuary），且不再变化
	let src = null, stable = 0, last = null;
	for (let i = 0; i < 200; i++) {
		await sleep(3000);
		const s = await ev(`(() => { const imgs = [...document.querySelectorAll('img[alt^="已生成图像"], img[alt^="Generated image"], img[alt*="生成的图"]')].filter(im => im.naturalWidth > 600); const im = imgs.pop(); return im ? im.src + '|' + im.naturalWidth : null; })()`);
		const stillGen = await ev(`/正在创建|正在生成|Creating image|Generating/.test(document.body.innerText)`);
		if (s && !stillGen) {
			if (s === last) stable++;
			else stable = 0;
			last = s;
			if (stable >= 2) { src = s.split('|')[0]; break; }
		}
		const refusal = await ev(`(() => { const r = [...document.querySelectorAll('[data-message-author-role=assistant]')].pop(); return r ? r.innerText.slice(0, 300) : ''; })()`);
		if (i > 20 && refusal && !s && !stillGen && /无法|不能|抱歉|违反|can't|unable|policy/i.test(refusal)) throw new Error('被拒绝：' + refusal);
		if (i > 25 && /限制|上限|limit/i.test(refusal || '') && !s) throw new Error('额度：' + refusal);
	}
	if (!src) throw new Error('等不到图（超时）');
	const b64 = await ev(`(async () => { const r = await fetch(${JSON.stringify(src)}, {credentials: 'include'}); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); })()`);
	if (!b64) throw new Error('下载失败');
	fs.mkdirSync(path.dirname(outPath), {recursive: true});
	fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
	console.log(outPath);
}

if (argv.includes('--fetch')) {  // 不发新提示，直接下载当前对话里最新生成的图
	const src = await ev(`(() => { const im = [...document.querySelectorAll('img[alt^="已生成图像"], img[alt^="Generated image"]')].filter(i => i.naturalWidth > 600).pop(); return im ? im.src : null; })()`);
	if (!src) throw new Error('当前对话里没有生成图');
	const b64 = await ev(`(async () => { const r = await fetch(${JSON.stringify(src)}); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); })()`);
	fs.mkdirSync(path.dirname(out), {recursive: true});
	fs.writeFileSync(out, Buffer.from(b64, 'base64'));
	console.log(out);
	process.exit(0);
}
for (let k = 1; k <= N; k++) {
	const o = N > 1 ? out.replace(/(\.\w+)$/, `-候选${k}$1`) : out;
	await one(o);
}
process.exit(0);
