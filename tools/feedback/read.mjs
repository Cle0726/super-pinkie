#!/usr/bin/env node
// 作者本地使用的反馈解密与汇总工具（零外部依赖，只用 Node 自带模块）。
//
// 用法：
//   1) 生成加密密钥对（私钥只留本机，公钥填到 GitHub 发版配置）：
//      node tools/feedback/read.mjs keygen
//   2) 拉取私有仓库并解密出报告（默认读取 ~/.config/super-pinkie/feedback-private.pem）：
//      node tools/feedback/read.mjs --repo <你的GitHub名>/pinkie-feedback
//   3) 直接解密本地目录里的加密文件（或导出 HTML 一页报告）：
//      node tools/feedback/read.mjs --dir /path/to/feedback-repo --html ~/Desktop/pinkie-feedback-report.html
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptFeedbackEnvelope, generateFeedbackKeypair, publicKeyFingerprint} from '../../services/mode-architecture/feedback-crypto.mjs';
import {DIRECTION_LABELS, MISTAKE_LABELS, MODE_LABELS} from '../../services/mode-architecture/feedback-sanitize.mjs';
import {WORK_KINDS} from '../../services/mode-architecture/work-kinds.mjs';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'super-pinkie');
const DEFAULT_PRIVATE_KEY = path.join(DEFAULT_CONFIG_DIR, 'feedback-private.pem');
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.cache', 'super-pinkie', 'feedback-repo');

function arg(flag, argv) {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}
function hasFlag(flag, argv) {
  return argv.includes(flag);
}

function insideGitRepo(dir) {
  let current = path.resolve(dir);
  for (let i = 0; i < 16; i += 1) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

function walkEncryptedFiles(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkEncryptedFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.enc.json')) out.push(full);
  }
  return out;
}

function syncRepoToCache(repo, cacheDir, token = '') {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`仓库名格式不对：${repo}（应为 用户名/仓库名）`);
  }
  const safeUrl = `https://github.com/${repo}.git`;
  const authHeader = token
    ? `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`
    : '';
  const gitArgs = authHeader ? ['-c', `http.extraHeader=${authHeader}`] : [];
  const env = {...process.env, GIT_TERMINAL_PROMPT: '0'};

  if (fs.existsSync(path.join(cacheDir, '.git'))) {
    execFileSync('git', [...gitArgs, '-C', cacheDir, 'pull', '--ff-only'], {stdio: 'pipe', env});
    return cacheDir;
  }
  fs.mkdirSync(path.dirname(cacheDir), {recursive: true});
  if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, {recursive: true, force: true});
  execFileSync('git', [...gitArgs, 'clone', '--depth', '1', safeUrl, cacheDir], {stdio: 'pipe', env});
  return cacheDir;
}

function resolveGitHubReadToken(argv) {
  const fromEnv = process.env.PINKIE_FEEDBACK_READ_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (fromEnv.trim()) return fromEnv.trim();
  const explicit = arg('--token', argv);
  if (explicit) return explicit.trim();
  try {
    return execFileSync('gh', ['auth', 'token'], {stdio: ['ignore', 'pipe', 'ignore']}).toString('utf8').trim();
  } catch {
    return '';
  }
}

export function decryptRecordsFromDir(dir, privateKeyPem) {
  const files = walkEncryptedFiles(dir).sort();
  const records = [];
  let failedFiles = 0;
  let batchCount = 0;
  for (const file of files) {
    try {
      const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
      const doc = decryptFeedbackEnvelope(envelope, privateKeyPem);
      batchCount += 1;
      if (Array.isArray(doc?.records)) {
        for (const r of doc.records) if (r && typeof r === 'object') records.push(r);
      } else if (doc && typeof doc === 'object') {
        records.push(doc);
      }
    } catch {
      failedFiles += 1;
    }
  }
  return {fileCount: files.length, batchCount, failedFiles, records};
}

