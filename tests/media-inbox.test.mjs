// tools-health-1113 A4: image / pdf read the files users hand them.
//   A4-1 a file outside the allowed folders is read through media/inbox
//   A4-2 credentials and keys stay refused (Mac and Windows layouts)
//   A4-3 a PDF over the cap: split by pages, or page count + outline as a normal result
//   A4-4 inbox copies older than 24 h are removed
// The PDF tests need clawpdf from a real OpenClaw runtime and skip without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as inbox from '../patch/pinkie-media-inbox.mjs';
import {transform, transformTools} from '../patch/apply-image-access.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperFile = path.join(root, 'patch/pinkie-media-inbox.mjs');
const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `pk-a4-${tag}-`));
const HOUR = 60 * 60 * 1000;

// ---------- A4-2: refused folders, both platforms' layouts ----------

test('A4-2 Mac: ~/.ssh, Keychains, ~/.openclaw/credentials, ~/.config/super-pinkie stay refused', () => {
  const opts = {platform: 'darwin', home: '/Users/u', env: {}};
  for (const file of [
    '/Users/u/.ssh/id_rsa',
    '/Users/u/.ssh/config',
    '~/.ssh/id_ed25519',
    'file:///Users/u/.ssh/id_rsa',
    '/Users/u/.SSH/id_rsa', // APFS is case-insensitive
    '/Users/u/Library/Keychains/login.keychain-db',
    '/Users/u/.openclaw/credentials/feishu.json',
    '/Users/u/.openclaw/identity/device.json',
    '/Users/u/.config/super-pinkie/install.env',
    '/Users/u/Library/Application Support/SuperPinkie/guard/status.json',
    '/Users/u/Desktop/../.ssh/id_rsa',
  ]) assert.equal(inbox.deniedMediaPath(file, opts), true, file);
  for (const file of [
    '/Users/u/Desktop/note.png',
    '/tmp/th-test/note-1.png',
    '/Users/u/Library/Containers/com.tencent.xinWeChat/Data/book.pdf',
    '/Users/u/.openclaw/workspace-learning/media/inbox/a.png',
    '/Users/u/.openclaw/media/x.png',
    '/Users/u/.sshfoo/x.png',
  ]) assert.equal(inbox.deniedMediaPath(file, opts), false, file);
  // A state dir moved by OPENCLAW_STATE_DIR keeps its credentials refused.
  assert.equal(inbox.deniedMediaPath('/Volumes/x/state/credentials/a.json', {...opts, env: {OPENCLAW_STATE_DIR: '/Volumes/x/state'}}), true);
});

test('A4-2 Windows: .ssh, state credentials, guard data and Credential Manager stay refused', () => {
  const env = {
    APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
    OPENCLAW_STATE_DIR: 'D:\\pinkie\\state',
    PINKIE_STATE_ROOT: 'D:\\pinkie\\root',
  };
  const opts = {platform: 'win32', home: 'C:\\Users\\u', env};
  for (const file of [
    'C:\\Users\\u\\.ssh\\id_rsa',
    'C:/Users/u/.ssh/id_ed25519', // forward slashes
    'c:\\users\\U\\.SSH\\id_rsa', // NTFS is case-insensitive
    'C:\\Users\\u\\.openclaw\\credentials\\qqbot.json',
    'D:\\pinkie\\state\\credentials\\feishu.json',
    'D:\\pinkie\\state\\identity\\device.json',
    // The settings guard's data (Windows: %LOCALAPPDATA%\SuperPinkie\guard, or PINKIE_STATE_ROOT\guard).
    'C:\\Users\\u\\AppData\\Local\\SuperPinkie\\guard\\status.json',
    'D:\\pinkie\\root\\guard\\guard-manifest.sig',
    // Credential Manager and DPAPI.
    'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Credentials\\ABCDEF',
    'C:\\Users\\u\\AppData\\Local\\Microsoft\\Credentials\\ABCDEF',
    'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Protect\\S-1-5-21\\key',
    'C:\\Users\\u\\AppData\\Local\\Microsoft\\Vault\\4BF4C442\\Policy.vpol',
    'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Vault\\x',
    'C:\\Users\\u\\.config\\super-pinkie\\install.env',
  ]) assert.equal(inbox.deniedMediaPath(file, opts), true, file);
  for (const file of [
    'C:\\Users\\u\\AppData\\Local\\Temp\\th-test\\note-1.png',
    'C:\\Users\\u\\Documents\\WeChat Files\\wxid\\FileStorage\\File\\book.pdf',
    'C:\\Users\\u\\AppData\\Local\\SuperPinkie\\backups\\a.png',
    'D:\\pinkie\\state\\workspace-learning\\media\\inbox\\a.png',
    'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\x.png',
  ]) assert.equal(inbox.deniedMediaPath(file, opts), false, file);
  // Without APPDATA / LOCALAPPDATA the default profile folders are used.
  assert.equal(inbox.deniedMediaPath('C:\\Users\\u\\AppData\\Local\\Microsoft\\Credentials\\x', {platform: 'win32', home: 'C:\\Users\\u', env: {}}), true);
});

