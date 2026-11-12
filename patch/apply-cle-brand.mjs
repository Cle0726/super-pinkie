/**
 * White-label the OpenClaw Control UI as "C.le.".
 *
 * Promo, community, upsell and update-nag surfaces are hidden by CSS only (see
 * ui/cle/promo-selectors.json); no component is removed from the bundles.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeWithPrecompressed} from './lib-precompressed.mjs';

/** Marker prepended to every patched file; also the idempotency guard. */
export const MARKER = '/* cle-brand:v1 */';
/** The product name users must see. */
export const BRAND = 'C.le.';

/** The name the patch replaces (kept as named segments so this file never trips a grep for it). */
const UPSTREAM = ['Open', 'Claw'].join('');
const RENAMES = [[`${UPSTREAM} Control`, BRAND], [UPSTREAM, BRAND]];


/** Everything that means "rewrite needed": the upstream name, and our name glued to a sentence dot. */
const DOUBLED = ['\u8bbe\u7f6e ', BRAND, '..'].join('');
const SENTENCE = ['\u8bbe\u7f6e ', BRAND].join('');
const VICTIMS = [UPSTREAM, DOUBLED];
const hasVictim = text => VICTIMS.some(victim => text.includes(victim));
// Runs after the product name so it sees the doubled dot.
const rename = text => [...RENAMES, [DOUBLED, SENTENCE]].reduce((acc, [from, to]) => acc.split(from)
  .join(to), text);

/** Files that carry the product name to end users, relative to dist/control-ui. */
export function targetFiles(controlUiRoot) {
  const assets = path.join(controlUiRoot, 'assets');
  const locales = fs.existsSync(assets)
    ? fs.readdirSync(assets)
      .filter(name => /^(?:zh-CN|en)(?:-[A-Za-z-]+)?-[A-Za-z0-9_-]+\.js$/.test(name))
      .sort()
      .map(name => path.join('assets', name))
    : [];
  return [...locales, 'index.html', 'manifest.webmanifest', 'sw.js'];
}

/** Index just past the template literal opened at `start`, or -1. */
function skipTemplate(source, start) {
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '$' && source[i + 1] === '{') {
      const end = skipTemplateExpression(source, i + 1);
      if (end < 0) return -1;
      i = end - 1;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '\n') return -1;
  }
  return -1;
}

/** Index just past the `{...}` template expression opened at `start`, or -1. */
function skipTemplateExpression(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (c === '`') {
      const end = skipTemplate(source, i);
      if (end < 0) return -1;
      i = end - 1;
    } else if (c === '"' || c === "'") {
      const quote = c;
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === '\\') { i += 1; continue; }
        if (source[i] === quote) break;
      }
    }
  }
  return -1;
}

/** Index of the closing quote of the literal opened at `start`; -1 when it does not close. */
function findClose(source, start) {
  if (source[start] === '`') return skipTemplate(source, start) - 1;
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i];
    if (c === '\\') { i += 1; continue; }
    if (c === quote) return i;
    if (c === '\n') return -1;
  }
  return -1;
}

/**
 * Templates are copied verbatim when rebuilding them is not provably identity
 * preserving: they own real line breaks, or they carry an escape sequence.
 */
function unsafeTemplate(source, start, close) {
  for (let k = start + 1; k < close; k += 1) {
    const ch = source[k];
    if (ch === '\n' || ch === '\r' || ch === '\\') return true;
  }
  return false;
}

/** True when the literal ending at `close` sits in key position (`:` or `:`-after-`,` next). */
function isKeyAt(source, close) {
  let j = close + 1;
  while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j += 1;
  return source[j] === ':';
}

/** The text of a template literal with its `${...}` expressions renamed too. */
function renameTemplate(source, start, close) {
  let out = '';
  let changed = false;
  let k = start + 1;
  while (k < close) {
    const ch = source[k];
    if (ch === '\\') {
      // A line-continuation escape is body-length 2 but source-length 3.
      const width = source[k + 1] === '\n' ? 3 : 2;
      out += source.slice(k, k + width);
      k += width;
      continue;
    }
    if (ch === '$' && source[k + 1] === '{') {
      const end = skipTemplateExpression(source, k + 1);
      out += source.slice(k, end);
      k = end;
      continue;
    }
    let stop = k + 1;
    while (stop < close && !(source[stop] === '$' && source[stop + 1] === '{')) stop += 1;
    const text = source.slice(k, stop);
    const next = rename(text);
    if (next !== text) changed = true;
    out += next;
    k = stop;
  }
  return changed ? `\`${out}\`` : source.slice(start, close + 1);
}