function bump(map, key, updater) {
  const k = key || 'unknown';
  const entry = map.get(k) || {key: k, total: 0, success: 0, error: 0, stopped: 0, durationMs: 0, corrections: 0};
  updater(entry);
  map.set(k, entry);
}

const pct = (part, total) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '—');
const avgSec = (ms, n) => (n > 0 ? `${(ms / n / 1000).toFixed(1)}s` : '—');
const sortDesc = (map) => [...map.values()].sort((a, b) => (b.total + b.corrections) - (a.total + a.corrections));

export function aggregateFeedback(records = []) {
  const usage = [];
  const corrections = [];
  const byVersion = new Map();
  const byPlatform = new Map();
  const byMode = new Map();
  const byWorkKind = new Map();
  const byModel = new Map();
  const byTool = new Map();
  const byErrorKind = new Map();
  const byMistake = new Map();
  const byDirection = new Map();
  const summaryCounts = new Map();
  let minAt = '';
  let maxAt = '';

  for (const r of records) {
    const at = String(r?.at || '');
    if (at) {
      if (!minAt || at < minAt) minAt = at;
      if (!maxAt || at > maxAt) maxAt = at;
    }
    const ver = String(r?.appVersion || '未知');
    const plat = [r?.platform || '未知', r?.arch || ''].filter(Boolean).join('/');
    const mode = String(r?.mode || 'chat');

    if (r?.type === 'correction') {
      corrections.push(r);
      bump(byVersion, ver, e => { e.corrections += 1; });
      bump(byMode, mode, e => { e.corrections += 1; });
      bump(byMistake, r.mistakeKind || 'factual_or_logic_error', e => { e.corrections += 1; });
      bump(byDirection, r.correctionDirection || 'redo_or_fix', e => { e.corrections += 1; });
      const sumText = String(r.summary || '').trim();
      if (sumText) {
        const cur = summaryCounts.get(sumText) || {summary: sumText, count: 0, lastAt: ''};
        cur.count += 1;
        if (at > cur.lastAt) cur.lastAt = at;
        summaryCounts.set(sumText, cur);
      }
      continue;
    }

    usage.push(r);
    const ok = r?.outcome === 'success';
    const err = r?.outcome === 'error';
    const stop = r?.outcome === 'stopped';
    const dur = Math.max(0, Number(r?.durationMs) || 0);
    const recordOutcome = e => {
      e.total += 1;
      if (ok) e.success += 1;
      if (err) e.error += 1;
      if (stop) e.stopped += 1;
      e.durationMs += dur;
    };

    bump(byVersion, ver, recordOutcome);
    bump(byPlatform, plat, recordOutcome);
    bump(byMode, mode, recordOutcome);
    bump(byWorkKind, r?.workKind || 'unknown', recordOutcome);
    bump(byModel, r?.model || 'unknown', recordOutcome);

    if (err) {
      bump(byErrorKind, r?.errorKind || 'other', e => { e.total += 1; });
    }
    const failedTools = new Set(Array.isArray(r?.failedTools) ? r.failedTools : []);
    for (const t of (Array.isArray(r?.tools) ? r.tools : [])) {
      bump(byTool, t, e => {
        e.total += 1;
        if (failedTools.has(t)) e.error += 1;
      });
    }
  }

  return {
    totalRecords: records.length,
    usageCount: usage.length,
    correctionCount: corrections.length,
    dateRange: minAt ? {from: minAt.slice(0, 10), to: maxAt.slice(0, 10)} : null,
    byVersion: sortDesc(byVersion),
    byPlatform: sortDesc(byPlatform),
    byMode: sortDesc(byMode),
    byWorkKind: sortDesc(byWorkKind),
    byModel: sortDesc(byModel),
    byTool: sortDesc(byTool).slice(0, 20),
    byErrorKind: sortDesc(byErrorKind),
    byMistake: sortDesc(byMistake),
    byDirection: sortDesc(byDirection),
    topCorrections: [...summaryCounts.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 30),
  };
}

