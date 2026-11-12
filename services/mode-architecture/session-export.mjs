import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {agentOf, channelTitle, isBadTitle, isInternalSessionKey, registerSessionMethod} from './session-titles.mjs';
import {searchable} from './session-search.mjs';

// H2 Markdown export and C2 digest (PLAN §5, §6). Both read the current
// branch straight from the transcript: no model call, no chat.history limits.
// Images in the export become relative links under ASSET_DIR; the native save
// step renames that folder to `<file stem>-附件` next to the saved file.
export const ASSET_DIR = '__assets__';
const IMAGE_EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'};
const MAX_DIGEST = 8000;
const pad = value => String(value).padStart(2, '0');

export function formatStamp(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sessionTitle(entry, key) {
  if (entry?.label && !isBadTitle(entry.label, key, entry.sessionId)) return entry.label;
  return channelTitle(entry || {}, key)?.title || '新会话';
}

function textParts(message) {
  const content = message?.content;
  if (typeof content === 'string') return [{type: 'text', text: content}];
  return Array.isArray(content) ? content : [];
}

// Walk the branch into turns: [{role:'user'|'assistant', blocks:[text|tools|image]}].
export function branchTurns(branch) {
  const turns = [];
  let model = '';
  for (const entry of branch) {
    if (entry?.type === 'model_change' && entry.modelId) model = entry.modelId;
    if (entry?.type !== 'message') continue;
    const message = entry.message || {};
    if (message.role === 'assistant' && message.model) model = message.model;
    if (!['user', 'assistant'].includes(message.role)) continue;
    const visible = searchable(message);
    const parts = textParts(message);
    const tools = parts.filter(part => part?.type === 'toolCall' || part?.type === 'tool_use').length;
    const images = parts.filter(part => part?.type === 'image' && typeof part.data === 'string' && part.data);
    if (!visible.trim() && !tools && !images.length) continue;
    if (message.role === 'user' && !visible.trim() && !images.length) continue;
    let turn = turns.at(-1);
    if (!turn || turn.role !== message.role || message.role === 'user') {
      turn = {role: message.role, blocks: [], at: Number(message.timestamp || Date.parse(entry.timestamp) || 0)};
      turns.push(turn);
    }
    if (tools) {
      const last = turn.blocks.at(-1);
      if (last?.type === 'tools') last.count += tools; else turn.blocks.push({type: 'tools', count: tools});
    }
    // Text written before a tool call is narration of the call; keep it all, in order.
    if (visible.trim()) {
      const pendingTools = turn.blocks.at(-1)?.type === 'tools' && tools ? turn.blocks.pop() : null;
      turn.blocks.push({type: 'text', text: visible.trim()});
      if (pendingTools) turn.blocks.push(pendingTools);
    }
    for (const image of images) turn.blocks.push({type: 'image', data: image.data, mimeType: image.mimeType || 'image/png'});
  }
  return {turns, model};
}

export function renderMarkdown({title, model, exportedAt, turns}) {
  const lines = [`# ${title}`, '', `导出时间：${formatStamp(exportedAt)}${model ? ` · 模型：${model}` : ''}`, '', '---', ''];
  const assets = [];
  for (const turn of turns) {
    lines.push(turn.role === 'user' ? '**你**' : '**碧琪**', '');
    for (const block of turn.blocks) {
      if (block.type === 'text') lines.push(block.text, '');
      else if (block.type === 'tools') lines.push(`（运行了 ${block.count} 个命令）`, '');
      else if (block.type === 'image') {
        const ext = IMAGE_EXT[String(block.mimeType).toLowerCase()] || 'png';
        const hash = createHash('sha1').update(block.data).digest('hex').slice(0, 10);
        const name = `图片-${assets.length + 1}-${hash}.${ext}`;
        assets.push({name, data: block.data});
        lines.push(`![${name}](./${ASSET_DIR}/${encodeURI(name)})`, '');
      }
    }
  }
  return {markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', assets};
}

export function digestOf(turns, maxChars = 2000) {
  const limit = Math.max(200, Math.min(MAX_DIGEST, Number(maxChars) || 2000));
  const lines = [];
  for (const turn of turns) {
    const text = turn.blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').replace(/\s+\n/g, '\n').trim();
    if (text) lines.push(`${turn.role === 'user' ? '用户' : '碧琪'}：${text}`);
  }
  if (!lines.length) return '';
  // Keep the opening question, then as much of the latest exchange as fits.
  const first = [...lines[0]].slice(0, Math.floor(limit / 3)).join('');
  const out = [];
  let budget = limit - [...first].length;
  for (let index = lines.length - 1; index >= 1 && budget > 0; index--) {
    const chars = [...lines[index]];
    if (chars.length + 1 > budget) { out.unshift('…' + chars.slice(chars.length - budget + 2).join('')); budget = 0; break; }
    out.unshift(lines[index]);
    budget -= chars.length + 1;
  }
  const skipped = out.length < lines.length - 1;
  return [first, ...(skipped ? ['……'] : []), ...out].join('\n');
}

export class SessionExport {
  constructor({access, root, now = Date.now}) { this.access = access; this.root = root; this.now = now; }

  async read(key) {
    if (!agentOf(key) || isInternalSessionKey(key)) throw new Error('找不到这条会话');
    const entry = await this.access.entry(key);
    if (!entry?.transcript || !fs.existsSync(entry.transcript)) throw new Error('找不到这条会话');
    const sessions = await this.access.sdk?.('agent-sessions');
    let branch;
    if (sessions?.SessionManager) branch = sessions.SessionManager.open(entry.transcript).getBranch();
    else branch = fs.readFileSync(entry.transcript, 'utf8').split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const {turns, model} = branchTurns(branch);
    return {entry, turns, model: entry.model || model, title: sessionTitle(entry, key)};
  }

  async exportMarkdown(key) {
    const {turns, model, title} = await this.read(key);
    const {markdown, assets} = renderMarkdown({title, model, exportedAt: this.now(), turns});
    const files = [];
    if (assets.length) {
      const dir = path.join(this.root, 'exports', createHash('sha1').update(key + ':' + this.now()).digest('hex').slice(0, 16));
      fs.mkdirSync(dir, {recursive: true, mode: 0o700});
      for (const asset of assets) {
        const file = path.join(dir, asset.name);
        fs.writeFileSync(file, Buffer.from(asset.data, 'base64'), {mode: 0o600});
        files.push({name: asset.name, path: file});
      }
      this.prune();
    }
    return {ok: true, title, markdown, assets: files, assetDir: ASSET_DIR};
  }

  // Export staging is scratch space; drop anything older than a day.
  prune() {
    const base = path.join(this.root, 'exports');
    const cutoff = this.now() - 24 * 60 * 60 * 1000;
    try {
      for (const name of fs.readdirSync(base)) {
        const dir = path.join(base, name);
        try { if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, {recursive: true, force: true}); } catch {}
      }
    } catch {}
  }

  async digest(key, maxChars) {
    const {turns, title} = await this.read(key);
    return {ok: true, title, excerpt: digestOf(turns, maxChars)};
  }
}

export function registerSessionExport(api, {titles, root}) {
  const exporter = new SessionExport({access: titles.access, root});
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params || {}); } catch (error) { return {ok: false, error: error.message}; }
  });
  method('pinkie.session.export', ({key, format = 'md'}) => {
    if (format !== 'md') throw new Error('后端只导出 Markdown；PDF 和长图由界面生成');
    return exporter.exportMarkdown(key);
  });
  method('pinkie.session.digest', ({key, maxChars}) => exporter.digest(key, maxChars));
  return exporter;
}