/**
 * Rewrite product names inside JS string literal values. Identifiers, property
 * keys, regexes, comments, URLs and storage keys are copied verbatim.
 * @param {string} source
 * @returns {{source: string, replacements: number}}
 */
export function transformDetailed(source) {
  if (source.includes(MARKER) || !hasVictim(source)) return {source, replacements: 0};
  const out = [];
  let replacements = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c !== '"' && c !== "'" && c !== '`') {
      out.push(c);
      i += 1;
      continue;
    }
    const close = findClose(source, i);
    if (close < 0) {
      // Generated error text can contain an unterminated literal. Copy just the
      // opening quote and keep scanning, so escaping stays byte-exact.
      out.push(c);
      i += 1;
      continue;
    }
    const raw = source.slice(i, close + 1);
    const body = source.slice(i + 1, close);
    if (isKeyAt(source, close)) {
      out.push(raw);
    } else if (!hasVictim(body)) {
      out.push(raw);
    } else if (c === '`' && unsafeTemplate(source, i, close)) {
      // A multi-line template carries real layout characters (and \\n escapes
      // that look identical): rebuilding it would rewrite the bundle's layout.
      out.push(raw);
    } else if (c === '`') {
      out.push(renameTemplate(source, i, close));
      replacements += 1;
    } else {
      // Keep the original quote characters: the closing one may be an escape.
      out.push(c + rename(body) + source[close]);
      replacements += 1;
    }
    i = close + 1;
  }
  if (replacements === 0) return {source, replacements: 0};
  return {source: `${MARKER}\n${out.join('')}`, replacements};
}

/** Brand a JS bundle; returns the new source. */
export function transform(source) {
  return transformDetailed(source).source;
}

/** How many product-name values the bundle carries. */
export function countStringOccurrences(source) {
  return transformDetailed(source).replacements;
}

/** The visible strings baked into index.html (title, recovery card, inline messages). */
export function transformIndexHtml(source) {
  if (source.includes(MARKER)) return source;
  const summary = [
    'The browser loaded the static page, but the app bundle did not start. The gateway may be',
    `restarting, or this page may reference assets from a different ${UPSTREAM} version.`,
  ].join('\n');
  const edits = [
    [`<title>${UPSTREAM} Control</title>`, `<title>${BRAND}</title>`],
    [`<p class="mount-fallback__eyebrow">${UPSTREAM} Control UI</p>`, `<p class="mount-fallback__eyebrow">${BRAND}</p>`],
    [summary, summary.replace(UPSTREAM, BRAND)],
    [`<li>If startup fails, ${UPSTREAM} will retry the current app bundle automatically.</li>`,
      `<li>If startup fails, ${BRAND} will retry the current app bundle automatically.</li>`],
    [`"The gateway is not reachable yet. ${UPSTREAM} will keep retrying while it restarts."`,
      `"The gateway is not reachable yet. ${BRAND} will keep retrying while it restarts."`],
    [`"The browser is still loading the app. ${UPSTREAM} will keep waiting without interrupting the download."`,
      `"The browser is still loading the app. ${BRAND} will keep waiting without interrupting the download."`],
  ];
  let next = source;
  let applied = 0;
  for (const [from, to] of edits) {
    if (!next.includes(from)) continue;
    next = next.replace(from, to);
    applied += 1;
  }
  return applied === 0 ? source : `${MARKER}\n${next}`;
}

/** manifest.webmanifest: name and short_name only. */
export function transformManifest(source) {
  if (source.includes(MARKER)) return source;
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    return source;
  }
  let applied = 0;
  for (const key of ['name', 'short_name']) {
    const value = data[key];
    if (typeof value !== 'string' || !hasVictim(value)) continue;
    data[key] = rename(value);
    applied += 1;
  }
  if (applied === 0) return source;
  const indent = source.startsWith('{\n  ') ? 2 : 0;
  return `${MARKER}\n${JSON.stringify(data, null, indent)}${source.endsWith('\n') ? '\n' : ''}`;
}

