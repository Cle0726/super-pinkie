// 豆包 App 界面小工具（CDP 9225）：截图、点击、按键——切账号、排查页面用。
// 用法:
//   node 工具/doubao_ui.mjs shot <输出.jpg>                 截当前窗口
//   node 工具/doubao_ui.mjs click '<css 选择器>'           真实鼠标点击元素中心
//   node 工具/doubao_ui.mjs clicktext '<文字>'            点击显示这段文字的最内层元素
//   node 工具/doubao_ui.mjs key Escape                    按键
//   node 工具/doubao_ui.mjs eval '<js 表达式>'             在页面里求值（排查用）
//   node 工具/doubao_ui.mjs whoami                        当前登录的账号名
//   node 工具/doubao_ui.mjs accounts                      列出所有已登录账号
//   node 工具/doubao_ui.mjs switch [账号名]               不给名字：当前号记为今天用完，切到下一个没用完的号（都用完退出码 3）
import fs from 'node:fs';

const [, , cmd, arg] = process.argv;
const targets = await (await fetch('http://127.0.0.1:9225/json')).json();
const page = targets.find((t) => t.type === 'page' && /doubao-chat\/chat/.test(t.url)) || targets.find((t) => t.type === 'page' && /doubao/.test(t.url));
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
const WHO = `(() => { const e=document.querySelector('[data-testid=sidebar_bottom]'); return e ? e.innerText.split('\\n')[0].replace(/[〉>]/g,'').trim() : ''; })()`;
const ROWS = `[...document.querySelectorAll('[data-testid=avatar_menu_account_row]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2, t:e.innerText.trim()}; })`;
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
} else if (cmd === 'type') {  // 在输入框里输入文字（2026-10-20：云电脑工作任务换重置机会用）
	const ok = await ev(`(() => { const w=document.querySelector('[data-testid=chat_input_input]'); const e=(w && (w.matches('textarea,[contenteditable=true]') ? w : w.querySelector('textarea,[contenteditable=true]'))) || document.querySelector('[contenteditable=true], textarea'); if(!e) return false; e.focus(); return true; })()`);
	if (!ok) throw new Error('找不到输入框');
	await call('Input.insertText', {text: arg});
	console.log('typed', arg.length);
} else if (cmd === 'clickxy') {  // 按截图像素坐标点（自动除以 devicePixelRatio）
	const dpr = await ev('window.devicePixelRatio');
	const [x, y] = arg.split(',').map(Number);
	await clickAt({x: x / dpr, y: y / dpr});
	console.log('clicked', x, y);
} else if (cmd === 'whoami') {
	console.log(await ev(WHO));
} else if (cmd === 'accounts' || cmd === 'switch') {
	// 窗口窄时「更多账号」子菜单展不开、第三个号看不到（2026-10-13）→ 这次连接里把视口放宽
	try { await call('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}); await new Promise((r) => setTimeout(r, 800)); } catch {}
	// 账号菜单：左下角账号按钮 → 主菜单里有 1–2 个账号行，其余在「更多账号」子菜单里（都是 avatar_menu_account_row）
	// accounts：列出所有已登录账号
	// switch [账号名]：不给名字 = 把当前号记为"今天额度用完"，切到今天还没用完的下一个号；全都用完 → 退出码 3
	const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
	const name = (t) => t.split('\n')[0].trim();
	// 侧栏收起时左下角账号按钮不在页面上 → 先展开（2026-10-13）
	const unfold = await ev(`(() => { const e=document.querySelector('[aria-label=展开侧栏], [aria-label=显示侧栏]'); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	if (unfold) { await clickAt(unfold); await sleep(1200); }
	const before = await ev(WHO);
	const btn = await ev(`(() => { const e=document.querySelector('[data-testid=sidebar_bottom] button')||document.querySelector('[data-testid=sidebar_bottom]'); const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	await clickAt(btn);
	await sleep(1000);
	if (!(await ev(ROWS)).length) { await clickAt(btn); await sleep(1000); }  // 菜单可能本来就开着，第一下把它关了
	const more = await ev(`(() => { const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.getBoundingClientRect().width>0 && e.innerText.trim()==='更多账号'); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
	if (more) {
		await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: more.x, y: more.y});
		await clickAt(more); // 只悬停有时展不开「更多账号」子菜单（2026-10-13）→ 再点一下
		await sleep(1200);
	}
	const rows = (await ev(ROWS)).map((r) => ({...r, name: name(r.t)}));
	const all = [...new Set(rows.map((r) => r.name))];
	const close = async () => { for (let i = 0; i < 2; i++) { for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: 'Escape', code: 'Escape'}); await sleep(200); } };
	if (cmd === 'accounts') {
		await close();
		console.log(JSON.stringify(all));
	} else {
		const day = new Date().toLocaleDateString('sv');  // 豆包免费额度按天算
		const stateFile = new URL(`../临时/豆包额度-${day}.json`, import.meta.url);
		let used = [];
		try { used = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
		if (!arg && before && !used.includes(before)) used.push(before);
		fs.mkdirSync(new URL('../临时/', import.meta.url), {recursive: true});
		fs.writeFileSync(stateFile, JSON.stringify(used));
		const want = arg || all.find((n) => n !== before && !used.includes(n));
		const norm = (s) => (s || '').replace(/[\s ​]+/g, '').trim();  // 账号名里可能有不换行空格（2026-10-19「C.le .」匹配不上）
		const row = rows.find((r) => norm(r.name) === norm(want));
		if (!row) {
			await close();
			console.error(arg ? `菜单里没有账号 ${arg}：${JSON.stringify(all)}` : `今天所有账号的免费视频额度都用完了：${JSON.stringify(used)}`);
			ws.close();
			process.exit(3);
		}
		await clickAt(row);
		// 切号会让页面整体重载、连接断开：这里只报告切去哪，之后用 whoami 确认
		console.log('switching', before, '→', want);
		ws.close();
		await sleep(8000);
		process.exit(0);
	}
} else if (cmd === 'eval') {
	console.log(await ev(arg));
} else if (cmd === 'key') {
	for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: arg, code: arg});
	console.log('key', arg);
}
await new Promise((s) => setTimeout(s, 800));
ws.close();