export function renderMarkdownReport(stats, meta = {}) {
  const lines = [];
  lines.push('# 超級碧琪 · 改进反馈汇总报告');
  lines.push('');
  lines.push(`- 加密文件数：${meta.fileCount ?? 0}（解析成功 ${meta.batchCount ?? 0}，失败 ${meta.failedFiles ?? 0}）`);
  lines.push(`- 记录总数：${stats.totalRecords}（使用场景 ${stats.usageCount} 条，纠错记录 ${stats.correctionCount} 条）`);
  if (stats.dateRange) lines.push(`- 时间范围：${stats.dateRange.from} 至 ${stats.dateRange.to}`);
  lines.push('');

  const addTable = (title, headers, rows) => {
    lines.push(`## ${title}`);
    lines.push('');
    if (!rows.length) {
      lines.push('_暂无数据_');
      lines.push('');
      return;
    }
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
    lines.push('');
  };

  addTable(
    '按 App 版本汇总',
    ['版本', '使用次数', '成功率', '平均耗时', '纠错次数'],
    stats.byVersion.map(r => [r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total), r.corrections]),
  );

  addTable(
    '按系统环境汇总',
    ['系统 / 架构', '使用次数', '成功率'],
    stats.byPlatform.map(r => [r.key, r.total, pct(r.success, r.total)]),
  );

  addTable(
    '按模式汇总',
    ['模式', '使用次数', '成功率', '平均耗时', '纠错次数'],
    stats.byMode.map(r => [MODE_LABELS[r.key] || r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total), r.corrections]),
  );

  addTable(
    '按任务类型汇总',
    ['任务类型', '次数', '成功率', '平均耗时'],
    stats.byWorkKind.map(r => [WORK_KINDS[r.key]?.label || r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total)]),
  );

  addTable(
    '按纠错类型汇总',
    ['碧琪哪里容易出错', '次数', '占比'],
    stats.byMistake.map(r => [MISTAKE_LABELS[r.key] || r.key, r.corrections, pct(r.corrections, stats.correctionCount)]),
  );

  addTable(
    '按用户纠正方向汇总',
    ['用户希望怎么改', '次数', '占比'],
    stats.byDirection.map(r => [DIRECTION_LABELS[r.key] || r.key, r.corrections, pct(r.corrections, stats.correctionCount)]),
  );

  addTable(
    '高频纠错摘要（已脱敏）',
    ['概括', '次数', '最近时间'],
    stats.topCorrections.map(c => [c.summary, c.count, String(c.lastAt || '').slice(0, 10)]),
  );

  addTable(
    '高频工具使用与失败统计',
    ['工具名', '调用轮数', '出现错误轮数'],
    stats.byTool.map(r => [r.key, r.total, r.error]),
  );

  addTable(
    '模型表现汇总',
    ['模型', '次数', '成功率', '平均耗时'],
    stats.byModel.map(r => [r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total)]),
  );

  if (stats.byErrorKind.length) {
    addTable(
      '失败原因分类',
      ['类别', '次数'],
      stats.byErrorKind.map(r => [r.key, r.total]),
    );
  }

  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
}