test('A4-2 the patched boundary check refuses them first, even inside an allowed root', () => {
  const patched = transform(`import path from "node:path";
async function resolveLocalMediaBoundary(mediaPath, localRoots) {
\tconst roots = localRoots ?? getDefaultLocalRootsCore();
\tconst resolved = await resolveLocalMediaPathForContainment(mediaPath);
\treturn {roots,resolved};
}
/** Verifies that a local media path is managed inbound media or lives under allowed roots. */
async function assertLocalMediaAllowed(mediaPath, localRoots, options) {
\tif (localRoots === "any") return;
}`);
  assert.match(patched, /^\/\* pinkie-image-access:v5 \*\/\nimport \{ deniedMediaPath as _pinkieDeniedMediaPath \} from "\.\/pinkie-media-inbox\.mjs";/);
  // Both entry points, before anything else (also before localRoots === "any").
  assert.equal(patched.split('\tif (_pinkieDeniedMediaPath(mediaPath)) throw _pinkieDeniedError(mediaPath);\n').length, 3);
  assert.match(patched, /async function assertLocalMediaAllowed\(mediaPath, localRoots, options\) \{\n\tif \(_pinkieDeniedMediaPath\(mediaPath\)\) throw/);
  assert.equal(transform(patched), patched);
});

// A real OpenClaw dist (never modified) for the runtime-level checks.
function realDist() {
  const home = os.homedir();
  return [
    process.env.PINKIE_TEST_OPENCLAW_DIST,
    path.join(home, 'release-superpinkie/sandbox/openclaw-pristine/dist'),
    '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist',
    // Windows: a runtime copy, e.g. the isolated copy's (never the installed app).
  ].filter(Boolean).find((dir) => {
    try { return fs.readdirSync(dir).some((n) => /^local-media-access-[^.]+\.m?js$/u.test(n)); } catch { return false; }
  });
}
const dist = realDist();

test('A4-2 the real patched local-media-access refuses ~/.ssh with the home folder allowed', {skip: !dist && 'no OpenClaw runtime (set PINKIE_TEST_OPENCLAW_DIST)'}, async () => {
  const name = fs.readdirSync(dist).find((n) => /^local-media-access-[^.]+\.m?js$/u.test(n)
    && /function assertLocalMediaAllowed\(/u.test(fs.readFileSync(path.join(dist, n), 'utf8')));
  const dir = tmpDir('lma');
  fs.copyFileSync(helperFile, path.join(dir, 'pinkie-media-inbox.mjs'));
  const text = transform(fs.readFileSync(path.join(dist, name), 'utf8'))
    .replace(/(from |import )"\.\/(?!pinkie-media-inbox)([^"]+)"/gu, (_, head, rel) => `${head}"${pathToFileURL(path.join(dist, rel)).href}"`);
  const file = path.join(dir, name.replace(/\.js$/u, '.mjs'));
  fs.writeFileSync(file, text);
  const mod = await import(pathToFileURL(file).href);
  const assertAllowed = Object.values(mod).find((fn) => fn.name === 'assertLocalMediaAllowed');
  const home = os.homedir();
  await assert.rejects(assertAllowed(path.join(home, '.ssh', 'id_rsa'), [home]), {code: 'path-not-allowed'});
  await assert.rejects(assertAllowed(path.join(home, '.openclaw', 'credentials', 'x.json'), [home]), {code: 'path-not-allowed'});
  await assertAllowed(path.join(home, 'Desktop', 'note.png'), [home]);
});

// ---------- A4-1 / A4-4: the inbox ----------

test('A4-1 a file outside the allowed folders is copied into media/inbox and read from there', async () => {
  const dir = tmpDir('stage');
  const workspaceDir = path.join(dir, 'workspace-learning');
  const outside = path.join(dir, 'th-test', 'note-1.png');
  fs.mkdirSync(path.dirname(outside), {recursive: true});
  fs.writeFileSync(outside, 'png-bytes');
  const copy = await inbox.stageIntoInbox(outside, {workspaceDir});
  assert.equal(path.dirname(copy), path.join(workspaceDir, 'media', 'inbox'));
  assert.match(path.basename(copy), /^[0-9a-f]{12}-note-1\.png$/);
  assert.equal(fs.readFileSync(copy, 'utf8'), 'png-bytes');
  assert.equal(await inbox.stageIntoInbox(`file://${outside.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`, {workspaceDir}), copy, 'the same file reuses its copy');
  assert.equal(await inbox.stageIntoInbox(copy, {workspaceDir}), copy, 'a copy is not copied again');
  // Not copied: missing files, folders, URLs, no workspace, refused folders.
  assert.equal(await inbox.stageIntoInbox(path.join(dir, 'missing.png'), {workspaceDir}), null);
  assert.equal(await inbox.stageIntoInbox(path.dirname(outside), {workspaceDir}), null);
  assert.equal(await inbox.stageIntoInbox('https://example.com/a.png', {workspaceDir}), null);
  assert.equal(await inbox.stageIntoInbox(outside, {workspaceDir: ''}), null);
  const sshHome = path.join(dir, 'home');
  fs.mkdirSync(path.join(sshHome, '.ssh'), {recursive: true});
  fs.writeFileSync(path.join(sshHome, '.ssh', 'id_rsa'), 'secret');
  assert.equal(await inbox.stageIntoInbox(path.join(sshHome, '.ssh', 'id_rsa'), {workspaceDir, home: sshHome}), null);
  assert.equal(fs.readdirSync(path.join(workspaceDir, 'media', 'inbox')).length, 1);
});

test('A4-4 inbox copies not read for 24 hours are removed; a re-read keeps one', async () => {
  const dir = tmpDir('sweep');
  const workspaceDir = path.join(dir, 'workspace');
  const box = inbox.inboxDir(workspaceDir);
  fs.mkdirSync(box, {recursive: true});
  const now = Date.now();
  const at = (file, ageMs) => { fs.writeFileSync(file, 'x'); const when = new Date(now - ageMs); fs.utimesSync(file, when, when); return file; };
  const stale = at(path.join(box, 'aaaaaaaaaaaa-old.pdf'), 25 * HOUR);
  const fresh = at(path.join(box, 'bbbbbbbbbbbb-new.png'), 23 * HOUR);
  fs.mkdirSync(path.join(box, 'keep-dir'));
  assert.deepEqual(inbox.sweepInbox(box, {now, force: true}), [stale]);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(path.join(box, 'keep-dir')), true, 'only files are swept');
  // Staging sweeps on its own (throttled); reading a file again restarts its 24 h.
  const source = path.join(dir, 'book.pdf');
  fs.writeFileSync(source, 'pdf');
  const copy = await inbox.stageIntoInbox(source, {workspaceDir, now: now - 30 * HOUR});
  const old2 = at(path.join(box, 'cccccccccccc-older.png'), 48 * HOUR);
  await inbox.stageIntoInbox(source, {workspaceDir, now});
  assert.ok(Math.abs(fs.statSync(copy).mtimeMs - now) < 2000, 're-read touches the copy');
  assert.deepEqual(inbox.sweepInbox(box, {now: now + 25 * HOUR, force: true}).sort(), [copy, fresh, old2].sort());
  assert.deepEqual(inbox.sweepInbox(box, {now: now + 26 * HOUR}), [], 'throttled without force');
});

