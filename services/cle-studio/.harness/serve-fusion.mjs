// 只服务融合任务需要的几个文件：真实 src/styles/tokens.css、bridge.css、
// static/legacy/presentation.css 和 src/legacy/utilities.js（用 esbuild 即时打成 ESM）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const TYPES = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html'};
const PORT = Number(process.env.FUSION_HARNESS_PORT || 18824);

let utilBundle = null;
async function bundleUtilities() {
  const out = await build({
    entryPoints: [path.join(root, 'src/legacy/utilities.js')],
    bundle: true, format: 'esm', write: false, target: 'safari17', logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body, type) => { res.setHeader('Content-Type', type); res.end(body); };
  try {
    if (url.pathname === '/' || url.pathname === '/fusion.html') {
      return send(fs.readFileSync(path.join(here, 'fusion.html')), 'text/html');
    }
    if (url.pathname === '/brand-audit.html') {
      return send(fs.readFileSync(path.join(here, 'brand-audit.html')), 'text/html');
    }
    if (url.pathname === '/utilities.js') {
      utilBundle ||= await bundleUtilities();
      return send(utilBundle, 'text/javascript');
    }
    if (url.pathname === '/laser.js') {
      return send(fs.readFileSync(path.join(root, 'static/legacy/laolao-laser-pointer.js')), 'text/javascript');
    }
    if (url.pathname === '/capabilities.js') {
      return send(fs.readFileSync(path.join(root, 'static/legacy/laolao-capabilities.js')), 'text/javascript');
    }
    if (url.pathname === '/brand.js') {
      const out = await build({
        entryPoints: [path.join(root, 'src/core/brand.js')],
        bundle: true, format: 'esm', write: false, target: 'safari17', logLevel: 'silent',
      });
      return send(out.outputFiles[0].text, 'text/javascript');
    }
    if (url.pathname === '/memory.js') {
      return send(fs.readFileSync(path.join(root, 'static/legacy/laolao-memory.js')), 'text/javascript');
    }
    const map = {
      '/tokens.css': 'src/styles/tokens.css',
      '/bridge.css': 'src/styles/bridge.css',
      '/presentation.css': 'static/legacy/presentation.css',
      '/settings-user.css': 'static/legacy/laolao-settings-user.css',
      '/capabilities.css': 'static/legacy/capabilities.css',
      '/usage.css': 'static/legacy/laolao-usage-stats.css',
      '/shell.css': 'src/styles/shell.css',
      '/memory.css': 'static/legacy/laolao-memory.css',
    };
    if (map[url.pathname]) {
      // 不缓存：改完样式立刻能量到，避免测到上一版
      res.setHeader('Cache-Control', 'no-store');
      return send(fs.readFileSync(path.join(root, map[url.pathname])), 'text/css');
    }
    res.statusCode = 404;
    res.end('not found');
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error?.stack || error));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`fusion harness http://127.0.0.1:${PORT}/`));