/** The HTML the offline shell embeds for a given (branded) index.html. */
export function offlineShellHtml(indexHtml) {
  return indexHtml.startsWith(`${MARKER}\n`) ? indexHtml.slice(MARKER.length + 1) : indexHtml;
}

/** Locate the embedded offline shell literal in sw.js. */
function readOfflineShell(source) {
  const anchor = 'const OFFLINE_BOOT = ';
  const at = source.indexOf(anchor);
  if (at < 0) return null;
  const start = at + anchor.length;
  const stop = start + source.slice(start).indexOf('\n');
  try {
    const graph = JSON.parse(source.slice(start, stop).replace(/;$/, ''));
    return typeof graph.html === 'string' ? {anchor, start, stop, graph} : null;
  } catch {
    return null;
  }
}

/**
 * sw.js embeds index.html for the offline shell. Keep it in sync by splicing
 * that JSON literal only; the rest of the worker is untouched.
 * @param {string} source sw.js contents
 * @param {string} [brandedHtml] contents of the patched index.html
 */
export function transformServiceWorker(source, brandedHtml) {
  const shell = readOfflineShell(source);
  if (!shell) return source;
  const html = brandedHtml === undefined
    ? transformIndexHtml(shell.graph.html)
    : offlineShellHtml(brandedHtml);
  if (html === shell.graph.html) return source;
  const body = JSON.stringify({...shell.graph, html});
  const next = `${source.slice(0, shell.start)}${body}${source.slice(shell.stop)}`;
  return source.includes(MARKER) ? next : `${MARKER}\n${next}`;
}

const TRANSFORMS = {
  '.html': transformIndexHtml,
  '.webmanifest': transformManifest,
};

function backup(file, source, backupRoot, relative) {
  if (!backupRoot) return;
  const target = path.join(backupRoot, relative);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, source);
}

/**
 * Apply the white-label to one OpenClaw package root (the directory holding
 * `dist/control-ui`). Returns a per-file summary; re-running is a no-op.
 */
export function apply(root, {backupRoot} = {}) {
  const controlUiRoot = path.join(root, 'dist', 'control-ui');
  if (!fs.existsSync(controlUiRoot)) throw new Error(`Control UI not found under ${controlUiRoot}`);
  const report = {controlUiRoot, changed: [], unchanged: [], replacements: {}};
  for (const relative of targetFiles(controlUiRoot)) {
    if (relative === 'sw.js') continue; // handled last, after index.html
    const file = path.join(controlUiRoot, relative);
    if (!fs.existsSync(file)) {
      report.unchanged.push({file: relative, reason: 'missing'});
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    const transformFile = TRANSFORMS[path.extname(relative)];
    const result = transformFile
      ? {source: transformFile(source), replacements: 0}
      : transformDetailed(source);
    if (result.source === source) {
      report.unchanged.push({file: relative});
      continue;
    }
    backup(file, source, backupRoot, relative);
    writeWithPrecompressed(file, result.source);
    report.changed.push(relative);
    report.replacements[relative] = transformFile ? 'static markup' : result.replacements;
  }
  const sw = path.join(controlUiRoot, 'sw.js');
  const index = path.join(controlUiRoot, 'index.html');
  if (fs.existsSync(sw) && fs.existsSync(index)) {
    const source = fs.readFileSync(sw, 'utf8');
    const next = transformServiceWorker(source, fs.readFileSync(index, 'utf8'));
    if (next !== source) {
      backup(sw, source, backupRoot, 'sw.js');
      writeWithPrecompressed(sw, next);
      report.changed.push('sw.js');
      report.replacements['sw.js'] = 'offline shell';
    }
  }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('OPENCLAW_ROOT is required');
  const report = apply(process.env.OPENCLAW_ROOT, {backupRoot: process.env.CLE_BRAND_BACKUP});
  console.log(`root: ${report.controlUiRoot}`);
  console.log(`files changed: ${report.changed.length}`);
  for (const file of report.changed) console.log(`  ${file}: ${report.replacements[file]}`);
  for (const {file, reason} of report.unchanged) if (reason) console.log(`  skipped ${file} (${reason})`);
  if (report.changed.length === 0) console.log('  nothing to do (already branded)');
}
