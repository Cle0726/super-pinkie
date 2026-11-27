#!/usr/bin/env node
// L82：碧琪 patch/ 与 C.le. 内核发布包里的 pinkie-patches.json 对照表（PLAN K3-2、第七节 7.1-3）。
//
// 逐个计算 patch/ 顶层 apply-*.mjs / reapply-*.mjs 的 sha256（apply-all.mjs 是试跑调度器，不算补丁），
// 和内核清单比对后分三类：
//   已搬     名字和 sha256 都对上：用 C.le. 打包时可以跳过；
//   待同步   内核清单没有这一条，或名字对上但 sha256 对不上（碧琪搬完后又改过）：照旧打，并在 cle-core SYNC.md 记待办；
//   不进内核 #21 reapply-unrestricted-patch、#34 apply-computer-v2：K3 决定不搬，碧琪继续自己打。
// 内核清单里有、碧琪 patch/ 里已经没有的条目单独列出。
//
// 用法：
//   node tools/cle/patch-sync-table.mjs --manifest <pinkie-patches.json>
//   node tools/cle/patch-sync-table.mjs --tarball <cle-core-*.tgz>        # 从内核包里读 package/pinkie-patches.json
//   node tools/cle/patch-sync-table.mjs --release [tag]                    # gh release download；默认 core-manifest.json 的 cle.tag
// 选项：
//   --repo-root <dir>   碧琪仓库根目录（默认本脚本所在仓库）
//   --json              输出 JSON（默认 Markdown 表）
//   --fail-on-pending   有「待同步」时退出 1（L77 验收「待同步 = 0」用）
//   --allow-missing     来源里没有 pinkie-patches.json 时按空清单处理（c.3 及更早的内核包没有它），否则退出 2
// 退出码：0 正常；1 --fail-on-pending 且有待同步；2 参数或输入错误。
// 只读：不改任何文件，不碰 ~/.openclaw，不起网关。--release 只调用 gh 下载到临时目录。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
export const DEFAULT_REPO_ROOT = path.resolve(path.dirname(__filename), '../..');
export const MANIFEST_NAME = 'pinkie-patches.json';
export const STATUS = Object.freeze({ MIGRATED: '已搬', PENDING: '待同步', NOT_IN_CORE: '不进内核' });
const STATUS_ORDER = [STATUS.MIGRATED, STATUS.PENDING, STATUS.NOT_IN_CORE];

// K3 定下不搬进 cle-core 的补丁（#80 / #96 记录）。以后真搬了，从这里删掉。
export const NOT_IN_CORE = new Map([
  ['reapply-unrestricted-patch', '#21：K3 不搬，碧琪安装时继续打（PATCH-MAP、#80 已记录）'],
  ['apply-computer-v2', '#34：基准内核没有 computer-tool / cua-computer 落点，只核实不搬'],
]);

// 与 tests/patches-wired.test.mjs 的补丁口径一致。
const PATCH_FILE = /^(?:re)?apply-.*\.mjs$/;
const NOT_A_PATCH = new Set(['apply-all.mjs']);
const SHA256_RE = /^[0-9a-f]{64}$/;

