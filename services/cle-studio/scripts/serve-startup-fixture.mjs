#!/usr/bin/env node
/**
 * Startup fixture server: serve the patched Control UI exactly as the gateway would
 * (root-mounted assets) plus the plugin's static route, with no gateway behind it.
 *
 * That is the point: the first frame must already be C.le. before any websocket
 * exists, and when the app cannot connect the screen must show a real error rather
 * than a blank window. Used by the startup review; not part of the shipped plugin.
 *
 *   node scripts/serve-startup-fixture.mjs --ui <dist/control-ui> --static <plugin/static> [--port 20889]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const UI = path.resolve(arg('ui', ''));
const STATIC = path.resolve(arg('static', ''));
const PORT = Number(arg('port', '20889'));
if (!fs.existsSync(path.join(UI, 'index.html'))) throw new Error(`--ui must point at a built Control UI (${UI})`);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

const CSP = [
  "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:", "media-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com", "worker-src 'self'",
  "connect-src 'self' ws: wss: data: blob:",
].join('; ');

function send(res, file, status = 200) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
    return;
  }
  res.writeHead(status, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/cle/static/')) {
    const file = path.resolve(STATIC, pathname.slice('/cle/static/'.length));
    if (!file.startsWith(STATIC + path.sep)) { res.writeHead(403).end(); return; }
    send(res, file);
    return;
  }
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(UI, rel);
  if (file.startsWith(UI + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    if (path.extname(file) === '.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(fs.readFileSync(file));
      return;
    }
    send(res, file);
    return;
  }
  // SPA fallback, exactly like the gateway: deep routes get the same document
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': CSP,
    'Cache-Control': 'no-cache',
  });
  res.end(fs.readFileSync(path.join(UI, 'index.html')));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({url: `http://127.0.0.1:${PORT}/`, ui: path.relative(process.cwd(), UI), static: path.relative(process.cwd(), STATIC)}));
});