test('A4-1 loadImage: refused folder → inbox copy; GIF over the cap → a still; refused stays refused', async () => {
  const dir = tmpDir('img');
  const workspaceDir = path.join(dir, 'workspace');
  const outside = path.join(dir, 'tmp', 'shot.png');
  fs.mkdirSync(path.dirname(outside), {recursive: true});
  fs.writeFileSync(outside, 'img');
  const allowed = (p) => p.startsWith(workspaceDir);
  const notAllowed = (p) => Object.assign(new Error(`Local media path is not under an allowed directory: ${p}`), {code: 'path-not-allowed', name: 'LocalMediaAccessError'});
  const loads = [];
  const load = async (p) => { loads.push(p); if (!allowed(p)) throw notAllowed(p); return {kind: 'image', buffer: fs.readFileSync(p), contentType: 'image/png'}; };
  const media = await inbox.loadImage({source: outside, workspaceDir, maxBytes: 100, load, webMedia: {}});
  assert.equal(media.buffer.toString(), 'img');
  assert.equal(loads.length, 2);
  assert.equal(path.dirname(loads[1]), inbox.inboxDir(workspaceDir));
  // A GIF over the cap is sent as a still image instead of being refused.
  const gif = path.join(workspaceDir, 'big.gif');
  fs.writeFileSync(gif, 'GIF89a...');
  const seen = [];
  const webMedia = {optimizeImageBufferForWebMedia: async (params) => {
    seen.push(params.contentType);
    if (params.contentType === 'image/gif') throw new Error('GIF exceeds 6MB limit (got 7.33MB)');
    return {kind: 'image', buffer: Buffer.from('jpeg'), contentType: 'image/jpeg'};
  }};
  const gifLoad = async () => { throw new Error('GIF exceeds 6MB limit (got 7.33MB)'); };
  const still = await inbox.loadImage({source: gif, workspaceDir, maxBytes: 6 << 20, load: gifLoad, webMedia});
  assert.equal(still.contentType, 'image/jpeg');
  assert.deepEqual(seen, ['image/gif', 'image/png']);
  // Other failures, and refused folders, are passed through unchanged.
  await assert.rejects(inbox.loadImage({source: outside, workspaceDir, load: async () => { throw new Error('Local media file not found'); }, webMedia}), /not found/);
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.ssh'), {recursive: true});
  fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'secret');
  const saved = process.env.HOME, savedProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  try {
    if (os.homedir() === home) {
      await assert.rejects(inbox.loadImage({source: path.join(home, '.ssh', 'id_rsa'), workspaceDir, load, webMedia}), {code: 'path-not-allowed'});
    }
  } finally { process.env.HOME = saved; process.env.USERPROFILE = savedProfile; }
  // data: URLs are decoded past the cap and shrunk afterwards.
  assert.equal(inbox.dataUrlReadCap(6 << 20), 50 << 20);
  assert.equal(inbox.dataUrlReadCap(80 << 20), 80 << 20);
});

