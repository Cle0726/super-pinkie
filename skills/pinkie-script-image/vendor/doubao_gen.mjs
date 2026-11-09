// 豆包「视频生成」模式（2026-10 新界面）：新对话 → 点「视频生成」→ 选模型 → 选比例和时长 → 上传首帧 → 发提示词 → 打印对话 id
// 用法: node 工具/doubao_gen.mjs <首帧图> "<画面动作描述>" [--model 2.5|2.0] [--ratio 9:16] [--dur 5]
//   之后用 node 工具/doubao_get.mjs <对话id> <输出.mp4> 下载无水印版（没好会提示"还没生成好"）。
// 用户 2026-10-12：只用 Seedance 2.0 或 2.5（Fast / Mini 人物质量太差，禁用）。2.5 旗舰 5 倍消耗，只做 30 秒；其他用 2.0。
// 额度（用户 2026-10-13 改）：免费次数用完、豆包问要不要「消耗付费额度 / 确认生成」时**不确认**——同意的话豆包会偷偷换成 Mini。
//   改成：在同一个对话里重新上传首帧和参考图、再发一遍提示词，这样它还是用 Seedance 2.x。重发 2 次还在问 → 退出码 3 换号（现在 3 个号）。
// 绝不充值 / 购买 / 开通新套餐 / 填支付信息——只有付钱才能继续时，同样退出码 3。
// 豆包生成前会要求确认：回复「确认生成视频，不得省略任何提示词，使用 Seedance 2.x 模型」。
// 前提：豆包桌面版带 --remote-debugging-port=9225 运行（bash 工具/doubao_video.sh 会自动启动）。
import './doubao_lock.mjs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const [img, desc] = argv;
if (!img || !desc) {
	console.error('用法: node 工具/doubao_gen.mjs <首帧图> "<描述>" [--model 2.5|2.0] [--ratio 9:16] [--dur 5] [--ref 参考图::职责 …最多 8 张]');
	process.exit(1);
}
const MODEL = {'2.5': 'Seedance 2.5', '2.0': 'Seedance 2.0'}[opt('--model', '2.0')];
if (!MODEL) {
	console.error('只能用 --model 2.0 或 2.5（Fast / Mini 画质太差，用户不让用）');
	process.exit(1);
}
const RATIO = opt('--ratio', '9:16');
// --resume <对话id>：不开新对话，回到这个对话里重新上传图片、重发提示词（豆包问额度时没点确认的那条，用这个救）
const RESUME = opt('--resume', '');
// 用户 2026-10-12：2.5 只用 30 秒（最划算），其他镜头用 2.0
const DUR = MODEL === 'Seedance 2.5' ? 30 : Number(opt('--dur', '5'));
// 豆包常会偷偷简化提示词：明确要求不得省略；首帧是 GPT 出的定稿图，人物和画风不能变
const CONFIRM = `确认生成视频，不得省略任何提示词，使用 ${MODEL} 模型。`;
// 多图参考（豆包视频模式最多 9 张）：--ref 图:职责 可以重复；第 1 张永远是首帧。参考图的职责逐张写进提示词（每张只管一件事）
const REFS = [];
argv.forEach((a, i) => { if (a === '--ref') { const v = argv[i + 1]; const k = v.indexOf('::'); REFS.push(k > 0 ? {file: v.slice(0, k), role: v.slice(k + 2)} : {file: v, role: '参考'}); } });
console.error('参考图：' + REFS.length + ' 张 ' + REFS.map((r) => path.basename(r.file)).join(', '));
if (argv.includes('--refs-required') && REFS.length === 0) { console.error('镜头要求带人物参考图，但一张都没收到，不提交'); process.exit(9); }
if (argv.includes('--dry-args')) process.exit(0);
if (REFS.length > 8) { console.error('参考图最多 8 张（加首帧共 9 张）'); process.exit(1); }
const refText = REFS.length ? '上传的图片说明：图1是首帧（构图、光线、色调以它为准）；' + REFS.map((r, i) => `图${i + 2}是${r.role}`).join('；') + '。参考图只用来锁定人物和物件的样子，忽略参考图里的白色背景、版式、文字标注和姿势。' : '';
const prompt = `${refText}${desc}。严格以图1为首帧，保持人物/猫的样子、服装、画风和光线完全不变${REFS.length ? '，人物的脸、发型、服装、配饰必须和参考图完全一致' : ''}，镜头运动克制，不要出现任何文字、字幕或水印。不得省略我的所有要求和提示词。${CONFIRM}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch('http://127.0.0.1:9225/json')).json();
const page = targets.find((t) => t.type === 'page' && /doubao-chat\/chat/.test(t.url));
if (!page) throw new Error('找不到豆包聊天页（先运行 bash 工具/doubao_video.sh，或关掉豆包后让它带 9225 端口重开）');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, {once: true}));
let id = 0;
const call = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const my = ++id;
		const h = (ev) => {
			const m = JSON.parse(ev.data);
			if (m.id === my) {
				ws.removeEventListener('message', h);
				m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
			}
		};
		ws.addEventListener('message', h);
		ws.send(JSON.stringify({id: my, method, params}));
	});
const ev = async (expr) => (await call('Runtime.evaluate', {returnByValue: true, awaitPromise: true, expression: expr})).result.value;
const clickAt = async (p) => {
	await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y});
	for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', {type, x: p.x, y: p.y, button: 'left', clickCount: 1});
};
const center = (sel) => `(() => { const e=${sel}; if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2, w:b.width}; })()`;
// 可见、文字匹配的最内层元素（浮层菜单里的 offsetParent 是空的，用 getBoundingClientRect 判断可见）
const byText = (re) => `[...document.querySelectorAll('body *')].filter(e => { const b=e.getBoundingClientRect(); return b.width>0 && b.height>0 && ${re}.test((e.innerText||'').trim()); }).sort((a,b) => (a.innerText||'').length - (b.innerText||'').length)[0]`;
const clickText = async (re, what) => {
	const p = await ev(center(byText(re)));
	if (!p) throw new Error('找不到 ' + what);
	await clickAt(p);
	await sleep(700);
};
const key = async (k) => {
	for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: k, code: k});
};

// 0) 窗口太窄时「视频生成」会被收进「技能」菜单：先把窗口放宽
try {
	const {windowId} = await call('Browser.getWindowForTarget');
	await call('Browser.setWindowBounds', {windowId, bounds: {windowState: 'normal'}});
	await call('Browser.setWindowBounds', {windowId, bounds: {width: 1600, height: 1000}});
} catch {}
// 窗口放宽不一定成功（Browser 域在页面连接上不可用）→ 这次连接里直接把视口放宽，按钮就不会被收进菜单（2026-10-13）
try { await call('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}); await sleep(800); } catch {}
// 1) 新对话（侧栏收起时先展开，新对话按钮在侧栏里）；--resume 时回到那个对话
if (RESUME) {
	await ev(`history.pushState({}, '', '/chat/${RESUME}'); dispatchEvent(new PopStateEvent('popstate', {state: {}}))`);
	await sleep(3500);
	if (!(await ev('location.href')).includes(RESUME)) throw new Error('回不到对话 ' + RESUME);
}
const unfold = await ev(center(`document.querySelector('[aria-label=展开侧栏], [aria-label=显示侧栏]')`));
if (!RESUME && unfold) { await clickAt(unfold); await sleep(800); }
const nb = RESUME ? null : await ev(center(`document.querySelector('[data-testid=create_conversation_button] [role=button]') || document.querySelector('[data-testid=create_conversation_button]')`));
if (nb) await clickAt(nb);
if (!RESUME) await sleep(2500);
// 必须真的是一个空的新对话，否则提示词会发进旧对话（2026-10-12 换号后连发 5 条进了同一个对话）
const busy = () => ev(`document.querySelectorAll('[data-testid=send_message],[data-testid=receive_message]').length`);
for (let i = 0; !RESUME && i < 3 && (await busy()) > 0; i++) {
	const nb2 = await ev(center(`document.querySelector('[aria-label=新对话]')`));
	if (nb2) await clickAt(nb2); else try { await clickText(/^新对话$/, '新对话'); } catch {}
	await sleep(2500);
}
if (!RESUME && (await busy()) > 0) {
	console.error('开不了新对话（页面上还有旧消息），不提交');
	process.exit(6);
}
// 窗口窄时模型、比例/时长按钮会被收进「···」：收起侧栏让输入栏变宽（2026-10-12 换号后遇到）
const fold = await ev(center(`document.querySelector('[aria-label=收起侧栏]')`));
if (fold) { await clickAt(fold); await sleep(800); }
// 2) 视频生成模式（进入后输入框下方会出现「模型 Seedance …」按钮；普通状态下的「视频生成」只是一个技能按钮）
const inMode = () => ev(`!!(${byText('/^模型\\s*Seedance/')})`);
// 新对话刚开时技能栏还没渲染出来（2026-10-19 误报「找不到视频生成按钮」）：最多等 8 秒
for (let i = 0; i < 16 && !(await ev("!!document.querySelector('[data-testid=skill_bar_button_17]')")); i++) await sleep(500);
for (let i = 0; i < 3 && !(await inMode()); i++) {
	const chip = await ev(center(`document.querySelector('[data-testid=skill_bar_button_17]')`));
	if (chip) await clickAt(chip);
	else if (await ev(`!!(${byText('/^视频生成$/')})`)) await clickText(/^视频生成$/, '视频生成按钮');
	else {
		// 收在「技能」菜单里
		const more = await ev(center(`[...document.querySelectorAll('[data-testid=skill_bar_button_more]')].find(e => e.getBoundingClientRect().width > 0)`));
		if (more) await clickAt(more);
		// 菜单弹出慢（2026-10-20 016 第一次提交就没等到）：最多等 6 秒
		let ok = false;
		for (let k = 0; k < 12 && !ok; k++) { await sleep(500); ok = await ev(`!!(${byText('/^视频生成$/')})`); }
		await clickText(/^视频生成$/, '视频生成按钮（技能菜单里）');
	}
	await sleep(1500);
}
if (!(await inMode())) throw new Error('进不了视频生成模式');
// 3) 模型
await clickText(/^模型\s*Seedance/, '模型按钮');
// 只点名字（第一行）正好等于「Seedance 2.0」的那一项：旧写法 ^Seedance 2\.0(\s|$) 也会匹配「Seedance 2.0 Mini」
// （2026-10-12「狼和狗」那条就被生成成了 Mini，用户禁用 Mini / Fast）
{
	const exact = await ev(center(`[...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); const t = (e.innerText || '').trim().split('\\n')[0].trim(); return b.width > 0 && b.height > 0 && t === ${JSON.stringify(MODEL)}; }).sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]`));
	if (!exact) throw new Error('模型菜单里找不到正好叫 ' + MODEL + ' 的一项');
	await clickAt(exact);
	await sleep(700);
}
await key('Escape');
await sleep(400);
// 选完核对：按钮上必须正好是这个模型，带 Mini / Fast / Lite 一律不发
const shown = await ev(`(() => { const e = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().width > 0 && /^模型\\s*Seedance/.test((e.innerText || '').trim())).sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]; return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`);
if (!shown.endsWith(MODEL) || /Mini|Fast|Lite/i.test(shown)) {
	console.error('模型没选对（按钮上是「' + shown + '」），不发送');
	process.exit(7);
}
console.error('模型核对：' + shown);
// 4) 比例 + 时长
await clickText(/^(自动|\d+:\d+)\s*·\s*\d+s$/, '比例/时长按钮');
await clickText(new RegExp('^' + RATIO + '$'), '比例 ' + RATIO);
// 时长滑块：范围随模型变（2.0 是 4–15s），读滑块自己的最小/最大值，点在轨道上对应的位置，再用方向键微调到正好
const track = await ev(`(() => { const s=[...document.querySelectorAll('[role=slider], input[type=range]')].find(e=>e.getBoundingClientRect().width>0); if(!s) return null; let t=s; for(let i=0;i<4 && t.parentElement && t.getBoundingClientRect().width<100;i++) t=t.parentElement; const b=t.getBoundingClientRect(); return {x0:b.x, x1:b.x+b.width, y:b.y+b.height/2, min:+(s.getAttribute('aria-valuemin')||s.min||4), max:+(s.getAttribute('aria-valuemax')||s.max||15)}; })()`);
const curDur = async () => +((await ev(`(() => { const e=${byText('/^(自动|\\d+:\\d+)\\s*·\\s*\\d+s$/')}; return e ? e.innerText : ''; })()`)).match(/(\d+)s/)?.[1] || 0);
if (track) {
	// 2026-10-14：滑块的 aria-valuemax 是"档位"（0–11）不是秒数（4–15s），按它算会把 15s 压成 11s——只认按钮上显示的秒数
	const want = DUR;
	await clickAt({x: track.x1 - 3, y: track.y}); // 先拖到最右（最长）
	await sleep(500);
	let last = -1;
	for (let i = 0; i < 30; i++) {
		const d = await curDur();
		if (!d || d === want) break;
		if (d === last && i > 0 && d < want) break; // 已经到头
		last = d;
		await key(d < want ? 'ArrowRight' : 'ArrowLeft');
		await sleep(150);
	}
	const got = await curDur();
	if (got !== DUR) console.error(`⚠️ 时长只能设到 ${got}s（想要 ${DUR}s）`);
} else console.error('⚠️ 没找到时长滑块，用默认时长');
const setting = await ev(`(() => { const e=${byText('/^(自动|\\d+:\\d+)\\s*·\\s*\\d+s$/')}; return e ? e.innerText.trim() : ''; })()`);
await key('Escape');
await sleep(400);
console.error('设置：', MODEL, '|', setting);
// 5) 上传首帧（+ 参考图）。额度提示时要重发，所以写成函数
const upload = async () => {
	const {root} = await call('DOM.getDocument', {depth: -1, pierce: true});
	const {nodeId} = await call('DOM.querySelector', {nodeId: root.nodeId, selector: 'input[type=file][data-testid=upload-file-input], [data-testid=upload-file-input] input[type=file], input[type=file]'});
	const files = [path.resolve(img), ...REFS.map((r) => path.resolve(r.file))];
	if (nodeId) await call('DOM.setFileInputFiles', {nodeId, files});
	else {
		// 有的号页面上没有现成的 input，要点「+」→「添加图片」才生成（2026-10-20 C.le）：拦截系统选文件框，直接把文件塞给它
		let chooser = null;
		const onChooser = (e) => { const m = JSON.parse(e.data); if (m.method === 'Page.fileChooserOpened') chooser = m.params; };
		ws.addEventListener('message', onChooser);
		await call('Page.enable');
		await call('Page.setInterceptFileChooserDialog', {enabled: true});
		try {
			// 菜单有时慢半拍才出来（2026-10-20 用户003333）：最多试 3 轮，每轮等菜单项真的出现再点它所在的 menuitem
			const item = `(() => { const e=[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect(); return b.width>0 && (e.innerText||'').trim()==='添加图片';}).sort((a,b)=>a.innerHTML.length-b.innerHTML.length)[0]; if(!e) return null; const m=e.closest('[role=menuitem]')||e; const b=m.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`;
			for (let round = 0; round < 3 && !chooser; round++) {
				let p = await ev(item);
				if (!p) {
					const plus = await ev(center(`document.querySelector('[data-testid=upload_file_button]')`));
					if (!plus) throw new Error('找不到上传框');
					await clickAt(plus);
					for (let i = 0; i < 12 && !(p = await ev(item)); i++) await sleep(250);
				}
				if (!p) continue;
				await clickAt(p);
				for (let i = 0; i < 16 && !chooser; i++) await sleep(250);
			}
			if (!chooser) throw new Error('找不到上传框（点了添加图片也没弹选文件）');
			await call('DOM.setFileInputFiles', {backendNodeId: chooser.backendNodeId, files});
		} finally {
			await call('Page.setInterceptFileChooserDialog', {enabled: false});
			ws.removeEventListener('message', onChooser);
		}
	}
	for (let i = 0; i < 150; i++) { // 6 张图要 1 分多钟（2026-10-20）
		await sleep(1000);
		const ok = await ev(`(() => { const box=document.querySelector('[data-testid=chat_input]'); if(!box) return false; return !!box.querySelector('img') && !/上传中|uploading/i.test(box.innerText) && !box.querySelector('[class*=loading],[class*=progress]'); })()`);
		if (ok) break;
		if (i === 149) throw new Error('图片上传超时');
	}
	await sleep(800);
};
await upload();
// 6) 发提示词
const send = async (text) => {
	// 输入框：chat_input_input 现在是外壳，真正可编辑的是里面的 contenteditable / textarea（2026-10-12）
	const ok = await ev(`(() => { const w=document.querySelector('[data-testid=chat_input_input]'); const e=(w && (w.matches('textarea,[contenteditable=true]') ? w : w.querySelector('textarea,[contenteditable=true]'))) || document.querySelector('[data-testid=chat_input] [contenteditable=true], [data-testid=chat_input] textarea'); if(!e) return false; e.focus(); return true; })()`);
	if (!ok) throw new Error('找不到输入框');
	await call('Input.insertText', {text});
	await sleep(600);
	const typed = await ev(`(document.querySelector('[data-testid=chat_input]')?.innerText || '').includes(${JSON.stringify(text.slice(0, 12))})`);
	if (!typed) throw new Error('提示词没填进输入框，不发送');
	const sb = await ev(center(`document.querySelector('[data-testid=chat_input_send_button]')`));
	if (sb) await clickAt(sb);
	else for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined});
};
const recvCount = () => ev(`document.querySelectorAll('[data-testid=receive_message]').length`);
let baseline = await recvCount(); // 每次发消息/点按钮前记下回复条数：只看这之后的新回复（2026-10-13：旧的「参数确认」卡被当成已开始）
await send(prompt);
// 7) 拿对话 id。豆包要确认（和额度无关）→ 点确认按钮或回确认话术；
//    免费次数用完、问要不要用额度 → 不确认，重新上传图片 + 重发提示词（用户 2026-10-13 的办法，避免偷换 Mini），最多 2 次，还问就退出码 3 换号；
//    只有充值/购买/开通才能继续 → 退出码 3 换号（不点任何付钱的按钮）
const lastReply = () => ev(`(() => { const r=[...document.querySelectorAll('[data-testid=receive_message]')].pop(); return r ? r.innerText : ''; })()`);
// 确认按钮可能是 button，也可能是消息下面的「建议回复」小块（suggest-message，如「确认生成」）——用真实鼠标点
const okPos = () =>
	ev(`(() => { const r=[...document.querySelectorAll('[data-testid=receive_message]')].pop(); if(!r) return null; let box=r; for(let i=0;i<4&&box.parentElement;i++) box=box.parentElement; const c=[...box.querySelectorAll('button,[role=button],[class*=suggest] span,[class*=suggest]')].filter(e=>{ const b=e.getBoundingClientRect(); const t=(e.innerText||'').trim(); return b.width>0 && t.length<=12 && /^(确认生成|继续生成|确认|继续|同意)/.test(t) && !/额度|充值|购买|开通|支付|升级|订阅/.test(t); }); const e=c.sort((x,y)=>(x.innerText||'').length-(y.innerText||'').length)[0]; if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2, t:(e.innerText||'').trim()}; })()`);
// 真的开始生成了的标志
const FAILED = /无法继续|未找到|请重新上传|生成失败|无法生成/; // 豆包说图片没传上/失败：不算开始（2026-10-13 H5 就是这样被误记成已提交）
const STARTED = /生成中|已开始|开始生成|预计等待|大约需要|本次使用 ?Seedance|本次生成将消耗|生成好了|视频已生成|正在为你生成/;
let conv = '';
let acted = 0;
let started = false;
let lastAct = -99;
let resent = 0;
const resend = async () => {
	baseline = await recvCount();
	await upload();
	await send(prompt);
	resent++;
	console.error(`问要不要用额度：没确认，重新上传图片、重发提示词（第 ${resent} 次）`);
};
// 问的是"要不要用额度"（免费次数用完了）：这种不确认，重发
const QUOTA_ASK = /付费额度|会员额度|消耗.{0,6}额度|使用.{0,4}额度|额度.{0,10}(继续|生成|确认)|免费次数.{0,8}(用完|已用)/;
for (let round = 0; round < 4; round++) {
started = false;
for (let i = 0; i < 120; i++) {
	await sleep(2000);
	conv = (await ev('location.href')).match(/chat\/(\d+)/)?.[1] || conv;
	if ((await recvCount()) <= baseline) continue; // 新回复还没出来
	const r = await lastReply();
	if (/充值|购买|开通会员|升级会员|立即支付|订阅/.test(r) && !/消耗付费额度|使用付费额度|付费额度/.test(r)) {
		console.error('QUOTA_OUT 本账号免费和会员额度都用完了（只剩充值/购买，不点）：' + r.slice(0, 80));
		process.exit(3);
	}
	if (/额度已用完|额度不足/.test(r) && !/付费额度/.test(r)) {
		console.error('QUOTA_OUT 本账号额度用完：' + r.slice(0, 80));
		process.exit(3);
	}
	// 2026-10-14：首帧 / 参考图没被识别（"首帧参考资源未被系统识别…请重新上传图1"）——没开始生成，不算已提交
	if (/未被(系统)?识别|请重新上传|没有收到.{0,6}(图|首帧)|无法读取.{0,6}(图|首帧)/.test(r) && !/本次使用 ?Seedance/.test(r)) {
		console.error('NOT_STARTED 图片没被识别，没开始生成：' + r.slice(0, 80) + ' 对话 ' + conv);
		process.exit(9);
	}
	// 回复里出现 Mini / Fast：还在问确认就不确认、要求改回；已经开始生成了就报警作废
	if (/Seedance\s*2\.\d\s*(Mini|Fast|Lite)/i.test(r)) {
		if (STARTED.test(r) && !/请确认|确认后|是否/.test(r)) {
			console.error('⚠️ 豆包自己换成了 Mini/Fast 在生成（用户禁用），这条作废：' + conv);
			console.log(conv);
			process.exit(8);
		}
		if (acted < 2 && i - lastAct > 4) {
			baseline = await recvCount();
			await send(`模型必须用 ${MODEL}，不能用 Mini 或 Fast，请改成 ${MODEL} 后再生成。${CONFIRM}`);
			console.error('回复里是 Mini/Fast：已要求改回 ' + MODEL);
			acted++;
			lastAct = i;
		}
		continue;
	}
	const asking = /是否继续|是否确认|请确认|请先确认|确认后|请回复|确认生成|是否使用/.test(r);
	// 「确认后我再开始生成视频」里也有"开始生成"：只要还在问确认，就不算开始
	if (FAILED.test(r)) { console.error('豆包说失败/图片没传上，新开对话重提：' + r.slice(0, 80)); console.log(conv); process.exit(10); }
	if (STARTED.test(r) && !asking) {
		started = true;
		break;
	}
	if ((asking || QUOTA_ASK.test(r)) && QUOTA_ASK.test(r) && i - lastAct > 4) {
		if (resent >= (argv.includes('--resend') ? 2 : 0)) { // 用户 2026-10-13：问额度时不确认，同一个号【新开对话】重发（同对话重发会被换成 Mini）→ 退出码 10，doubao_video.sh 新开对话重提
			console.error('QUOTA_ASK 问要不要用额度（不确认，新开对话重提）：' + r.slice(0, 80));
			console.log(conv);
			process.exit(10);
		}
		await resend();
		lastAct = i;
		continue;
	}
	if (asking && i - lastAct > 4) {
		if (acted >= 4) break; // 确认了好几次还没开始：停下来人工查，不再重复发
		const p = await okPos();
		baseline = await recvCount();
		if (p) {
			await clickAt(p);
			console.error('已确认：点了「' + p.t + '」');
		} else {
			await send(CONFIRM);
			console.error('已确认：发了确认话术');
		}
		acted++;
		lastAct = i;
	}
}
// 「视频生成中」的卡片出现后，豆包有时紧接着又说「近 7 天的额度用完了」并取消（2026-10-12 H5 就这样被误记成已提交）；
// 也可能这时才说「本次使用 Seedance 2.0 Mini」——再盯 30 秒
let again = false;
for (let i = 0; started && i < 15; i++) {
	await sleep(2000);
	const r = await lastReply();
	if (QUOTA_ASK.test(r) && /是否|确认/.test(r) && !/生成中|预计等待|大约需要/.test(r)) {
		if (resent >= (argv.includes('--resend') ? 2 : 0)) { // 同上：退出码 10
			console.error('QUOTA_ASK 问要不要用额度（不确认，新开对话重提）：' + r.slice(0, 80));
			console.log(conv);
			process.exit(10);
		}
		await resend();
		lastAct = -99;
		again = true;
		break;
	}
	if (/额度已?用完|额度不足|升级订阅套餐|升级到.{0,6}套餐/.test(r) && !/生成中|预计等待|大约需要/.test(r)) { // 2026-10-19：豆包写的是「额度已用完」，原来的「额度用完」匹配不上 → CAT 两次被误记成已提交
		console.error('QUOTA_OUT 开始后又被取消：' + r.slice(0, 80));
		process.exit(3);
	}
	if (/Seedance\s*2\.\d\s*(Mini|Fast|Lite)/i.test(r)) {
		console.error('⚠️ 豆包自己换成了 Mini/Fast 在生成（用户禁用），这条作废：' + conv);
		console.log(conv);
		process.exit(8);
	}
}
if (!again) break;
}
if (!started) {
	console.error('⚠️ 没看到「生成中」——对话 ' + conv + ' 需要人工查（不要重复提交）：' + (await lastReply()).slice(-120).replace(/\n/g, ' '));
	console.log(conv);
	process.exit(5);
}
console.error('回复：', (await lastReply()).slice(0, 120).replace(/\n/g, ' '));
console.log(conv);
ws.close();