export function renderHtmlReport(stats, meta = {}) {
  const sectionTable = (title, headers, rows) => {
    const body = rows.length
      ? `<table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<p class="empty">暂无数据</p>';
    return `<section class="card"><h2>${escapeHtml(title)}</h2>${body}</section>`;
  };
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>超級碧琪 · 改进反馈汇总报告</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 28px 20px 60px; background: #fff7fb; color: #4b2a3c; }
  .wrap { max-width: 1040px; margin: 0 auto; display: grid; gap: 16px; }
  h1 { margin: 0 0 6px; color: #b84279; font-size: 24px; }
  .meta { color: #7e5b6e; font-size: 13px; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .stat { background: #fff; border: 1px solid #f0cde0; border-radius: 14px; padding: 14px 16px; }
  .stat span { display: block; font-size: 12px; color: #8a6477; }
  .stat strong { font-size: 22px; color: #b84279; }
  .card { background: #fff; border: 1px solid #f0cde0; border-radius: 16px; padding: 16px 18px; overflow-x: auto; }
  h2 { margin: 0 0 10px; font-size: 16px; color: #753456; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #f6e1ec; }
  th { color: #8c5c75; font-weight: 650; }
  .empty { color: #9c7a8c; font-size: 13px; margin: 4px 0; }
</style>
</head>
<body>
<main class="wrap">
  <header>
    <h1>超級碧琪 · 改进反馈汇总报告</h1>
    <p class="meta">加密文件 ${escapeHtml(meta.fileCount ?? 0)} 个（解开 ${escapeHtml(meta.batchCount ?? 0)}，跳过 ${escapeHtml(meta.failedFiles ?? 0)}）${stats.dateRange ? ` · ${escapeHtml(stats.dateRange.from)} 至 ${escapeHtml(stats.dateRange.to)}` : ''}</p>
  </header>
  <section class="grid">
    <div class="stat"><span>记录总数</span><strong>${escapeHtml(stats.totalRecords)}</strong></div>
    <div class="stat"><span>使用场景</span><strong>${escapeHtml(stats.usageCount)}</strong></div>
    <div class="stat"><span>纠错记录</span><strong>${escapeHtml(stats.correctionCount)}</strong></div>
    <div class="stat"><span>覆盖版本数</span><strong>${escapeHtml(stats.byVersion.length)}</strong></div>
  </section>
  ${sectionTable('按 App 版本汇总', ['版本', '使用次数', '成功率', '平均耗时', '纠错次数'], stats.byVersion.map(r => [r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total), r.corrections]))}
  ${sectionTable('按模式汇总', ['模式', '使用次数', '成功率', '平均耗时', '纠错次数'], stats.byMode.map(r => [MODE_LABELS[r.key] || r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total), r.corrections]))}
  ${sectionTable('按任务类型汇总', ['任务类型', '次数', '成功率', '平均耗时'], stats.byWorkKind.map(r => [WORK_KINDS[r.key]?.label || r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total)]))}
  ${sectionTable('按纠错类型汇总', ['问题类型', '次数', '占比'], stats.byMistake.map(r => [MISTAKE_LABELS[r.key] || r.key, r.corrections, pct(r.corrections, stats.correctionCount)]))}
  ${sectionTable('高频纠错摘要（已脱敏）', ['概括', '次数', '最近时间'], stats.topCorrections.map(c => [c.summary, c.count, String(c.lastAt || '').slice(0, 10)]))}
  ${sectionTable('模型与工具表现', ['模型', '次数', '成功率', '平均耗时'], stats.byModel.map(r => [r.key, r.total, pct(r.success, r.total), avgSec(r.durationMs, r.total)]))}
</main>
</body>
</html>\n`;
}

export function runKeygen(argv = []) {
  const outDir = path.resolve(arg('--out-dir', argv) || DEFAULT_CONFIG_DIR);
  if (!hasFlag('--force', argv) && insideGitRepo(outDir)) {
    throw new Error(`为了安全，不能把私钥写进 Git 仓库目录（${outDir}）。请改到仓库外，例如 ${DEFAULT_CONFIG_DIR}`);
  }
  const privFile = path.join(outDir, 'feedback-private.pem');
  const pubFile = path.join(outDir, 'feedback-public.pem');
  if (!hasFlag('--overwrite', argv) && (fs.existsSync(privFile) || fs.existsSync(pubFile))) {
    throw new Error(`密钥文件已存在：${privFile}\n为了防止误覆盖导致旧反馈解不开，已停止生成；如需重生成请先备份旧密钥或加 --overwrite。`);
  }
  const pair = generateFeedbackKeypair();
  fs.mkdirSync(outDir, {recursive: true, mode: 0o700});
  fs.writeFileSync(privFile, pair.privateKeyPem, {encoding: 'utf8', mode: 0o600});
  fs.writeFileSync(pubFile, pair.publicKeyPem, {encoding: 'utf8', mode: 0o644});
  return {privFile, pubFile, ...pair};
}

function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (sub === '--help' || sub === '-h') {
    process.stdout.write([
      '超級碧琪 · 反馈加密读取工具',
      '',
      '1) 生成密钥对（私钥只留本机，不进仓库）：',
      '   node tools/feedback/read.mjs keygen [--out-dir ~/.config/super-pinkie]',
      '',
      '2) 拉取私有反馈仓库并生成报告：',
      '   node tools/feedback/read.mjs --repo <用户名>/pinkie-feedback [--key ~/.config/super-pinkie/feedback-private.pem] [--out report.md] [--html report.html]',
      '',
      '3) 直接读取本地目录里的加密文件：',
      '   node tools/feedback/read.mjs --dir /path/to/feedback-dir [--key ...]',
      '',
    ].join('\n'));
    return;
  }

  if (sub === 'keygen' || hasFlag('--init', argv)) {
    const result = runKeygen(argv);
    process.stdout.write([
      '✅ 已生成反馈加密密钥对：',
      `   私钥（绝对保密，千万别贴给 AI 或放进 Git）：${result.privFile}`,
      `   公钥（可公开，供打包使用）：${result.pubFile}`,
      `   公钥指纹：${result.fingerprint}`,
      '',
      '请把下面这一行公钥填进 GitHub 仓库的 Actions Secret / Variable（名字叫 PINKIE_FEEDBACK_PUBLIC_KEY）：',
      result.publicKeyDerBase64,
      '',
    ].join('\n'));
    return;
  }

  const keyFile = path.resolve(arg('--key', argv) || DEFAULT_PRIVATE_KEY);
  if (!fs.existsSync(keyFile)) {
    throw new Error(`找不到私钥文件：${keyFile}\n先运行 node tools/feedback/read.mjs keygen 或用 --key 指定私钥路径。`);
  }
  const privateKeyPem = fs.readFileSync(keyFile, 'utf8');

  let sourceDir = arg('--dir', argv);
  const repo = arg('--repo', argv) || '';
  if (!sourceDir) {
    if (!repo) throw new Error('请指定 --repo <用户名/仓库名> 或 --dir <本地目录>');
    const cacheDir = path.resolve(arg('--cache', argv) || DEFAULT_CACHE_DIR);
    const token = resolveGitHubReadToken(argv);
    sourceDir = syncRepoToCache(repo, cacheDir, token);
  } else {
    sourceDir = path.resolve(sourceDir);
  }

  const decrypted = decryptRecordsFromDir(sourceDir, privateKeyPem);
  const stats = aggregateFeedback(decrypted.records);

  if (hasFlag('--json', argv)) {
    process.stdout.write(JSON.stringify({meta: decrypted, stats, records: decrypted.records}, null, 2) + '\n');
    return;
  }

  const markdown = renderMarkdownReport(stats, decrypted);
  const outMd = arg('--out', argv);
  if (outMd) {
    fs.mkdirSync(path.dirname(path.resolve(outMd)), {recursive: true});
    fs.writeFileSync(path.resolve(outMd), markdown + '\n', 'utf8');
  }
  const outHtml = arg('--html', argv);
  if (outHtml) {
    fs.mkdirSync(path.dirname(path.resolve(outHtml)), {recursive: true});
    fs.writeFileSync(path.resolve(outHtml), renderHtmlReport(stats, decrypted), 'utf8');
  }

  process.stdout.write(markdown + '\n');
  if (outMd) process.stderr.write(`已写入 Markdown 报告：${path.resolve(outMd)}\n`);
  if (outHtml) process.stderr.write(`已写入网页报告：${path.resolve(outHtml)}\n`);
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exit(1);
  }
}
