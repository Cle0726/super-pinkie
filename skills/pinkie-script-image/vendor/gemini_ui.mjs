// Gemini 网页界面小工具（专用 Chrome，CDP 9333，先 bash 工具/gemini_chrome.sh）：截图、点击、按键——切账号、排查页面用。
// 用法:
//   node 工具/gemini_ui.mjs shot <输出.jpg>                 截当前窗口
//   node 工具/gemini_ui.mjs click '<css 选择器>'           真实鼠标点击元素中心
//   node 工具/gemini_ui.mjs clicktext '<文字>'            点击显示这段文字的最内层元素
//   node 工具/gemini_ui.mjs key Escape                    按键
//   node 工具/gemini_ui.mjs eval '<js 表达式>'             在页面里执行并打印
import fs from 'node:fs';

const [, , cmd, arg] = process.argv;
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const re = new RegExp(process.env.TAB || 'gemini.google.com');  // TAB=flow 选 Flow 标签页（2026-10-28）
const page = targets.find((t) => t.type === 'page' && re.test(t.url)) || targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, {once: true}));
let id = 0;
const call = (method, params = {}) =>
	new Promise((resolve) => {
		const my = ++id;
		const h = (ev) => {
			const m = JSON.parse(ev.data);
			if (m.id === my) {
				ws.removeEventListener('message', h);
				resolve(m.result || {});
			}
		};
		ws.addEventListener('message', h);
		ws.send(JSON.stringify({id: my, method, params}));
	});
const ev = async (expr) => (await call('Runtime.evaluate', {returnByValue: true, expression: expr})).result?.value;
const clickAt = async (p) => {
	await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y});
	for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', {type, x: p.x, y: p.y, button: 'left', clickCount: 1});
};

if (cmd === 'shot') {
	const r = await call('Page.captureScreenshot', {format: 'jpeg', quality: 70});
	fs.writeFileSync(arg || 'doubao.jpg', Buffer.from(r.data, 'base64'));
	console.log(arg);
} else if (cmd === 'click') {
	const p = await ev(`(() => { const e=document.querySelector(${JSON.stringify(arg)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	if (!p) throw new Error('找不到 ' + arg);
	await clickAt(p);
	console.log('clicked', arg);
} else if (cmd === 'clicktext') {
	const p = await ev(`(() => { const t=${JSON.stringify(arg)}; const all=[...document.querySelectorAll('body *')].filter(e => e.offsetParent !== null && e.textContent.trim() === t); const e=all.pop(); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	if (!p) throw new Error('找不到文字 ' + arg);
	await clickAt(p);
	console.log('clicked text', arg);
} else if (cmd === 'upload') {
	// upload '<触发选择文件的按钮选择器>' <文件>：截住"选择文件"对话框直接塞文件（Flow 用，2026-10-28）
	const file = process.argv[4];
	await call('Page.enable');
	await call('DOM.enable');
	await call('Page.setInterceptFileChooserDialog', {enabled: true});
	const got = new Promise((res) => ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Page.fileChooserOpened') res(m.params); }));
	const p = await ev(`(() => { const e=document.querySelector(${JSON.stringify(arg)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	if (!p) throw new Error('找不到 ' + arg);
	await clickAt(p);
	const c = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 8000))]);
	if (!c) throw new Error('没弹出选择文件');
	await call('DOM.setFileInputFiles', {files: [file], backendNodeId: c.backendNodeId});
	await call('Page.setInterceptFileChooserDialog', {enabled: false});
	console.log('uploaded', file);
} else if (cmd === 'type') {
	// type '<输入框选择器>' '<文字>'：点进输入框，用 Input.insertText 打字（Flow 对 execCommand 填字报过「异常活动」）
	const p = await ev(`(() => { const e=document.querySelector(${JSON.stringify(arg)}); if(!e) return null; e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	if (!p) throw new Error('找不到 ' + arg);
	await clickAt(p);
	await new Promise((s) => setTimeout(s, 500));
	await call('Input.insertText', {text: process.argv[4]});
	console.log('typed', process.argv[4].length);
} else if (cmd === 'eval') {
	console.log(JSON.stringify(await ev(arg), null, 1));
} else if (cmd === 'key') {
	for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: arg, code: arg});
	console.log('key', arg);
}
await new Promise((s) => setTimeout(s, 800));
ws.close();
