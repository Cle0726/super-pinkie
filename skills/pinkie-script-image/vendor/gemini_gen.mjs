// Gemini（网页版，用户的 Pro 会员）生成图片 / 视频 / 音乐，并下载完整尺寸文件。
// 前提：bash 工具/gemini_chrome.sh（专用 Chrome，CDP 9333，用户已登录一次）
// 用法: node 工具/gemini_gen.mjs <image|video|music> "<提示词>" --out <输出文件> [--image <参考/首帧图>] [--aspect 纵向|横向|<菜单里的文字>]
// 定位：图片 = 背景、纹理、简单角色小素材（完整尺寸约 1696x2528，比 Codex 清楚）；视频 = 豆包两个号都用完时的备选；
//       音乐 = 随机性大，优先自己用代码合成，需要时再试。主力仍是代码。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const mode = argv[0];
const prompt = argv[1];
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const out = opt('--out');
const img = opt('--image');
const aspect = opt('--aspect');
if (!['image', 'video', 'music'].includes(mode) || !prompt || !out) {
	console.error('用法: node 工具/gemini_gen.mjs <image|video|music> "<提示词>" --out <文件> [--image <图>] [--aspect 纵向]');
	process.exit(1);
}
const TOOL = {image: '制作图片', video: '制作视频', music: '制作音乐'}[mode];
// 和豆包一样：模型常会偷偷简化提示，明确要求不得省略
const STRICT = mode === 'music' || process.env.GEMINI_STRICT === '0' ? '' : ' 不得省略我的所有要求和提示词；画面里不要出现任何文字、水印或标志。';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const connect = async () => {
	const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
	const page = targets.find((t) => t.type === 'page' && /gemini.google.com/.test(t.url));
	if (!page) throw new Error('找不到 Gemini 页面（先 bash 工具/gemini_chrome.sh）');
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener('open', r, {once: true}));
	return ws;
};
let ws = await connect();
let id = 0;
const listeners = [];
const hook = () => ws.addEventListener('message', (ev) => {
	const m = JSON.parse(ev.data);
	for (const l of listeners) l(m);
});
hook();
// 生成要等几分钟，期间页面会换地址、连接偶尔会断 → 每次调用都限时，超时就重连再试
const call1 = (method, params) =>
	new Promise((resolve, reject) => {
		const my = ++id;
		const timer = setTimeout(() => {
			ws.removeEventListener('message', h);
			reject(new Error('CDP 超时 ' + method));
		}, 20000);
		const h = (ev) => {
			const m = JSON.parse(ev.data);
			if (m.id === my) {
				clearTimeout(timer);
				ws.removeEventListener('message', h);
				resolve(m.result || {});
			}
		};
		ws.addEventListener('message', h);
		try {
			ws.send(JSON.stringify({id: my, method, params}));
		} catch (e) {
			clearTimeout(timer);
			reject(e);
		}
	});
