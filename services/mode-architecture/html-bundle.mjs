// tools-health-1113 D3：把一个成品页面打成**一个**自带样式、脚本和图片的 HTML 文件。
// 只读本机文件：本地的 <link rel=stylesheet>、<script src>、<img>/<source>/<video poster>、
// CSS 里的 url(...) 和 @import 都内联进来（图片、字体变 data: 地址）。网上的地址原样留着、不去下载，
// 结果里数出有几个，让用户知道断网时哪些会缺。不上传、不托管。
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', json: 'application/json', css: 'text/css', js: 'text/javascript',
};
export const MAX_BUNDLE_BYTES = 30 * 1024 * 1024;

const isRemote = ref => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) && !/^file:/i.test(ref);
const isInline = ref => /^(?:data:|blob:|#|javascript:|about:)/i.test(ref);

function resolveLocal(ref, baseDir) {
  if (!ref || isInline(ref) || isRemote(ref)) return null;
  let clean = ref.split('#')[0].split('?')[0];
  try { clean = decodeURIComponent(clean); } catch {}
  if (/^file:/i.test(clean)) clean = clean.replace(/^file:\/\/\/?/i, process.platform === 'win32' ? '' : '/');
  const file = path.isAbsolute(clean) ? clean : path.resolve(baseDir, clean);
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

function dataUri(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}
function setAttr(tag, name, value) {
  return tag.replace(new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`, 'i'), (_, pre) => `${pre}"${value.replace(/"/g, '&quot;')}"`);
}

export function bundleHtml(html, baseDir, {maxBytes = MAX_BUNDLE_BYTES} = {}) {
  const stats = {inlined: 0, missing: [], remote: new Set()};
  const note = (ref, file) => {
    if (file) stats.inlined++;
    else if (!ref || isInline(ref)) return;
    else if (isRemote(ref)) stats.remote.add(ref);
    else stats.missing.push(ref);
  };

  const css = (text, dir, depth = 0) => text
    .replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*;/gi, (all, ref) => {
      const file = depth < 5 && resolveLocal(ref, dir);
      note(ref, file);
      return file ? css(fs.readFileSync(file, 'utf8'), path.dirname(file), depth + 1) : all;
    })
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, _q, ref) => {
      const file = resolveLocal(ref.trim(), dir);
      note(ref.trim(), file);
      return file ? `url("${dataUri(file)}")` : all;
    });

  let out = html
    // <link rel="stylesheet" href="local.css"> → <style>
    .replace(/<link\b[^>]*>/gi, tag => {
      if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) {
        if (/\brel\s*=\s*["']?[^"'>]*icon/i.test(tag)) {
          const ref = attr(tag, 'href'), file = resolveLocal(ref, baseDir);
          note(ref, file);
          return file ? setAttr(tag, 'href', dataUri(file)) : tag;
        }
        return tag;
      }
      const ref = attr(tag, 'href'), file = resolveLocal(ref, baseDir);
      note(ref, file);
      return file ? `<style>\n${css(fs.readFileSync(file, 'utf8'), path.dirname(file)).replace(/<\/style/gi, '<\\/style')}\n</style>` : tag;
    })
    // <script src="local.js"></script> → inline
    .replace(/<script\b([^>]*)\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)([^>]*)>\s*<\/script>/gi, (all, pre, quoted, post) => {
      const ref = quoted.replace(/^["']|["']$/g, ''), file = resolveLocal(ref, baseDir);
      note(ref, file);
      return file ? `<script${pre}${post}>\n${fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>` : all;
    })
    // <style> blocks: url() / @import
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, body, close) => open + css(body, baseDir) + close)
    // style="... url(...)"
    .replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (all, _q, dq, sq) => {
      const body = dq ?? sq ?? '';
      if (!/url\(/i.test(body)) return all;
      return ` style="${css(body, baseDir).replace(/"/g, '&quot;')}"`;
    })
    // <img src>, <source src>, <video poster>, <audio src>, <input type=image src>
    .replace(/<(img|source|video|audio|input|track|embed)\b[^>]*>/gi, tag => {
      let next = tag;
      for (const name of ['src', 'poster']) {
        const ref = attr(next, name);
        if (ref === null) continue;
        const file = resolveLocal(ref, baseDir);
        note(ref, file);
        if (file) next = setAttr(next, name, dataUri(file));
      }
      const srcset = attr(next, 'srcset');
      if (srcset) {
        const parts = srcset.split(',').map(part => {
          const [ref, ...rest] = part.trim().split(/\s+/);
          const file = resolveLocal(ref, baseDir);
          note(ref, file);
          return [file ? dataUri(file) : ref, ...rest].join(' ');
        });
        next = setAttr(next, 'srcset', parts.join(', '));
      }
      return next;
    });

  if (Buffer.byteLength(out) > maxBytes) throw new Error(`打包后超过 ${Math.round(maxBytes / 1024 / 1024)} MB，太大了`);
  return {html: out, inlined: stats.inlined, missing: [...new Set(stats.missing)], remote: [...stats.remote]};
}

export function bundleHtmlFile(file, {baseDir = path.dirname(file), ...options} = {}) {
  return bundleHtml(fs.readFileSync(file, 'utf8'), baseDir, options);
}
