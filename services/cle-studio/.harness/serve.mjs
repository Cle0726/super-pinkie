// Throwaway server for the effects harness: serves the real src/process modules plus the
// shipped legacy renderer, so the check exercises the actual code paths and not a copy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const types = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json'};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file;
  if (url.pathname === '/' || url.pathname === '/effects.html') file = path.join(here, 'effects.html');
  else if (url.pathname === '/perf.html') file = path.join(here, 'perf.html');
  else if (url.pathname === '/panes.html') file = path.join(here, 'panes.html');
  else if (url.pathname === '/diag.html') file = path.join(here, 'diag.html');
  else if (url.pathname === '/diag2.html') file = path.join(here, 'diag2.html');
  else if (url.pathname === '/diag3.html') file = path.join(here, 'diag3.html');
  else if (url.pathname === '/diag4.html') file = path.join(here, 'diag4.html');
  else if (url.pathname === '/diag5.html') file = path.join(here, 'diag5.html');
  else if (url.pathname === '/diag6.html') file = path.join(here, 'diag6.html');
  else if (url.pathname === '/diag7.html') file = path.join(here, 'diag7.html');
  else if (url.pathname === '/diag8.html') file = path.join(here, 'diag8.html');
  else if (url.pathname === '/effects.css') file = path.join(root, 'src/process/effects.css');
  else if (url.pathname === '/status.js') file = path.join(root, 'src/process/status.js');
  else if (url.pathname === '/model.js') file = path.join(root, 'src/process/model.js');
  else if (url.pathname === '/particles.js') file = path.join(root, 'src/process/particles.js');
  else if (url.pathname === '/focus.js') file = path.join(root, 'src/process/focus.js');
  else if (url.pathname === '/split.js') file = path.join(root, 'src/rooms/split.js');
  else if (url.pathname.startsWith('/cle/static/legacy/')) file = path.join(root, 'static/legacy', url.pathname.slice('/cle/static/legacy/'.length));
  else if (url.pathname.startsWith('/rooms/')) file = path.join(root, 'src/rooms', url.pathname.slice('/rooms/'.length));
  else if (url.pathname.startsWith('/line/')) file = path.join(root, 'src/line', url.pathname.slice('/line/'.length));
  else if (url.pathname.startsWith('/core/')) file = path.join(root, 'src/core', url.pathname.slice('/core/'.length));
  // split.js imports './rooms.js' and '../line/line.js'; serve those relatives so the module
  // graph loads as it does in the bundle.
  else if (url.pathname === '/rooms.js') file = path.join(root, 'src/rooms/rooms.js');
  else if (url.pathname === '/rooms/rooms.js') file = path.join(root, 'src/rooms/rooms.js');
  else if (url.pathname === '/rooms/blink.js') file = path.join(root, 'src/rooms/blink.js');
  else if (url.pathname === '/blink.js') file = path.join(root, 'src/rooms/blink.js');
  else if (url.pathname === '/welcome.js') file = path.join(root, 'src/rooms/welcome.js');
  else if (url.pathname === '/flowers.js') file = path.join(root, 'src/rooms/flowers.js');
  else if (url.pathname === '/decorate.js') file = path.join(root, 'src/line/decorate.js');
  else if (url.pathname === '/line.js') file = path.join(root, 'src/line/line.js');
  else if (url.pathname === '/line/line.js') file = path.join(root, 'src/line/line.js');
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('not found: ' + url.pathname); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(18823, '127.0.0.1', () => console.log('harness on http://127.0.0.1:18823/'));
