// 给碧琪的找代码工具：code_search（搜内容、找文件、看一个文件的大纲）。
//
// 为什么要有：在代码库里干活，第一步永远是「找到该改的地方」。原来只能靠命令行的 grep / find，
// Windows 上没有这两个命令，PowerShell 的写法小模型又常写错；Mac 上也常把 node_modules 一起搜进来，
// 结果刷掉几万字上下文。这里用 Node 自己走目录：两种系统一样用，自动跳过依赖和生成物，
// 结果按文件归好、限量返回，搜不到时告诉它下一步换什么说法。
//
// 只读，不运行项目里的任何东西；只在会话的项目目录（或模式工作区）之内找。纯函数可单测。
import fs from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.idea', '.gradle', 'Pods', 'DerivedData', 'coverage', '.cache', '.turbo', '.tools', '.parcel-cache', 'bower_components']);
const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tiff', 'heic', 'mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'psd', 'ai', 'sketch', 'fig', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'pyc', 'class', 'o', 'a', 'node', 'wasm', 'lock']);
const LOCK_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'uv.lock', 'Cargo.lock', 'composer.lock', 'Gemfile.lock']);
const MAX_FILE_BYTES = 1_500_000;
const MAX_FILES = 30_000;
const MAX_LINE = 220;

const toPosix = (value) => value.split(path.sep).join('/');
const clipLine = (line) => { const text = line.replace(/\t/g, '  ').trimEnd(); return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text; };
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 「*.py」「src/**/*.ts」「tests/」这样的范围写法转成正则；不含通配符的当成路径里的一段。
export function globToRegExp(glob = '') {
  const text = String(glob || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!text) return null;
  if (!/[*?{]/.test(text)) return new RegExp(`(?:^|/)${escapeRegExp(text.replace(/\/$/, ''))}(?:/|$)`, 'i');
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '*') {
      if (text[i + 1] === '*') { out += '.*'; i += 1; if (text[i + 1] === '/') i += 1; }
      else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else if (ch === '{') {
      const end = text.indexOf('}', i);
      if (end < 0) { out += '\\{'; continue; }
      out += `(?:${text.slice(i + 1, end).split(',').map(escapeRegExp).join('|')})`;
      i = end;
    } else out += escapeRegExp(ch);
  }
  // 没写目录的（*.py）在任何一层都算
  return new RegExp(`${text.includes('/') ? '^' : '(?:^|/)'}${out}$`, 'i');
}

// 走目录：先浅后深，跳过依赖、生成物和隐藏文件夹（.github 留着）。
export function* walkFiles(root, {deadline = Infinity} = {}) {
  const queue = [''];
  let seen = 0;
  while (queue.length) {
    const relative = queue.shift();
    let entries;
    try { entries = fs.readdirSync(path.join(root, relative), {withFileTypes: true}); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.github')) continue;
        queue.push(child);
      } else if (entry.isFile()) {
        seen += 1;
        if (seen > MAX_FILES || Date.now() > deadline) return;
        yield child;
      }
    }
  }
}

const looksBinary = (name) => BINARY_EXT.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase()) || /\.min\.(?:js|css)$/.test(name) || /\.map$/.test(name);

function readText(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) return null;
    const buffer = fs.readFileSync(file);
    if (buffer.subarray(0, 4096).includes(0)) return null;
    return buffer.toString('utf8');
  } catch { return null; }
}

function resolveInside(root, sub = '') {
  const base = path.resolve(root);
  const target = path.resolve(base, String(sub || '.'));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('只能在当前项目目录里找。');
  return target;
}