// ---------- A4-3: PDFs over the cap ----------

// OpenClaw 2026.7's parsePageRange, verbatim in behaviour.
function parsePageRange(range, maxPages) {
  const pages = new Set();
  for (const part of range.split(',').map((p) => p.trim())) {
    if (!part) continue;
    const dash = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (dash) {
      const start = Number(dash[1]), end = Number(dash[2]);
      if (start < 1 || end < start) throw new Error(`Invalid page range: "${part}"`);
      for (let i = start; i <= Math.min(end, maxPages); i++) pages.add(i);
    } else {
      if (!/^\d+$/.test(part)) throw new Error(`Invalid page number: "${part}"`);
      const num = Number(part);
      if (num < 1) throw new Error(`Invalid page number: "${part}"`);
      if (num <= maxPages) pages.add(num);
    }
  }
  const parsed = [...pages].sort((a, b) => a - b);
  if (!parsed.length) throw new Error(`No PDF pages matched requested range "${range}"`);
  return parsed;
}

test('A4-3 pages beyond pdfMaxPages are no longer dropped; at most N per call', () => {
  assert.deepEqual(inbox.parsePages('2-3', 20, parsePageRange), [2, 3]);
  assert.deepEqual(inbox.parsePages('25-28', 20, parsePageRange), [25, 26, 27, 28]);
  assert.deepEqual(inbox.parsePages('21-60', 20, parsePageRange).length, 20);
  assert.throws(() => inbox.parsePages('abc', 20, parsePageRange), /Invalid page number/);
});

