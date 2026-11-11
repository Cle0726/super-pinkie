import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {agentOf, channelTitle, isBadTitle, isInternalMessage, isInternalSessionKey, isPersona,
  messageText, registerSessionMethod, safeText} from './session-titles.mjs';

// Mode and agent must agree: a search must never accidentally cross modes.
const MODE_AGENTS = Object.freeze({chat: 'main', project: 'project', thinking: 'thinking', ideas: 'thinking',
  learning: 'learning', unrestricted: 'unrestricted', none: 'unrestricted'});
const CANONICAL = new Set(['message', 'thinking_level_change', 'model_change', 'compaction',
  'branch_summary', 'custom', 'custom_message', 'label', 'session_info']);
const SEARCH_TIMEOUT_MS = 1500;
const CONCURRENCY = 24;

function excerpt(text, query) {
  const value = safeText(text).replace(/\s+/gu, ' ').trim();
  if (!value) return null;
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(literal, 'iu').exec(value);
  if (!first) return null;
  const left = Array.from(value.slice(0, first.index));
  const right = Array.from(value.slice(first.index + first[0].length));
  const prefix = left.length > 30 ? '…' : '';
  const snippet = prefix + left.slice(-30).join('') + first[0] + right.slice(0, 30).join('')
    + (right.length > 30 ? '…' : '');
  const ranges = [];
  const all = new RegExp(literal, 'giu');
  for (const match of snippet.matchAll(all)) ranges.push([match.index, match.index + match[0].length]);
  return {snippet, hitRanges: ranges};
}

function searchable(message) {
  if (!message || !['user', 'assistant'].includes(message.role) || isInternalMessage(message)) return '';
  if (['inter_session', 'internal_system'].includes(message.metadata?.inputProvenance?.kind)
      || ['inter_session', 'internal_system'].includes(message.provenance?.kind)) return '';
  const text = messageText(message);
  if (/^\s*(?:【子会话简报】|【来自关联会话的消息】|【就在这里继续】|NO_REPLY\s*$|HEARTBEAT_OK\s*$)/u.test(text)) return '';
  if (message.role === 'assistant' && /^(?:error|abort(?:ed)?|cancel(?:led)?)$/i.test(message.stopReason || '')) return '';
  return text;
}

// Stream the file once. Retain only parent links and matching excerpts, not the
// transcript. Leaf controls select one branch, including after compaction.
async function transcriptHit(file, query, signal) {
  const nodes = new Map(), matches = [];
  let leaf = null, appendParent = null, controlled = false;
  const input = fs.createReadStream(file, {encoding: 'utf8', highWaterMark: 32_768, signal});
  const lines = createInterface({input, crlfDelay: Infinity});
  const resolveParent = id => {
    const seen = new Set();
    while (id && nodes.get(id)?.control && !seen.has(id)) { seen.add(id); id = nodes.get(id).parent; }
    return id;
  };
  try {
    for await (const line of lines) {
      if (signal.aborted) throw signal.reason;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (!record || typeof record !== 'object' || record.type === 'session') continue;
      const id = typeof record.id === 'string' && record.id ? record.id : null;
      if (id && record.type === 'leaf' && Object.hasOwn(record, 'targetId')) {
        const target = record.targetId;
        const append = record.appendParentId === undefined ? target : record.appendParentId;
        if ((target === null || nodes.has(target)) && (append === null || nodes.has(append))) {
          nodes.set(id, {parent: target, control: true});
          leaf = target;
          appendParent = append;
          controlled = true;
        }
        continue;
      }
      if (id && (CANONICAL.has(record.type) || Object.hasOwn(record, 'parentId'))) {
        let parent = Object.hasOwn(record, 'parentId') ? record.parentId : leaf;
        if (CANONICAL.has(record.type)) {
          if (record.appendMode !== 'side' && parent === appendParent && leaf !== appendParent) parent = leaf;
          parent = resolveParent(parent);
        }
        nodes.set(id, {parent});
        appendParent = id;
        if (CANONICAL.has(record.type) && record.appendMode !== 'side') leaf = id;
      }
      if (record.type !== 'message') continue;
      const hit = excerpt(searchable(record.message), query);
      if (hit) matches.push({...hit, ...(id ? {entryId: id} : {})});
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    lines.close();
    input.destroy();
  }
  if (!controlled) return matches.at(-1) || null;
  const visible = new Set();
  while (leaf && !visible.has(leaf)) { visible.add(leaf); leaf = nodes.get(leaf)?.parent; }
  return matches.findLast(hit => hit.entryId && visible.has(hit.entryId)) || null;
}

export class SessionSearch {
  constructor({access, timeoutMs = SEARCH_TIMEOUT_MS}) { this.access = access; this.timeoutMs = timeoutMs; }

  async search({agentId, mode, query, includeArchived = false, limit = 30} = {}) {
    if (typeof mode !== 'string' || !Object.hasOwn(MODE_AGENTS, mode) || MODE_AGENTS[mode] !== agentId) {
      return {ok: false, error: '当前模式和会话不一致'};
    }
    if (typeof query !== 'string' || query.length > 512) return {ok: false, error: '请输入不超过 512 字的搜索词'};
    if (typeof includeArchived !== 'boolean' || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return {ok: false, error: '搜索条件不正确'};
    }
    const needle = query.trim();
    if (!needle) return {ok: true, results: []};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('搜索超时')), this.timeoutMs);
    timer.unref?.();
    try {
      const deadline = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once: true}));
      const {entries, dir} = await Promise.race([this.access.list(agentId), deadline]);
      if (controller.signal.aborted) throw controller.signal.reason;
      const rows = Object.entries(entries).filter(([key, item]) => agentOf(key) === agentId
        && !isInternalSessionKey(key) && !isPersona(key) && item?.sessionId
        && (includeArchived || !item.archivedAt));
      rows.sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0));
      const matches = new Array(rows.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < rows.length) {
          if (controller.signal.aborted) throw controller.signal.reason;
          const index = cursor++, [key, entry] = rows[index];
          const title = !isBadTitle(entry.label, key, entry.sessionId) ? entry.label
            : channelTitle(entry, key)?.title || '新会话';
          let hit = excerpt(title, needle);
          if (!hit) {
            const file = path.resolve(dir, entry.sessionFile || `${entry.sessionId}.jsonl`);
            const base = path.resolve(dir) + path.sep;
            if (!file.startsWith(base)) continue;
            hit = await transcriptHit(file, needle, controller.signal);
          }
          if (hit) matches[index] = {key, title, updatedAt: entry.updatedAt || 0,
            archived: Boolean(entry.archivedAt), ...hit};
        }
      };
      await Promise.all(Array.from({length: Math.min(CONCURRENCY, rows.length)}, worker));
      return {ok: true, results: matches.filter(Boolean).slice(0, limit)};
    } catch (error) {
      return {ok: false, error: controller.signal.aborted ? '搜索超时，请缩小范围后重试' : '搜索暂时不可用，请稍后重试'};
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}

export function registerSessionSearch(api, {titles}) {
  const search = new SessionSearch({access: titles.access});
  registerSessionMethod(api, 'pinkie.session.search', params => search.search(params));
  return search;
}
