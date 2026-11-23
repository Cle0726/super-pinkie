// Metre UI 预览服务（只给本机看效果用，不���仓库）。
// 原生聊天页（build\windows-runtime 里的 control-ui）+ 本 worktree 的 laolao-* 注入 + 页面内假网关。
// 只改「这次发给浏览器的」假网关副本：让 Metre 解锁查询回答「不需要密码」。产品代码、解锁门槛不动。
// node preview-server.mjs <port>
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const WT = 'C:\\Users\\34786\\Projects\\pinkie-wt\\metre-ui';
const UI = 'F:\\Projects\\super-pinkie\\build\\windows-runtime\\node_modules\\openclaw\\dist\\control-ui';
const HERE = 'F:\\Projects\\super-pinkie\\build\\quick-run\\mui';
const PORT = Number(process.argv[2] || 5191);
if (PORT === 18789) throw new Error('never 18789');
const TYPES = {'.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm'};
const type = (f) => TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
function indexHtml() {
  let html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  const frag = fs.readFileSync(path.join(WT, 'ui/injections/laolao-head.fragment.html'), 'utf8').replace(/\?v=@hash/g, '?v=preview');
  const tag = /[ \t]*(?:<script\b[^>]*\blaolao-[^>]*>\s*<\/script>|<link\b[^>]*\blaolao-[^>]*>)[ \t]*\r?\n?/g;
  const first = html.search(tag);
  html = html.replace(tag, '').replace(/<!--\s*pinkie-native-assets\s*-->\s*/g, '');
  const at = first >= 0 ? Math.min(first, html.length) : html.indexOf('</head>');
  html = html.slice(0, at) + frag + '\n' + html.slice(at);
  html = html.replace('<head>', '<head><script src="/__preview-init.js"></script><script src="/__fake-gateway.js"></script><script src="/__v3.js"></script>');
  html = html.replace('</head>', '<link rel="stylesheet" href="/__v3.css"></head>');
  html = html.replace('</body>', '<script src="/__preview.js"></script></body>');
  return html;
}
function fakeGateway() {
  let s = fs.readFileSync(path.join(WT, 'scripts/chat-ui-harness/fake-gateway.js'), 'utf8');
  const lock = "case 'pinkie.guard.metreStatus': case 'pinkie.guard.metreLock': case 'pinkie.guard.metreUnlock': return ok({locked: false, required: false, unlocked: true, configured: true});\n      ";
  if (!s.includes("default: return ok({});")) throw new Error('fake gateway shape changed');
  return s.replace("default: return ok({});", lock + "default: return ok({});");
}
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const p = decodeURIComponent(url.pathname); const base = path.basename(p);
    const send = (body, t) => { res.writeHead(200, {'Content-Type': t, 'Cache-Control': 'no-store'}); res.end(body); };
    if (p === '/__fake-gateway.js') return send(fakeGateway(), TYPES['.js']);
    const own = /^\/__([\w-]+)\.(js|css)$/.exec(p);
    if (own) { const f = path.join(HERE, own[1] + '.' + own[2]); if (fs.existsSync(f)) return send(fs.readFileSync(f), type(f)); }
    if (/sw\.js$|service-worker/.test(p)) { res.writeHead(404); return res.end(); }
    if (base.startsWith('laolao-')) for (const dir of ['ui/injections', 'ui/assets']) { const f = path.join(WT, dir, base); if (fs.existsSync(f)) return send(fs.readFileSync(f), type(f)); }
    const local = path.join(UI, p);
    if (p !== '/' && local.startsWith(UI) && fs.existsSync(local) && fs.statSync(local).isFile()) return send(fs.readFileSync(local), type(local));
    if (p === '/' || !path.extname(base)) return send(indexHtml(), TYPES['.html']);
    res.writeHead(404); res.end();
  } catch (e) { res.writeHead(500); res.end(String(e)); console.error(e); }
});
server.listen(PORT, '127.0.0.1', () => console.log('preview: http://127.0.0.1:' + PORT + '/chat?session=agent%3Ametre%3Adashboard%3Apreview1&harnessSession=active&empty=1'));
