// 用豆包自己的“下载”按钮下载视频。需先核对账号水印设置；lr=unwatermarked 不是画面无水印的质检证据。
// 做法：打开对话 → 鼠标移到最后一个视频上 → 点它的下载按钮 → 截住下载文件 → 移到 <输出.mp4>。
// 用法: node 工具/doubao_get.mjs <对话id> <输出.mp4>   未生成完时退出码 2
// 注意：消息里的 download_url / video_list 都是带"豆包AI生成"水印的预览，别再用。
import './doubao_lock.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , conv, out] = process.argv;
// --nth N：一个对话里有好几个视频时，下第 N 个（从上往下数，1 起）；默认最后一个
const NTH = process.argv.includes('--nth') ? Number(process.argv[process.argv.indexOf('--nth') + 1]) : 0;
const PICK = `(a => ${NTH} > 0 ? a[${NTH} - 1] : a[a.length - 1])`;
if (!conv || !out) {
	console.error('用法: node 工具/doubao_get.mjs <对话id> <输出.mp4>');
	process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 2026-11-05：豆包窗口最小化时页面 visibilityState=hidden → 不渲染，下载按钮宽 0、截图卡死。
// 用 Win32 ShowWindow(4 = SW_SHOWNOACTIVATE) 还原，不抢焦点、不动鼠标。
{
	const {execFileSync} = await import('node:child_process');
	const ps = `Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);}';Get-Process Doubao|?{$_.MainWindowHandle -ne 0 -and [W]::IsIconic($_.MainWindowHandle)}|%{[W]::ShowWindow($_.MainWindowHandle,4)|Out-Null;'restored'}`;
	try { if (execFileSync('powershell', ['-NoProfile', '-Command', ps], {encoding: 'utf8'}).includes('restored')) await sleep(1500); } catch {}
}

const targets = await (await fetch('http://127.0.0.1:9225/json')).json();
const page = targets.find((t) => t.type === 'page' && /doubao-chat\/chat/.test(t.url)); // 切号后会多一个 doubao-chat/cross-site-support 页，别连到它上面（2026-10-20）
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, {once: true}));
let id = 0;
let done = null;
ws.addEventListener('message', (ev) => {
	const m = JSON.parse(ev.data);
	if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') done = m.params.filePath || 'ok';
});
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
// 先关掉可能开着的大图页（「图片与视频」）
for (let i = 0; i < 3 && (await ev(`[...document.querySelectorAll('body *')].some(e => e.children.length === 0 && (e.innerText||'').trim() === '图片与视频' && e.getBoundingClientRect().width > 0)`)); i++) {
	for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: 'Escape', code: 'Escape'});
	await sleep(800);
}
// 窗口太窄时视频缩成小块、悬停层（下载按钮）不出来（2026-10-13）：这次连接里把视口放宽，断开后自动恢复
await call('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
await sleep(800);
// 打开这个对话：在聊天页里走前端路由跳转（Mac 上靠 doubao-cli 的 sessions open；Windows 版直接改 location.href 会另开隐藏网页，不能用）
if (!(await ev('location.href')).includes(conv)) {
	await ev(`history.pushState({}, '', '/chat/${conv}'); dispatchEvent(new PopStateEvent('popstate', {state: {}}))`);
	await sleep(2500);
}

// 确认已经打开的是这个对话，且视频已出现
let p = null;
for (let i = 0; i < 25 && !p; i++) {
	await sleep(1000);
	p = await ev(`(() => { if (!location.href.includes(${JSON.stringify(conv)})) return null; const v=${PICK}([...document.querySelectorAll('[class*=video-player-wrapper]')]); if(!v) return null; v.scrollIntoView({block:'center'}); const b=v.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
}
if (!p) {
	console.log('还没生成好');
	ws.close();
	process.exit(2);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-dl-'));
await call('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: dir, eventsEnabled: true});
// 悬停后下载按钮才出现；滚动后位置会变 → 每次重新取视频位置，换几个点悬停
let q = null;
for (let i = 0; i < 10 && !q; i++) {
	await sleep(600);
	const v = await ev(`(() => { const v=${PICK}([...document.querySelectorAll('[class*=video-player-wrapper]')]); const b=v.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2, h:b.height}; })()`);
	await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: v.x + (i % 3) * 20 - 20, y: v.y - v.h * 0.25 + (i % 2) * 30});
	await sleep(1000);
	q = await ev(`(() => { const vb=${PICK}([...document.querySelectorAll('[class*=video-player-wrapper]')]).getBoundingClientRect(); const all=[...document.querySelectorAll('[data-testid=edit_image_hover_tag_download_btn]')].map(e=>e.getBoundingClientRect()).filter(b=>b.width>0 && b.y+b.height/2>=vb.y && b.y+b.height/2<=vb.y+vb.height); const b=all[0]; if(!b) return null; return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`); // 每个视频都有自己的下载按钮：取落在这个视频里的那个
}
// 2026-10-20 豆包改版：悬停层只剩「画布」按钮，下载挪到了点开视频后右侧「图片与视频」面板顶上的「保存」（edit_image_download_button）
let viaPanel = false;
if (!q) {
	const v = await ev(`(() => { const v=${PICK}([...document.querySelectorAll('[class*=video-player-wrapper]')]); const b=v.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', {type, x: v.x, y: v.y, button: 'left', clickCount: 1});
	for (let i = 0; i < 12 && !q; i++) {
		await sleep(700);
		q = await ev(`(() => { const e=[...document.querySelectorAll('[data-testid=edit_image_download_button]')].find(e=>e.getBoundingClientRect().width>0); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	}
	viaPanel = !!q;
}
if (!q) { console.log('下载按钮没出来，稍后重试'); ws.close(); process.exit(2); } // 悬停层偶尔不出来：当作还没好，下一轮再试
// 点之前确认鼠标下面真的是下载按钮（悬停层还没出来就点，会点到视频本身、打开「图片与视频」大图页——2026-10-12 用户看到的"乱点"）
const onBtn = await ev(`(() => { const e=document.elementFromPoint(${q.x}, ${q.y}); return !!(e && e.closest('[data-testid=edit_image_hover_tag_download_btn], [data-testid=edit_image_download_button]')); })()`);
if (!onBtn) { console.log('还没生成好'); ws.close(); process.exit(2); }
await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: q.x, y: q.y});
await sleep(700);
for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', {type, x: q.x, y: q.y, button: 'left', clickCount: 1});
for (let i = 0; i < 1200 && !done; i++) await sleep(500); // 网慢时（2026-10-12 实测 50–80 KB/s）一条要几分钟，最多等 10 分钟
await call('Browser.setDownloadBehavior', {behavior: 'default'});
ws.close();
const f = fs.readdirSync(dir).find((n) => n.endsWith('.mp4'));
if (!done || !f) throw new Error('下载没完成');
fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
fs.copyFileSync(path.join(dir, f), out);
fs.rmSync(dir, {recursive: true, force: true});
console.log('已下载（尚未检查实际画面水印；须解码并核对全景、近景、首中尾帧后才可批准）', out);