test('A4-3 the no-pages answer is PLAN §5 word for word', () => {
  assert.equal(inbox.overviewText({pageCount: 30, sizeBytes: 34.9 * 1024 * 1024, maxPages: 20}),
    '这份 PDF 有 30 页、34.9 MB，太大了没法整本读。请用 pages 指定要读的页，一次最多 20 页。');
  assert.equal(inbox.overviewText({pageCount: 412, sizeBytes: 25 * 1024 * 1024, maxPages: 20, outline: [
    {title: '第一章 函数', page: 5, depth: 0}, {title: '1.1 映射', page: 6, depth: 1}, {title: '附录', page: 0, depth: 0},
  ]}), '这份 PDF 有 412 页、25 MB，太大了没法整本读。请用 pages 指定要读的页，一次最多 20 页。目录如下：\n- 第一章 函数（第 5 页）\n  - 1.1 映射（第 6 页）\n- 附录');
});

test('A4-3 the patched pdf tool returns that answer as a normal result, and splits when pages are given', () => {
  const tools = transformTools(fs.readFileSync(path.join(root, 'desktop/windows/mac-runtime/openclaw/dist/openclaw-tools-KulZ1cdH.js'), 'utf8'));
  assert.equal(transformTools(tools), tools, 'the snapshot is already patched');
  assert.match(tools, /if \(_pinkieFit\?\.overview\) return _pinkieFit\.overview;/);
  assert.match(tools, /pageNumbers: pdf\.pinkiePages \? void 0 : pageNumbers/);
  assert.match(tools, /_pinkieMediaInbox\.loadPdf\(/);
  assert.match(tools, /_pinkieMediaInbox\.loadImage\(/);
});

// A hand-written PDF: `pages` pages, an outline, `padding` bytes per page.
function makePdf({pages = 30, padding = 0, outline = []} = {}) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null), pagesObj = add(null), outlines = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (let i = 1; i <= pages; i++) {
    // Padding is drawn text (PDFium drops comments when it copies a page), random so it does not compress.
    const noise = Array.from({length: padding}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
    const text = `BT /F1 24 Tf 40 100 Td (Page ${i}) Tj ET\nBT /F1 1 Tf 0 0 Td (${noise}) Tj ET\n`;
    const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  const hex = (s) => '<FEFF' + [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';
  const itemIds = outline.map(() => add(null));
  outline.forEach(({title, page}, i) => {
    objects[itemIds[i] - 1] = `<< /Title ${hex(title)} /Parent ${outlines} 0 R /Dest [${pageIds[page - 1]} 0 R /Fit]${i ? ` /Prev ${itemIds[i - 1]} 0 R` : ''}${i < outline.length - 1 ? ` /Next ${itemIds[i + 1]} 0 R` : ''} >>`;
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${outline.length ? ` /Outlines ${outlines} 0 R` : ''} >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  objects[outlines - 1] = outline.length ? `<< /Type /Outlines /First ${itemIds[0]} 0 R /Last ${itemIds.at(-1)} 0 R /Count ${outline.length} >>` : '<< /Type /Outlines /Count 0 >>';
  let out = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// The helper imports the bare "clawpdf": run a copy whose node_modules links to the runtime's.
async function helperWithClawpdf() {
  const clawpdf = dist && [path.join(dist, '..', 'node_modules', 'clawpdf'), path.join(dist, '..', '..', 'clawpdf')]
    .find((dir) => fs.existsSync(path.join(dir, 'package.json')));
  if (!clawpdf) return null;
  const dir = tmpDir('pdf');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.symlinkSync(fs.realpathSync(clawpdf), path.join(dir, 'node_modules', 'clawpdf'), 'junction');
  fs.copyFileSync(helperFile, path.join(dir, 'pinkie-media-inbox.mjs'));
  return import(pathToFileURL(path.join(dir, 'pinkie-media-inbox.mjs')).href);
}
const pdfHelper = await helperWithClawpdf().catch(() => null);
const noPdfium = !pdfHelper && 'clawpdf not found (set PINKIE_TEST_OPENCLAW_DIST to a runtime dist with node_modules)';

test('A4-3 over the cap without pages: page count and outline, as a normal result', {skip: noPdfium}, async () => {
  const buffer = makePdf({pages: 30, padding: 2000, outline: [{title: '第一章 集合', page: 2}, {title: 'Chapter 2', page: 9}]});
  const fit = await pdfHelper.fitPdf({media: {buffer}, maxBytes: 10_000, pageNumbers: undefined, maxPages: 20, source: '/tmp/book.pdf'});
  const text = fit.overview.content[0].text;
  assert.match(text, /^这份 PDF 有 30 页、0\.\d MB，太大了没法整本读。请用 pages 指定要读的页，一次最多 20 页。目录如下：\n- 第一章 集合（第 2 页）\n- Chapter 2（第 9 页）$/u);
  assert.equal(fit.overview.details.pageCount, 30);
  assert.equal(fit.overview.details.status, undefined, 'no error / blocked status: a normal result');
  assert.equal(fit.overview.isError, undefined);
  // Under the cap nothing changes.
  assert.equal(await pdfHelper.fitPdf({media: {buffer}, maxBytes: buffer.length, maxPages: 20}), null);
  // Pages that do not exist: the same overview instead of an empty read.
  assert.ok((await pdfHelper.fitPdf({media: {buffer}, maxBytes: 10_000, pageNumbers: [40], maxPages: 20})).overview);
});

test('A4-3 over the cap with pages: just those pages, in a file under the cap', {skip: noPdfium}, async () => {
  const buffer = makePdf({pages: 30, padding: 2000});
  const fit = await pdfHelper.fitPdf({media: {buffer}, maxBytes: 12_000, pageNumbers: [2, 3, 25], maxPages: 20});
  assert.deepEqual(fit.pages, [2, 3, 25]);
  assert.ok(fit.buffer.length <= 12_000);
  assert.equal(fit.note, undefined);
  const info = await pdfHelper.pdfInfo(fit.buffer);
  assert.equal(info.pageCount, 3);
  // Still too big: trailing pages are left for the next call, with a note saying so.
  const tight = await pdfHelper.fitPdf({media: {buffer}, maxBytes: 6_000, pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8], maxPages: 20});
  assert.ok(tight.buffer.length <= 6_000);
  assert.ok(tight.pages.length >= 1 && tight.pages.length < 8);
  assert.equal((await pdfHelper.pdfInfo(tight.buffer)).pageCount, tight.pages.length);
  assert.match(tight.note, /^（PDF 太大，这次只读了第 1(-\d)? 页；第 \d+-8 页请再用 pages 分开读。）$/u);
  // Never sends an over-cap file: one page that cannot fit keeps OpenClaw's refusal.
  await assert.rejects(pdfHelper.fitPdf({media: {buffer}, maxBytes: 500, pageNumbers: [1], maxPages: 20}), /^Error: Media exceeds/);
  await assert.rejects(pdfHelper.fitPdf({media: {buffer: Buffer.from('%PDF-1.7 broken'.padEnd(2000, ' '))}, maxBytes: 1000, pageNumbers: [1], maxPages: 20}), /Media exceeds/);
});

const scanBook = path.join(os.homedir(), '碧琪实测', 'iso-th', 'fixtures', 'scan-book.pdf');
test('A4-3 the 34.9 MB scanned book: 30 pages; pages 2-3 become a small file', {skip: noPdfium || !fs.existsSync(scanBook) && 'no scan-book.pdf fixture'}, async () => {
  const buffer = fs.readFileSync(scanBook); // read only
  const overview = await pdfHelper.fitPdf({media: {buffer}, maxBytes: 10 << 20, maxPages: 20});
  assert.match(overview.overview.content[0].text, /^这份 PDF 有 30 页、\d+(\.\d)? MB，太大了没法整本读。请用 pages 指定要读的页，一次最多 20 页。$/u);
  const toc = await pdfHelper.fitPdf({media: {buffer}, maxBytes: 10 << 20, pageNumbers: [2, 3], maxPages: 20});
  assert.deepEqual(toc.pages, [2, 3]);
  assert.ok(toc.buffer.length < 10 << 20);
  assert.equal((await pdfHelper.pdfInfo(toc.buffer)).pageCount, 2);
});
