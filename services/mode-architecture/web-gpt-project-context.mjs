import fs from 'node:fs';
import path from 'node:path';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_CONTEXT_BYTES = 7_600;
const MAX_DISCOVERY = 700;
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.json',
  '.yaml', '.yml', '.toml', '.sh', '.css', '.html', '.swift', '.rs', '.go',
  '.java', '.kt', '.sql', '.vue', '.svelte', '.xml', '.ini', '.cfg',
]);
const SKIP_DIRS = new Set([
  '.git', '.openclaw', '.codex', '.ssh', '.aws', '.gnupg', '.cloudflared',
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
  '.cache', '.venv', 'venv', '__pycache__', 'target', '.gradle', '.idea',
]);
const SENSITIVE_FILE = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|_netrc|\.git-credentials|credentials\.json|secrets\.json|cookies(?:\.sqlite)?|id_(?:rsa|ed25519|ecdsa|dsa)(?:\..*)?|service-account.*\.json|.*\.(?:pem|key|p12|pfx|jks|keystore|keychain(?:-db)?))$/i;
// Generic verbs such as “分析” or “测试” also occur in ordinary chat. Only
// attach project material when the user names a project artifact or a coding
// failure; otherwise the web conversation should see only the user's words.
const PROJECT_INTENT = /项目|仓库|代码|文件|脚本|报告|配置|目录|图片|视频|源码|报错|编译|单元测试|\bbug\b|\brepo\b|\bcode\b|\bfile\b|\bsource\b|\bscript\b|\breadme\b|package\.json|\.[a-z0-9]{1,8}\b/i;

export const wantsProjectFiles = task => PROJECT_INTENT.test(String(task || ''));

function customDenied(root, relative) {
  let rules = '';
  try { rules = fs.readFileSync(path.join(root, '.c2cignore'), 'utf8'); } catch { return false; }
  const target = relative.replace(/\\/g, '/');
  return rules.split(/\r?\n/).some(raw => {
    const rule = raw.trim();
    if (!rule || rule.startsWith('#') || rule.startsWith('!')) return false;
    const anchored = rule.startsWith('/');
    const plain = rule.replace(/^\//, '').replace(/\/$/, '');
    if (!plain) return false;
    const pattern = plain.replace(/\*\*\//g, '§').replace(/\*\*/g, '¤')
      .replace(/\*/g, '¶').replace(/\?/g, '∆')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/§/g, '(?:.*/)?').replace(/¤/g, '.*')
      .replace(/¶/g, '[^/]*').replace(/∆/g, '[^/]');
    const matcher = new RegExp(`${anchored ? '^' : '(^|/)'}${pattern}(?:$|/)`);
    return matcher.test(target);
  });
}

function allowedPath(root, relative) {
  const parts = relative.split('/');
  if (parts.some((part, index) => index < parts.length - 1 && (SKIP_DIRS.has(part) || part.startsWith('.')))) return false;
  const name = parts.at(-1) || '';
  if (name.startsWith('.') && name !== '.c2c.json') return false;
  if (SENSITIVE_FILE.test(name) || name.startsWith('.c2c-secrets')) return false;
  if (!TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) return false;
  return !customDenied(root, relative);
}

function resolveFile(root, relative) {
  if (typeof relative !== 'string' || !relative.trim() || relative.includes('\0') || path.isAbsolute(relative)) return null;
  const clean = relative.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const abs = path.resolve(root, clean);
  if (!abs.startsWith(`${root}${path.sep}`)) return null;
  let real;
  try { real = fs.realpathSync(abs); } catch { return null; }
  if (!real.startsWith(`${root}${path.sep}`)) return null;
  const canonical = path.relative(root, real).split(path.sep).join('/');
  if (!allowedPath(root, canonical)) return null;
  let stat;
  try { stat = fs.statSync(real); } catch { return null; }
  return stat.isFile() && stat.size <= MAX_FILE_BYTES ? {abs: real, relative: canonical, size: stat.size} : null;
}

function discover(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 5 || found.length >= MAX_DISCOVERY) return;
    let entries;
    try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= MAX_DISCOVERY) break;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const relative = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.') && !customDenied(root, `${relative}/`)) walk(abs, depth + 1);
      } else if (entry.isFile() && allowedPath(root, relative)) {
        const item = resolveFile(root, relative);
        if (item) found.push(item);
      }
    }
  };
  walk(root, 0);
  return found;
}

