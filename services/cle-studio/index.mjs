// C.le. Studio backend: serves the large static brand files (paintings, vendor bundles)
// that do not belong inside the 4 MiB browser entry. Same origin, read-only, no listing.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const TYPES = {'.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm'};
const PREFIX = '/cle/static/';

export default {
  id: 'cle-studio',
  register(api) {
    api.registerHttpRoute?.({path: PREFIX, match: 'prefix', auth: 'plugin', handler(req, res) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return true; }
      const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(PREFIX.length));
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('Not found'); return true; }
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.statusCode = 200;
      if (req.method === 'HEAD') { res.end(); return true; }
      fs.createReadStream(file).pipe(res);
      return true;
    }});
    api.logger?.info?.(`C.le. studio ready state=${process.env.OPENCLAW_STATE_DIR || '-'} config=${process.env.OPENCLAW_CONFIG_PATH || '-'} profile=${process.env.OPENCLAW_PROFILE || '-'}`);
  },
};
