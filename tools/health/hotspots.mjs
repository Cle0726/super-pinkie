#!/usr/bin/env node
// Usage: node tools/health/hotspots.mjs [--ref HEAD] [--as-of YYYY-MM-DD]
// Prints reproducible Markdown. --as-of is the inclusive last day in UTC.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const FIX = /^fix|修|repair|regress|restore/i;
const EXCLUDED = /\.(?:md|markdown|json|apng|avif|bmp|gif|heic|heif|ico|icns|jpe?g|jfif|png|svgz?|tiff?|webp)$/i;

const git = args => execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});

function options(args) {
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!['--ref', '--as-of'].includes(key) || !value || flags.has(key)) {
      throw new Error('用法：node tools/health/hotspots.mjs [--ref HEAD] [--as-of YYYY-MM-DD]');
    }
    flags.set(key, value);
  }
  return {ref: flags.get('--ref') ?? 'HEAD', asOf: flags.get('--as-of') ?? new Date().toISOString().slice(0, 10)};
}

function report({ref, asOf}) {
  const day = new Date(`${asOf}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== asOf) {
    throw new Error('--as-of 必须是一个有效的 YYYY-MM-DD 日期。');
  }
  const since = new Date(day.getTime() - 59 * DAY).toISOString().slice(0, 10);
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  const records = git(['log', '--no-color', '--no-notes', '--no-show-signature', '--no-merges', '--no-renames',
    `--since-as-filter=${since}T00:00:00Z`, `--until=${asOf}T23:59:59Z`,
    '--pretty=tformat:%x00%H%x00%s', '--name-only', '-z', commit, '--']).split('\0');
  const counts = new Map();
  let fixes = 0;
  // A record starts with an empty NUL-delimited field, followed by hash, subject,
  // and filenames. Git inserts one formatting newline before the first filename.
  for (let i = 0; i < records.length - 1;) {
    if (records[i++] !== '' || !/^[a-f0-9]{40,64}$/.test(records[i++] ?? '')) throw new Error('无法解析 git log 的提交边界。');
    const subject = records[i++];
    const touched = new Set();
    let first = true;
    while (records[i]) {
      const file = first ? records[i++].replace(/^\n/, '') : records[i++];
      first = false;
      if (!EXCLUDED.test(file)) touched.add(file);
    }
    if (!FIX.test(subject)) continue;
    fixes++;
    for (const file of touched) counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  const top = [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0)).slice(0, 30);
  return [
    '# 碧琪维护 · 修复热点（前 30）',
    '',
    `- 统计日期：${asOf}；窗口：${since} 至 ${asOf}（UTC，自然日，含首尾；按提交者时间）。`,
    `- 基于提交：\`${commit}\`。仅统计此提交可达历史，不扫其他分支。`,
    `- 复现命令：\`node tools/health/hotspots.mjs --ref ${commit} --as-of ${asOf}\``,
    '- 按提交标题筛选：以 `fix` 开头，或含 `修`、`repair`、`regress`、`restore`（英文不区分大小写）。',
    '- 排除合并提交、Markdown、图片、JSON；每个路径每提交计一次。重命名按两个路径处理；次数相同按路径排序。',
    `- 命中 ${fixes} 个修复类提交，涉及 ${counts.size} 个未被筛掉的文件。`,
    '',
    '| 排名 | 文件 | 修复提交数 |',
    '|---:|---|---:|',
    ...top.map(([file, n], i) => `| ${i + 1} | \`${file.replaceAll('|', '\\|')}\` | ${n} |`),
    '',
  ].join('\n');
}

try { process.stdout.write(report(options(process.argv.slice(2)))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