function score(item, task) {
  const lower = task.toLowerCase();
  const file = item.relative.toLowerCase();
  const base = path.basename(file);
  let value = 0;
  if (lower.includes(file)) value += 200;
  if (lower.includes(base) && base.length > 3) value += 120;
  const words = [...new Set(lower.match(/[\p{L}\p{N}_-]{3,}/gu) || [])];
  for (const word of words) {
    if (word.length > 40) continue;
    if (base.includes(word)) value += 24;
    else if (file.includes(word)) value += 8;
  }
  if (/^readme(?:\.[^.]+)?$/i.test(base)) value += 18;
  if (['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'].includes(base)) value += 15;
  if (/^(?:src\/)?(?:index|main|app)\./i.test(file)) value += 9;
  value -= Math.min(12, file.split('/').length * 2);
  return value;
}

function clipUtf8(text, budget) {
  const source = String(text || '');
  if (Buffer.byteLength(source) <= budget) return source;
  let clipped = '';
  for (const char of source) {
    if (Buffer.byteLength(clipped + char) > budget - 4) break;
    clipped += char;
  }
  return `${clipped}\n…`;
}

function redactSecretLiterals(line) {
  return line
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\s*[=:]\s*["'`])([^"'`\n]{8,})(["'`])/gi,
      '$1[REDACTED]$3');
}

export function projectContext(rootInput, {task = '', paths = []} = {}) {
  const root = fs.realpathSync(rootInput);
  const requested = Array.isArray(paths) ? [...new Set(paths.map(String))].slice(0, MAX_FILES) : [];
  if (!requested.length && !wantsProjectFiles(task)) return {files: [], manifest: [], errors: [], truncated: false};
  const candidates = discover(root);
  const selected = requested.length
    ? requested.map(item => resolveFile(root, item))
    : candidates.slice().sort((a, b) => score(b, task) - score(a, task) || a.relative.localeCompare(b.relative)).slice(0, 3);
  const errors = requested.filter((_, index) => !selected[index]).map(item => `${item}: 不存在、越界或被安全规则排除`);
  const files = [];
  let remaining = MAX_CONTEXT_BYTES;
  for (const item of selected) {
    if (!item || remaining < 500) continue;
    const raw = fs.readFileSync(item.abs);
    if (raw.includes(0)) { errors.push(`${item.relative}: 二进制文件不能作为文本发送`); continue; }
    const content = raw.toString('utf8');
    if (/-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/.test(content)) {
      errors.push(`${item.relative}: 含私钥内容，已阻止发送`);
      continue;
    }
    const lines = content.split(/\r?\n/);
    const numbered = lines.slice(0, 260).map((line, index) => `${index + 1}: ${redactSecretLiterals(line)}`).join('\n');
    const excerpt = clipUtf8(numbered, Math.min(remaining, 4_000));
    files.push({path: item.relative, content: excerpt, totalLines: lines.length, truncated: excerpt.length < numbered.length || lines.length > 260});
    remaining -= Buffer.byteLength(excerpt);
  }
  return {
    files,
    manifest: requested.length ? [] : candidates
      .slice().sort((a, b) => score(b, task) - score(a, task) || a.relative.localeCompare(b.relative))
      .slice(0, 65).map(item => item.relative),
    errors,
    truncated: candidates.length >= MAX_DISCOVERY,
  };
}
