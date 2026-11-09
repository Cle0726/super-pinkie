// 豆包窗口只有一个：同一时间只能有一个脚本在操作它（2026-10-12 几个下载/提交脚本同时跑，互相抢窗口，乱点、记错对话 id）
// 用法：import './doubao_lock.mjs'（放在最前面）。拿不到锁就等（最多 30 分钟），进程退出时自动释放。
import fs from 'node:fs';
import path from 'node:path';
const LOCK = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '临时', '豆包.lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.dirname(LOCK), {recursive: true});
for (let i = 0; ; i++) {
	try {
		fs.mkdirSync(LOCK);
		fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid));
		break;
	} catch {
		let stale = false;
		try {
			const pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8'));
			try { process.kill(pid, 0); } catch { stale = true; }
		} catch { stale = Date.now() - fs.statSync(LOCK).mtimeMs > 60000; }
		if (stale) { fs.rmSync(LOCK, {recursive: true, force: true}); continue; }
		if (i === 0) console.error('豆包窗口正被另一个脚本使用，排队等…');
		if (i > 900) throw new Error('等豆包锁超过 30 分钟');
		await sleep(2000);
	}
}
const release = () => { try { if (fs.readFileSync(path.join(LOCK, 'pid'), 'utf8') === String(process.pid)) fs.rmSync(LOCK, {recursive: true, force: true}); } catch {} };
process.on('exit', release);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { release(); process.exit(1); });