const call = async (method, params = {}) => {
	for (let i = 0; ; i++) {
		try {
			return await call1(method, params);
		} catch (e) {
			if (i >= 3) throw e;
			console.error('连接异常，重连：' + e.message);
			try { ws.close(); } catch {}
			ws = await connect();
			hook();
			await call1('Page.enable', {}).catch(() => {});
		}
	}
};
const ev = async (e) => (await call('Runtime.evaluate', {returnByValue: true, awaitPromise: true, expression: e})).result?.value;
const clickAt = async (p) => {
	await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y});
	for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', {type, x: p.x, y: p.y, button: 'left', clickCount: 1});
};
const pos = (js) => ev(`(() => { const e=(${js}); if(!e) return null; e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
const clickSel = async (sel, tries = 20) => {
	for (let i = 0; i < tries; i++) {
		const p = await pos(`document.querySelector(${JSON.stringify(sel)})`);
		if (p) return clickAt(p);
		await sleep(500);
	}
	throw new Error('找不到 ' + sel);
};
const clickText = async (t, scope = 'body') => {
	// 浮层菜单里的元素 offsetParent 为空、文字旁还有图标 → 用"可见 + 文字以它开头 + 文字不长"找最深的那个
	const p = await pos(`[...document.querySelectorAll(${JSON.stringify(scope + ' *')})].filter(e => e.getClientRects().length > 0 && (e.textContent||'').trim().startsWith(${JSON.stringify(t)}) && (e.textContent||'').trim().length < ${JSON.stringify(t)}.length + 12).pop()`);
	if (!p) throw new Error('找不到文字 ' + t);
	await clickAt(p);
};

const hasText = (t) => ev(`[...document.querySelectorAll('body *')].some(e => e.getClientRects().length > 0 && (e.textContent||'').trim() === ${JSON.stringify(t)})`);
// --fetch：不发新提示，直接下载当前对话里最新的结果
const FETCH = argv.includes('--fetch');
// --fetch --conv <对话地址>：先打开那个对话（视频超时后常常过一会儿才出来，2026-10-27）
if (FETCH && opt('--conv')) {
	await call('Page.enable');
	await call('Page.navigate', {url: opt('--conv')});
	await sleep(9000);
	ws.close();
	ws = await connect();
	hook();
}
if (!FETCH) {
// 1) 新对话
await call('Page.enable');
await call('Page.navigate', {url: process.env.GEMINI_U ? `https://gemini.google.com/u/${process.env.GEMINI_U}/app` : 'https://gemini.google.com/app'});  // GEMINI_U=0/1/2 选账号（三个 Gemini 号轮换，用户 2026-10-26）
await sleep(7000); // 页面慢的时候 4 秒还没出输入框按钮
ws.close();
ws = await connect();
hook();
await call('Page.enable');
// 2) 选工具（页面刚加载完时第一下常点不开菜单 → 点完确认菜单里有目标项，没有就再点）
// 上一次用过的工具有时会保留（输入框下方有"取消选择“图片”"按钮）→ 已经在这个模式就不用再选
const CHIP = {image: '图片', video: '视频', music: '音乐'}[mode];
const already = await ev(`!!document.querySelector('button[aria-label="取消选择“${CHIP}”"]')`);
for (let i = 0; i < 6 && !already; i++) {
	await clickSel('button[aria-label="上传和工具"]');
	await sleep(1200);
	if (await hasText(TOOL)) break;
	await call('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape'});
	await sleep(1500);
}
if (!already) {
	// 菜单偶尔没打开（页面刚加载完）：点不到就再开一次菜单
	for (let i = 0; ; i++) {
		try {
			await clickText(TOOL);
			break;
		} catch (e) {
			if (i >= 4) throw e;
			await call('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape'});
			await sleep(1500);
			await clickSel('button[aria-label="上传和工具"]');
			await sleep(1500);
		}
	}
}
await sleep(1200);
// 3) 宽高比
// 图片模式没有宽高比按钮（比例写进提示词）→ 找不到就跳过，不中断
// 视频模式一定有：按钮出来得慢，3 秒没等到就跳过 → Gemini 默认出 16:9（026 S2 拿到 1280×720，2026-10-28）→ 视频选不上比例直接失败，让外层换号重试
if (aspect) {
	try {
		await clickSel('button[aria-label^="宽高比"]', mode === 'video' ? 30 : 6);
		await sleep(900);
		await clickText(aspect, '.cdk-overlay-container');
		await sleep(700);
	} catch (e) {
		if (mode === 'video') {
			console.error('视频模式找不到宽高比选项「' + aspect + '」：' + e.message);
			process.exit(5);
		}
		console.error('没有宽高比选项，跳过（比例请写在提示词里）');
	}
}
// 4) 参考图 / 首帧：截住"选择文件"对话框，直接塞文件
if (img) {
	await call('Page.setInterceptFileChooserDialog', {enabled: true});
	let chooser = null;
	listeners.push((m) => {
		if (m.method === 'Page.fileChooserOpened') chooser = m.params;
	});
	const direct = await pos(`document.querySelector('button[aria-label="文件上传"]')`);
	if (direct) await clickAt(direct);
	else {
		await clickSel('button[aria-label="上传和工具"]');
		await sleep(800);
		// 2026-10-20 网页改版：菜单项从「上传文件」改成了「文件」
		let fp = null;
		for (let k = 0; k < 4 && !fp; k++) {  // 菜单可能本来就开着，点一下反而关了 → 找不到就再点一次
			if (k) { await clickSel('button[aria-label="上传和工具"]'); await sleep(1000); }
			fp = await pos(`[...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.getClientRects().length && /^(上传文件|文件)$/.test((e.textContent||'').trim())).pop()`);
		}
		if (!fp) throw new Error('找不到「文件」菜单项');
		await clickAt(fp);
	}
	for (let i = 0; i < 20 && !chooser; i++) await sleep(300);
	await call('DOM.enable');
	if (chooser) await call('DOM.setFileInputFiles', {files: [path.resolve(img)], backendNodeId: chooser.backendNodeId});
	else {  // 2026-10-20 改版后点「文件」不一定弹对话框 → 直接给页面里的 input[type=file] 塞文件
		const doc = await call('DOM.getDocument', {depth: -1, pierce: true});
		const q = await call('DOM.querySelectorAll', {nodeId: (doc.root || doc.result?.root).nodeId, selector: 'input[type=file]'});
		const ids = q.nodeIds || (q.result && q.result.nodeIds) || [];
		if (!ids.length) throw new Error('没弹出选择文件对话框，页面里也没有 input[type=file]');
		await call('DOM.setFileInputFiles', {files: [path.resolve(img)], nodeId: ids[0]});
	}
	await call('Page.setInterceptFileChooserDialog', {enabled: false});
	// 等缩略图出现、上传转圈消失（2026-10-27：旧判断找不到缩略图也照发 → Gemini 回"请上传图片"）
	let up = false;
	for (let i = 0; i < 90 && !up; i++) {
		await sleep(700);
		up = await ev(`(() => { const p=document.querySelector('uploader-file-preview'); if(!p) return false; const im=p.querySelector('img'); if(!im||!im.complete||!im.naturalWidth) return false; return ![...p.querySelectorAll('mat-progress-spinner,[role=progressbar]')].some(e=>e.getClientRects().length) && !/上传中|uploading/i.test(p.innerText); })()`);
	}
	if (!up) throw new Error('首帧图 60 秒内没传上去，不发提示');
	await sleep(1500);
}
// 5) 发提示
await ev(`document.querySelector('rich-textarea .ql-editor').focus()`);
await call('Input.insertText', {text: prompt + STRICT});
await sleep(500);
for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined});
console.error('已发送，等待生成…');
if (img) {
	await sleep(4000);
	const sentImg = await ev(`(() => { const q=[...document.querySelectorAll('user-query')].pop(); return !!q && !!q.querySelector('img'); })()`);
	if (!sentImg) { console.error('发出去的消息里没有首帧图（上传没赶上）→ 停止，重跑'); process.exit(5); }
}
}
// 6) 等结果：出现"下载"按钮（图片/视频/音乐都有）
const limit = +(process.env.GEMINI_WAIT || (mode === 'image' ? 180 : 900)); // 秒（视频高峰期 10 分钟不够，2026-10-27）
let label = null;
for (let i = 0; i < limit / 3; i++) {
	await sleep(3000);
	label = await ev(`(() => { const b=[...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||'').filter(l=>/下载/.test(l)); return b.pop() || null; })()`);
	if (label) break;
	const refused = await ev(`(() => { const r=[...document.querySelectorAll('message-content, model-response')].pop(); return r ? r.innerText.slice(0, 200) : ''; })()`);
	if (refused && /无法|不能|没法|爱莫能助|语言模型|文本 AI|抱歉|无权|容量|稍后再试|can't|unable|capacity|try again/i.test(refused) && i > 3) {
		console.error('Gemini 拒绝或失败：' + refused);
		process.exit(4);
	}
}
if (!label) {
	console.error('等不到结果（超时）：' + (await ev('location.href')));
	process.exit(2);
}
// 7) 下载：鼠标先悬停在结果上，再点可见的下载按钮，截住下载文件
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-dl-'));
let done = null;
listeners.push((m) => {
	if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') done = true;
});
await call('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: dir, eventsEnabled: true});
const media = await pos(`[...document.querySelectorAll('img.image.loaded, generated-music, video, audio, model-response')].pop()`);
if (media) await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: media.x, y: media.y});
await sleep(800);
const btn = await pos(`[...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label')||'') === ${JSON.stringify(label)}).pop()`);
await sleep(500);
const btn2 = await pos(`[...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label')||'') === ${JSON.stringify(label)}).pop()`);
await clickAt(btn2 || btn);
// 音乐的下载会先弹菜单（视频 / 音频和封面图片 / 纯音频）→ 选纯音频（MP3）
await sleep(1200);
if (await hasText('纯音频')) await clickText('纯音频', '.cdk-overlay-container');
for (let i = 0; i < 120 && !done; i++) await sleep(500);
if (!done && !fs.readdirSync(dir).some((n) => !n.endsWith('.crdownload'))) {
	// 第一下偶尔没点上（2026-10-12 Windows 上遇到）：再悬停、再点一次
	if (media) await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: media.x, y: media.y});
	await sleep(800);
	const btn3 = await pos(`[...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label')||'') === ${JSON.stringify(label)}).pop()`);
	if (btn3) await clickAt(btn3);
	for (let i = 0; i < 120 && !done; i++) await sleep(500);
}
await call('Browser.setDownloadBehavior', {behavior: 'default'});
const f = fs.readdirSync(dir).find((n) => !n.endsWith('.crdownload'));
if (!f) {
	console.error('下载没完成');
	process.exit(3);
}
fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
fs.copyFileSync(path.join(dir, f), out);
fs.rmSync(dir, {recursive: true, force: true});
console.log(out, '（' + label + '，对话 ' + (await ev('location.href')) + '）');
ws.close();