// 找文件：名字或路径里包含这些词（空格分开的词都要有），或者符合通配写法。
export function findFiles(root, {query = '', glob = '', path: sub = '', max = 80, timeoutMs = 8000} = {}) {
  const start = resolveInside(root, sub);
  const prefix = toPosix(path.relative(path.resolve(root), start));
  const scope = globToRegExp(glob);
  const pattern = /[*?{]/.test(query) ? globToRegExp(query) : null;
  const words = pattern ? [] : String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  let total = 0, scanned = 0;
  const deadline = Date.now() + timeoutMs;
  for (const relative of walkFiles(start, {deadline})) {
    scanned += 1;
    const full = prefix ? `${prefix}/${relative}` : relative;
    if (scope && !scope.test(full)) continue;
    const lower = full.toLowerCase();
    if (pattern ? !pattern.test(full) : !words.every(word => lower.includes(word))) continue;
    total += 1;
    if (hits.length < max) hits.push(full);
  }
  // 名字正好对上的排前面，再按路径短的排
  const base = words.join(' ');
  hits.sort((a, b) => {
    const exact = (p) => (path.posix.basename(p).toLowerCase().startsWith(base) ? 0 : 1);
    return exact(a) - exact(b) || a.split('/').length - b.split('/').length || a.localeCompare(b);
  });
  return {mode: 'files', files: hits, total, scanned, truncated: total > hits.length, timedOut: Date.now() > deadline};
}

// 搜内容。默认按字面、不分大小写；regex: true 时 query 是正则。
export function searchCode(root, {query = '', regex = false, caseSensitive = false, glob = '', path: sub = '', max = 60, context = 0, timeoutMs = 8000} = {}) {
  const text = String(query || '');
  if (!text.trim()) throw new Error('要搜什么？query 不能是空的。');
  const start = resolveInside(root, sub);
  if (fs.existsSync(start) && fs.statSync(start).isFile()) return searchOneFile(root, start, {text, regex, caseSensitive, max, context});
  const prefix = toPosix(path.relative(path.resolve(root), start));
  const scope = globToRegExp(glob);
  let matcher;
  try { matcher = new RegExp(regex ? text : escapeRegExp(text), caseSensitive ? '' : 'i'); }
  catch (error) { throw new Error(`这个正则写得不对：${error.message}。想按字面搜就不要传 regex。`); }
  const deadline = Date.now() + timeoutMs;
  const limit = Math.max(1, Math.min(200, Number(max) || 60));
  const around = Math.max(0, Math.min(3, Number(context) || 0));
  const groups = [];
  let total = 0, shown = 0, scanned = 0, filesWithHits = 0;
  for (const relative of walkFiles(start, {deadline})) {
    const name = relative.slice(relative.lastIndexOf('/') + 1);
    if (looksBinary(name) || LOCK_FILES.has(name)) continue;
    const full = prefix ? `${prefix}/${relative}` : relative;
    if (scope && !scope.test(full)) continue;
    const content = readText(path.join(start, relative));
    if (content === null) continue;
    scanned += 1;
    // 按字面搜时先整份看一眼有没有，没有就不用拆行（正则可能带 ^ $，只能逐行看）
    if (!regex && !matcher.test(content)) continue;
    const lines = content.split(/\r?\n/);
    const matches = [];
    let hitHere = false;
    for (let i = 0; i < lines.length; i += 1) {
      if (!matcher.test(lines[i])) continue;
      total += 1;
      hitHere = true;
      if (shown >= limit) continue;
      shown += 1;
      const item = {line: i + 1, text: clipLine(lines[i])};
      if (around) {
        item.before = lines.slice(Math.max(0, i - around), i).map(clipLine);
        item.after = lines.slice(i + 1, i + 1 + around).map(clipLine);
      }
      matches.push(item);
    }
    if (hitHere) filesWithHits += 1;
    if (matches.length) groups.push({file: full, matches});
  }
  const result = {mode: 'content', query: text, results: groups, total, files: filesWithHits, scanned, truncated: total > shown, timedOut: Date.now() > deadline};
  if (!total) result.hint = noHitHint(root, {text, regex, caseSensitive, glob, sub});
  else if (result.truncated) result.hint = `一共 ${total} 处，只列了前 ${shown} 处。用 glob（如 "*.py"）或 path（子目录）缩小范围，或者把 query 写得更具体。`;
  return result;
}

function searchOneFile(root, file, {text, regex, caseSensitive, max, context}) {
  const content = readText(file);
  if (content === null) throw new Error('这个文件太大或者不是文本文件。');
  let matcher;
  try { matcher = new RegExp(regex ? text : escapeRegExp(text), caseSensitive ? '' : 'i'); }
  catch (error) { throw new Error(`这个正则写得不对：${error.message}。`); }
  const lines = content.split(/\r?\n/);
  const around = Math.max(0, Math.min(3, Number(context) || 0));
  const matches = [];
  let total = 0;
  lines.forEach((line, i) => {
    if (!matcher.test(line)) return;
    total += 1;
    if (matches.length >= (Number(max) || 60)) return;
    const item = {line: i + 1, text: clipLine(line)};
    if (around) { item.before = lines.slice(Math.max(0, i - around), i).map(clipLine); item.after = lines.slice(i + 1, i + 1 + around).map(clipLine); }
    matches.push(item);
  });
  const relative = toPosix(path.relative(path.resolve(root), file));
  return {mode: 'content', query: text, results: matches.length ? [{file: relative, matches}] : [], total, files: total ? 1 : 0, scanned: 1, truncated: total > matches.length, timedOut: false, ...(total ? {} : {hint: '这个文件里没有。去掉 path 在整个项目里搜，或者换个说法。'})};
}

// 搜不到时不只说「没有」：试一下拆词，告诉它下一步换什么。
function noHitHint(root, {text, regex, caseSensitive, glob, sub}) {
  const tips = [];
  const words = text.split(/[\s_\-.:/\\]+/).filter(word => word.length >= 2);
  if (!regex && words.length > 1) {
    const found = [];
    for (const word of words.slice(0, 4)) {
      try { const r = searchCode(root, {query: word, glob, path: sub, max: 1, timeoutMs: 1500}); if (r.total) found.push(`「${word}」${r.total} 处`); } catch {}
    }
    if (found.length) tips.push(`整句没有，但拆开搜有：${found.join('、')}——换成其中一个词再搜`);
  }
  if (caseSensitive) tips.push('去掉 caseSensitive 再试');
  if (glob || sub) tips.push('去掉 glob / path，在整个项目里搜');
  tips.push('换说法：中英文互换、搜词的一部分、搜界面上看得见的那行字或报错原文');
  tips.push('依赖目录（node_modules、.venv）和生成物不在搜索范围里；要查库的源码就把 path 指到那个库的文件夹');
  return `没搜到。${tips.join('；')}。`;
}

// 一个文件的大纲：函数、类、标题各在第几行。大文件先看大纲，再只读要改的那一段。
const OUTLINE_RULES = [
  [/\.(?:m?[jt]sx?|cjs|vue|svelte)$/i, [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?function\b/,
    /^\s*(?:export\s+)?(?:interface|type|enum)\s+([\w$]+)/,
    /^\s{2,4}(?:static\s+|async\s+|get\s+|set\s+|private\s+|public\s+|protected\s+|readonly\s+)*([\w$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  ]],
  [/\.pyi?$/i, [/^\s*(?:async\s+)?def\s+(\w+)\s*\(/, /^\s*class\s+(\w+)/]],
  [/\.go$/i, [/^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/, /^type\s+(\w+)\s+(?:struct|interface)/]],
  [/\.rs$/i, [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|mod)\s+(\w+)/, /^\s*impl(?:<[^>]*>)?\s+([\w:<>, ]+?)\s*\{/]],
  [/\.(?:java|kt|cs|swift|dart|scala)$/i, [
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|open|sealed|data|override)\s+)*(?:class|interface|enum|struct|object|protocol|extension)\s+(\w+)/,
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|override|open|suspend|async|mutating)\s+)*(?:fun|func)\s+(\w+)/,
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async)\s+)+[\w<>\[\],.? ]+\s+(\w+)\s*\([^;]*$/,
  ]],
  [/\.(?:c|h|cc|cpp|hpp|m|mm)$/i, [/^[\w*&:<>, ]+?\s+\**([\w:~]+)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/, /^\s*(?:class|struct|enum|namespace)\s+(\w+)/]],
  [/\.(?:rb)$/i, [/^\s*def\s+([\w.?!]+)/, /^\s*(?:class|module)\s+([\w:]+)/]],
  [/\.php$/i, [/^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)/, /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+(\w+)/]],
  [/\.(?:sh|bash|zsh)$/i, [/^\s*(?:function\s+)?([\w-]+)\s*\(\)\s*\{?/]],
  [/\.ps1$/i, [/^\s*function\s+([\w-]+)/i]],
  [/\.(?:md|markdown)$/i, [/^(#{1,4})\s+(.+?)\s*#*$/]],
  [/\.(?:css|scss|less)$/i, [/^([^\s@{}][^{}]*?)\s*\{\s*$/, /^(@(?:media|keyframes|font-face|layer)[^{]*)\{/]],
  [/\.sql$/i, [/^\s*create\s+(?:or\s+replace\s+)?(?:table|view|index|function|procedure|trigger)\s+(?:if\s+not\s+exists\s+)?([\w."`]+)/i]],
];
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'function', 'constructor']);

export function outlineFile(root, file, {max = 200} = {}) {
  const target = resolveInside(root, file);
  const content = readText(target);
  if (content === null) throw new Error('这个文件不存在、太大或者不是文本文件。');
  const rules = OUTLINE_RULES.find(([re]) => re.test(target))?.[1];
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const relative = toPosix(path.relative(path.resolve(root), target));
  if (!rules) return {mode: 'outline', file: relative, lines: lines.length, items: [], hint: '这种文件认不出结构，直接分段读。'};
  const markdown = /\.(?:md|markdown)$/i.test(target);
  const items = [];
  let fenced = false;
  for (let i = 0; i < lines.length && items.length < max; i += 1) {
    const line = lines[i];
    if (markdown) {
      if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
    }
    if (line.length > 400) continue;
    for (const rule of rules) {
      const match = rule.exec(line);
      if (!match) continue;
      const name = (markdown ? `${match[1]} ${match[2]}` : match[1] || '').trim();
      if (!name || (!markdown && NOT_NAMES.has(name))) continue;
      items.push({line: i + 1, text: clipLine(markdown ? name : line.trim())});
      break;
    }
  }
  return {mode: 'outline', file: relative, lines: lines.length, items, ...(items.length >= max ? {hint: `只列了前 ${max} 项。`} : {})};
}

// 把结果写成模型好读的几行文字（比一大坨 JSON 省字，也不容易读错行号）。
export function formatResult(result) {
  if (result.mode === 'files') {
    if (!result.files.length) return '没找到这样的文件。换个词，或者用通配写法（*.py、src/**/*.ts）。依赖目录和生成物不在范围里。';
    return [`找到 ${result.total} 个文件${result.truncated ? `（只列前 ${result.files.length} 个）` : ''}：`, ...result.files].join('\n');
  }
  if (result.mode === 'outline') {
    const head = `${result.file}（共 ${result.lines} 行）`;
    if (!result.items.length) return `${head}：${result.hint || '没认出函数或类。'}`;
    return [`${head} 的大纲（行号: 内容）。要改哪一段，就从那一行开始读：`, ...result.items.map(item => `${item.line}: ${item.text}`), ...(result.hint ? [result.hint] : [])].join('\n');
  }
  if (!result.total) return result.hint;
  const out = [`「${result.query}」共 ${result.total} 处，在 ${result.files} 个文件里${result.truncated ? '（没列全）' : ''}：`];
  for (const group of result.results) {
    out.push(`\n${group.file}`);
    for (const match of group.matches) {
      for (const [offset, line] of (match.before || []).entries()) out.push(`  ${match.line - match.before.length + offset}  ${line}`);
      out.push(`  ${match.line}: ${match.text}`);
      for (const [offset, line] of (match.after || []).entries()) out.push(`  ${match.line + 1 + offset}  ${line}`);
    }
  }
  if (result.hint) out.push(`\n${result.hint}`);
  if (result.timedOut) out.push('\n项目很大，没搜完就到时间了；用 path 指到一个子目录再搜。');
  return out.join('\n');
}

export function createCodeSearchTool(ctx, {rootFor} = {}) {
  return {
    name: 'code_search', label: '找代码',
    description: [
      '在当前项目里找代码，Mac 和 Windows 都能用，不用写 grep / find 命令。自动跳过 node_modules、.git、.venv、构建产物和二进制文件。只读。',
      '三种用法（mode）：',
      '- content（默认）：搜文件内容。query 是要搜的字（按字面、不分大小写；传 regex: true 才当正则）。返回 文件、行号、那一行。',
      '- files：按名字找文件。query 是名字里的词，或通配写法（*.py、src/**/*.ts）。',
      '- outline：看一个文件的大纲（函数、类、标题各在第几行）。path 传那个文件。大文件先看大纲，再只读要改的那一段。',
      '改代码前先用它找到该改的地方：搜界面上看得见的那行字、报错原文、函数名；改了函数之后搜它的名字，把每个调用处都找出来。',
      // tools-health C1：PLAN 第五节 Fable 写好的原文。
      '互不依赖的几次调用，放在同一条回复里一起发，不要一条一条来。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: {type: 'string', description: '要搜的字、文件名里的词、或通配写法。outline 模式不用传。'},
        mode: {type: 'string', enum: ['content', 'files', 'outline'], description: '默认 content'},
        path: {type: 'string', description: '只在这个子目录里找（相对项目根目录）；outline 模式是要看的那个文件'},
        glob: {type: 'string', description: '只看这类文件，如 "*.py"、"src/**/*.ts"、"tests/"'},
        regex: {type: 'boolean', description: 'query 是正则表达式'},
        caseSensitive: {type: 'boolean'},
        context: {type: 'integer', minimum: 0, maximum: 3, description: '每处命中前后各带几行，默认 0'},
        max: {type: 'integer', minimum: 1, maximum: 200, description: '最多列多少处，默认 60'},
      },
    },
    async execute(toolCallId, params = {}) {
      const reply = (text, details, isError = false) => ({content: [{type: 'text', text}], details, ...(isError ? {isError: true} : {})});
      try {
        const root = rootFor ? rootFor(ctx) : String(ctx?.workspaceDir || '');
        if (!root || !path.isAbsolute(root)) throw new Error('没有找到当前项目目录。');
        const mode = params.mode || 'content';
        let result;
        if (mode === 'outline') {
          if (!params.path) throw new Error('outline 模式要用 path 指出看哪个文件。');
          result = outlineFile(root, params.path, {max: params.max || 200});
        } else if (mode === 'files') result = findFiles(root, {query: params.query, glob: params.glob, path: params.path, max: params.max || 80});
        else result = searchCode(root, params);
        return reply(formatResult(result), result);
      } catch (error) {
        const message = String(error?.message || error);
        return reply(message, {error: message}, true);
      }
    },
  };
}
