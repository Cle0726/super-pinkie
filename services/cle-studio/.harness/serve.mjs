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
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('not found: ' + url.pathname); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(18823, '127.0.0.1', () => console.log('harness on http://127.0.0.1:18823/'));