export function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function listLocalPatches(repoRoot = DEFAULT_REPO_ROOT) {
  const dir = path.join(repoRoot, 'patch');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && PATCH_FILE.test(entry.name) && !NOT_A_PATCH.has(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((fileName) => ({
      name: fileName.replace(/\.mjs$/, ''),
      file: `patch/${fileName}`,
      sha256: sha256OfFile(path.join(dir, fileName)),
    }));
}

// 解析并校验 pinkie-patches.json，返回 name -> 条目。格式不对直接抛错，不猜。
export function parsePinkiePatches(text, label = MANIFEST_NAME) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} 不是合法 JSON：${err.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${label} 顶层必须是对象`);
  if (data.schema !== 1) throw new Error(`${label} 的 schema 应为 1，实际是 ${JSON.stringify(data.schema)}`);
  if (!Array.isArray(data.patches)) throw new Error(`${label} 缺少 patches 数组`);
  const byName = new Map();
  data.patches.forEach((entry, index) => {
    const where = `${label} patches[${index}]`;
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new Error(`${where} 缺少 name`);
    }
    const name = entry.name.trim();
    const sha256 = typeof entry.sha256 === 'string' ? entry.sha256.trim().toLowerCase() : '';
    if (!SHA256_RE.test(sha256)) throw new Error(`${where}（${name}）的 sha256 不是 64 位十六进制`);
    if (entry.file !== undefined && path.posix.basename(String(entry.file)) !== `${name}.mjs`) {
      throw new Error(`${where} 的 name（${name}）和 file（${entry.file}）对不上`);
    }
    if (byName.has(name)) throw new Error(`${label} 里 ${name} 登记了两次`);
    byName.set(name, { ...entry, name, sha256 });
  });
  return byName;
}

export function buildSyncTable(localPatches, recorded) {
  const rows = localPatches.map((patch) => {
    const entry = recorded.get(patch.name);
    const row = { name: patch.name, file: patch.file, localSha256: patch.sha256, coreSha256: entry ? entry.sha256 : null };
    if (NOT_IN_CORE.has(patch.name)) {
      const note = entry ? '；内核清单也登记了它，需核对后更新 NOT_IN_CORE' : '';
      return { ...row, status: STATUS.NOT_IN_CORE, reason: `${NOT_IN_CORE.get(patch.name)}${note}` };
    }
    if (!entry) return { ...row, status: STATUS.PENDING, reason: '内核清单没有这一条（新补丁或还没搬）' };
    if (entry.sha256 !== patch.sha256) {
      return { ...row, status: STATUS.PENDING, reason: '名字对上、sha256 对不上（搬完后碧琪又改过）' };
    }
    return { ...row, status: STATUS.MIGRATED, reason: '名字和 sha256 都对上，C.le. 打包可跳过' };
  });
  rows.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const localNames = new Set(localPatches.map((patch) => patch.name));
  const orphans = [...recorded.values()]
    .filter((entry) => !localNames.has(entry.name))
    .map((entry) => ({ name: entry.name, file: entry.file ?? null, coreSha256: entry.sha256 }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, rows.filter((row) => row.status === status).length]));
  return { total: rows.length, counts, rows, orphans };
}

// 从 npm pack 出来的 .tgz 里取 pinkie-patches.json（包根或 package/ 下）。没有时返回 null。
export function extractManifestFromTarball(tgzPath) {
  const buf = zlib.gunzipSync(fs.readFileSync(tgzPath));
  const text = (header, start, end) => header.subarray(start, end).toString('utf8').replace(/\0[\s\S]*$/, '');
  let offset = 0;
  let pendingName = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(text(header, 124, 136).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`${tgzPath}：tar 头损坏（偏移 ${offset}）`);
    const type = String.fromCharCode(header[156] || 48);
    let name = text(header, 0, 100);
    if (text(header, 257, 263).startsWith('ustar')) {
      const prefix = text(header, 345, 500);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (pendingName) {
      name = pendingName;
      pendingName = null;
    }
    const data = buf.subarray(offset + 512, offset + 512 + size);
    if (type === 'L') {
      pendingName = data.toString('utf8').replace(/\0[\s\S]*$/, '');
    } else if (type === 'x') {
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (match) pendingName = match[1];
    } else if (type === '0') {
      const normalized = name.replace(/^\.\//, '');
      if (normalized === MANIFEST_NAME || normalized === `package/${MANIFEST_NAME}`) return data.toString('utf8');
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

function readCleSpec(repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'core-manifest.json'), 'utf8'));
  if (!manifest.cle || typeof manifest.cle !== 'object') throw new Error('core-manifest.json 缺少 cle 段');
  return manifest.cle;
}

// gh release download：先取单独的 pinkie-patches.json 资产，没有再取内核包从里面读。
// 返回清单文本；两样都拿不到返回 null（由调用方按 --allow-missing 决定）。
export function fetchManifestFromRelease({ tag, repo, run = spawnSync, tmpRoot = os.tmpdir() }) {
  const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const destDir = fs.mkdtempSync(path.join(tmpRoot, 'pinkie-patch-sync-'));
  const errors = [];
  const download = (asset) => {
    const res = run(gh, ['release', 'download', tag, '--repo', repo, '--pattern', asset, '--dir', destDir, '--clobber'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const file = path.join(destDir, asset);
    if (!res || res.error || res.status !== 0 || !fs.existsSync(file)) {
      errors.push(`${asset}：${String((res && (res.stderr || res.error?.message)) || `exit ${res?.status}`).trim()}`);
      return null;
    }
    return file;
  };
  try {
    const direct = download(MANIFEST_NAME);
    if (direct) return { text: fs.readFileSync(direct, 'utf8'), source: `${repo}@${tag} 资产 ${MANIFEST_NAME}`, errors };
    const tgz = download(`${tag}.tgz`);
    if (tgz) {
      const text = extractManifestFromTarball(tgz);
      if (text !== null) return { text, source: `${repo}@${tag} 资产 ${tag}.tgz 内的 ${MANIFEST_NAME}`, errors };
      errors.push(`${tag}.tgz 里没有 ${MANIFEST_NAME}`);
    }
    return { text: null, source: `${repo}@${tag}`, errors };
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
}

const short = (sha) => (sha ? sha.slice(0, 12) : '—');

export function renderMarkdown(table, sourceLabel) {
  const c = table.counts;
  const out = [
    `## C.le. 补丁同步表（来源：${sourceLabel}）`,
    '',
    `patch/ 共 ${table.total} 个：${STATUS.MIGRATED} ${c[STATUS.MIGRATED]} · ${STATUS.PENDING} ${c[STATUS.PENDING]} · ${STATUS.NOT_IN_CORE} ${c[STATUS.NOT_IN_CORE]}`,
  ];
  for (const status of STATUS_ORDER) {
    const rows = table.rows.filter((row) => row.status === status);
    out.push('', `### ${status}（${rows.length}）`, '');
    if (rows.length === 0) {
      out.push('（无）');
      continue;
    }
    out.push('| 补丁 | 碧琪 sha256 | 内核清单 sha256 | 说明 |', '|---|---|---|---|');
    for (const row of rows) out.push(`| \`${row.file}\` | \`${short(row.localSha256)}\` | \`${short(row.coreSha256)}\` | ${row.reason} |`);
  }
  if (table.orphans.length > 0) {
    out.push('', `### 内核清单有、碧琪 patch/ 里没有（${table.orphans.length}）`, '', '| 补丁 | 内核清单 sha256 |', '|---|---|');
    for (const orphan of table.orphans) out.push(`| \`${orphan.file ?? orphan.name}\` | \`${short(orphan.coreSha256)}\` |`);
  }
  return `${out.join('\n')}\n`;
}

function parseArgs(argv) {
  const opts = { repoRoot: DEFAULT_REPO_ROOT, json: false, failOnPending: false, allowMissing: false, sources: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} 需要一个参数`);
      i += 1;
      return next;
    };
    if (arg === '--manifest') opts.sources.push({ kind: 'manifest', value: path.resolve(value()) });
    else if (arg === '--tarball') opts.sources.push({ kind: 'tarball', value: path.resolve(value()) });
    else if (arg === '--release') {
      const next = argv[i + 1];
      const tag = next !== undefined && !next.startsWith('--') ? (i += 1, next) : null;
      opts.sources.push({ kind: 'release', value: tag });
    } else if (arg === '--repo-root') opts.repoRoot = path.resolve(value());
    else if (arg === '--json') opts.json = true;
    else if (arg === '--fail-on-pending') opts.failOnPending = true;
    else if (arg === '--allow-missing') opts.allowMissing = true;
    else throw new Error(`不认识的参数：${arg}`);
  }
  if (opts.sources.length !== 1) throw new Error('必须且只能给一个来源：--manifest <file> | --tarball <tgz> | --release [tag]');
  return opts;
}

function loadSource(source, opts, run) {
  if (source.kind === 'manifest') {
    if (!fs.existsSync(source.value)) return { text: null, label: source.value, errors: [`文件不存在：${source.value}`] };
    return { text: fs.readFileSync(source.value, 'utf8'), label: source.value, errors: [] };
  }
  if (source.kind === 'tarball') {
    if (!fs.existsSync(source.value)) throw new Error(`内核包不存在：${source.value}`);
    const text = extractManifestFromTarball(source.value);
    return { text, label: `${path.basename(source.value)} 内的 ${MANIFEST_NAME}`, errors: text === null ? [`${path.basename(source.value)} 里没有 ${MANIFEST_NAME}`] : [] };
  }
  const spec = readCleSpec(opts.repoRoot);
  const tag = source.value || spec.tag;
  const repo = spec.repo || 'Cle0726/cle-core';
  if (!tag) throw new Error('core-manifest.json 的 cle.tag 为空，请用 --release <tag> 指定');
  const got = fetchManifestFromRelease({ tag, repo, run });
  return { text: got.text, label: got.source, errors: got.errors };
}

export function runCli(argv, { stdout = process.stdout, stderr = process.stderr, run = spawnSync } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
    const loaded = loadSource(opts.sources[0], opts, run);
    let recorded;
    let label = loaded.label;
    if (loaded.text === null) {
      if (!opts.allowMissing) {
        stderr.write(`[patch-sync-table] 没拿到 ${MANIFEST_NAME}：${loaded.errors.join('；')}\n`
          + '  c.3 及更早的内核包没有这个文件；确认无误可加 --allow-missing 按空清单列表。\n');
        return 2;
      }
      recorded = new Map();
      label = `${label}（没有 ${MANIFEST_NAME}，按空清单）`;
    } else {
      recorded = parsePinkiePatches(loaded.text, label);
    }
    const table = buildSyncTable(listLocalPatches(opts.repoRoot), recorded);
    stdout.write(opts.json ? `${JSON.stringify({ source: label, ...table }, null, 2)}\n` : renderMarkdown(table, label));
    return opts.failOnPending && table.counts[STATUS.PENDING] > 0 ? 1 : 0;
  } catch (err) {
    stderr.write(`[patch-sync-table] ${err.message}\n`);
    return 2;
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isDirectRun()) process.exitCode = runCli(process.argv.slice(2));
