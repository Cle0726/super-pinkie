// Metre 项目记忆（briefs/metre-mode-1113 PLAN 6.2，批 M）。
//
// 每个项目文件夹一份，放在 <状态目录>/metre-memory/<键>/：
//   folder.json   原路径（搬家时认领用）
//   items.json    记忆条目
//   audit.jsonl   每次改动一行：谁改的、动作、改前、改后
// 键 = 规范化绝对路径的 sha256 前 16 位。没绑文件夹的 Metre 会话用 `_unbound`，不分项目的用户偏好放 `_user`。
//
// 防串：注入、recall、remember 只认「当前会话绑定的文件夹」，模型不能指定写到别的键；
// 只有 recall 带 folder 能只读另一个项目，结果标「来自另一个项目」，不写进当前项目。
// 和碧琪的长期记忆（memory.mjs）互不读写：这里只碰自己的目录。
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {agentOf, registerSessionMethod, sessionTool} from './session-titles.mjs';
import {boundProjectRoot} from './project-brief.mjs';

export const CATEGORIES = Object.freeze(['overview', 'structure', 'commands', 'conventions', 'decisions',
  'preferences', 'pitfalls', 'people', 'open']);
export const CATEGORY_NAMES = Object.freeze({overview: '项目概况', structure: '目录和关键文件', commands: '怎么跑、测、打包',
  conventions: '规矩', decisions: '定下的事', preferences: '偏好', pitfalls: '踩过的坑', people: '协作者', open: '没做完的'});
export const CONFIDENCE = Object.freeze(['user', 'verified', 'guess']);   // 用户亲口说的 / 看文件确认的 / 推测的
const CONFIDENCE_NAMES = {user: '用户说的', verified: '看文件确认', guess: '推测'};
const CONFIDENCE_RANK = {user: 3, verified: 2, guess: 1};
export const MAX_ITEMS = 300;
export const MAX_TEXT = 400;
export const PROFILE_BUDGET = 1800;
export const USER_BUDGET = 400;
export const UNBOUND = '_unbound';
export const USER = '_user';
const REMIND = '【记一下】上一件事做完了。有下次还用得上的（验收过的事实、定下的决定和理由、用户的偏好、踩过的坑、没做完的），用 metre_memory 的 remember 记一条；没有就不记，也不用说。';

const isMetreKey = key => agentOf(key) === 'metre';
const graphemes = text => [...String(text || '')];
const clip = (text, max) => { const chars = graphemes(text); return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''); };
const clean = raw => String(raw ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/gu, '').replace(/[^\S\n]+/gu, ' ').trim();

// 规范化：解析成绝对路径、能解软链接就解、分隔符统一成 /、去掉末尾分隔符；
// Windows 不分大小写，整条路径转小写（盘符大小写自然算一个），macOS / Linux 原样。
export function normalizeFolder(raw, platform = process.platform) {
  let text = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!text) return '';
  if (platform === 'win32') {
    if (/^\/[a-z]\//i.test(text)) text = `${text[1]}:${text.slice(2)}`;   // Git Bash 的 /f/…
    if (/^[a-z]:$/i.test(text)) text += '\\';
  }
  const lib = platform === 'win32' ? path.win32 : path.posix;
  let resolved = lib.resolve(text);
  try { resolved = fs.realpathSync.native(resolved); } catch {}
  let out = resolved.replace(/\\/g, '/');
  if (out.length > 1 && !/^[a-z]:\/$/i.test(out)) out = out.replace(/\/+$/, '');
  return platform === 'win32' ? out.toLowerCase() : out;
}

export function folderKey(raw, platform = process.platform) {
  const norm = normalizeFolder(raw, platform);
  return norm ? createHash('sha256').update(norm).digest('hex').slice(0, 16) : '';
}

// 中文按字、英文按词的二元组相似度：同类别里相似度高时提示用 update，不另写一条。
function shingles(text) {
  const tokens = String(text).toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}_.-]+/gu) || [];
  const set = new Set();
  for (let i = 0; i < tokens.length; i++) set.add(tokens[i] + '|' + (tokens[i + 1] || ''));
  return set;
}
export function similarity(a, b) {
  const x = shingles(a), y = shingles(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const item of x) if (y.has(item)) both++;
  return both / (x.size + y.size - both);
}

export class MetreMemory {
  constructor(root, {now = () => Date.now(), platform = process.platform} = {}) {
    this.root = root;
    this.now = now;
    this.platform = platform;
    this.cache = new Map();
  }

  dir(key) { return path.join(this.root, key); }

  keyFor(folder) {
    if (!folder) return UNBOUND;
    return folderKey(folder, this.platform) || UNBOUND;
  }

  folderOf(key) {
    if (key === UNBOUND || key === USER) return '';
    try { return JSON.parse(fs.readFileSync(path.join(this.dir(key), 'folder.json'), 'utf8')).folder || ''; } catch { return ''; }
  }

  items(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(this.dir(key), 'items.json'), 'utf8')); } catch {}
    if (!Array.isArray(list)) list = [];
    this.cache.set(key, list);
    return list;
  }

  save(key, list, folder = '') {
    const dir = this.dir(key);
    fs.mkdirSync(dir, {recursive: true});
    if (folder && !fs.existsSync(path.join(dir, 'folder.json'))) {
      fs.writeFileSync(path.join(dir, 'folder.json'), JSON.stringify({folder, normalized: normalizeFolder(folder, this.platform), createdAt: this.now()}, null, 2));
    }
    const file = path.join(dir, 'items.json');
    const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
    fs.renameSync(tmp, file);
    this.cache.set(key, list);
  }

  audit(key, entry) {
    fs.mkdirSync(this.dir(key), {recursive: true});
    fs.appendFileSync(path.join(this.dir(key), 'audit.jsonl'), JSON.stringify({at: this.now(), ...entry}) + '\n');
  }

  auditLog(key, limit = 50) {
    try {
      return fs.readFileSync(path.join(this.dir(key), 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
        .slice(-limit).map(line => JSON.parse(line));
    } catch { return []; }
  }

  // 满 300 条时先清：没钉住的里面，置信最低、最久没用到的。
  evict(list) {
    while (list.length > MAX_ITEMS) {
      const candidates = list.filter(item => !item.pinned);
      if (!candidates.length) return null;
      candidates.sort((a, b) => (CONFIDENCE_RANK[a.confidence] || 0) - (CONFIDENCE_RANK[b.confidence] || 0)
        || (a.lastUsedAt || a.createdAt) - (b.lastUsedAt || b.createdAt));
      const drop = candidates[0];
      list.splice(list.indexOf(drop), 1);
      return drop;
    }
    return null;
  }

  remember(key, {category, text, confidence = 'verified', source = {}, pinned = false}, {folder = '', actor = 'metre'} = {}) {
    if (!CATEGORIES.includes(category)) throw new Error(`类别只能是：${CATEGORIES.join(' / ')}`);
    const body = clean(text);
    if (!body) throw new Error('正文不能为空');
    if (graphemes(body).length > MAX_TEXT) throw new Error(`一条最多 ${MAX_TEXT} 字，拆成几条、一条只写一件事`);
    if (!CONFIDENCE.includes(confidence)) throw new Error(`confidence 只能是：${CONFIDENCE.join(' / ')}`);
    const list = [...this.items(key)];
    const near = list.find(item => item.category === category && similarity(item.text, body) >= 0.6);
    if (near) {
      const error = new Error(`和已有的一条很像（${near.id}：${clip(near.text, 60)}）。同一件事变了用 update 改那一条，不要另写`);
      error.similar = near.id;
      throw error;
    }
    const item = {id: 'm-' + randomUUID().slice(0, 8), category, text: body, confidence, source: sanitizeSource(source),
      createdAt: this.now(), updatedAt: this.now(), lastUsedAt: 0, uses: 0, pinned: Boolean(pinned)};
    list.push(item);
    const dropped = this.evict(list);
    if (list.length > MAX_ITEMS) throw new Error(`这个项目已有 ${MAX_ITEMS} 条且全部钉住，先删几条`);
    this.save(key, list, folder);
    this.audit(key, {actor, action: 'remember', id: item.id, after: item});
    if (dropped) this.audit(key, {actor: 'system', action: 'evict', id: dropped.id, before: dropped});
    return item;
  }

  edit(key, id, fields, {actor = 'metre'} = {}) {
    const list = [...this.items(key)];
    const index = list.findIndex(item => item.id === id);
    if (index < 0) throw new Error(`当前项目里没有 ${id} 这一条`);
    const before = list[index];
    const after = {...before};
    if (fields.category !== undefined) {
      if (!CATEGORIES.includes(fields.category)) throw new Error(`类别只能是：${CATEGORIES.join(' / ')}`);
      after.category = fields.category;
    }
    if (fields.text !== undefined) {
      const body = clean(fields.text);
      if (!body) throw new Error('正文不能为空');
      if (graphemes(body).length > MAX_TEXT) throw new Error(`一条最多 ${MAX_TEXT} 字`);
      after.text = body;
    }
    if (fields.confidence !== undefined) {
      if (!CONFIDENCE.includes(fields.confidence)) throw new Error(`confidence 只能是：${CONFIDENCE.join(' / ')}`);
      after.confidence = fields.confidence;
    }
    if (fields.pinned !== undefined) after.pinned = Boolean(fields.pinned);
    after.updatedAt = this.now();
    list[index] = after;
    this.save(key, list);
    this.audit(key, {actor, action: fields.pinned !== undefined && Object.keys(fields).length === 1 ? (after.pinned ? 'pin' : 'unpin') : 'edit', id, before, after});
    return after;
  }

  forget(key, id, {actor = 'metre'} = {}) {
    const list = [...this.items(key)];
    const index = list.findIndex(item => item.id === id);
    if (index < 0) throw new Error(`当前项目里没有 ${id} 这一条`);
    const [before] = list.splice(index, 1);
    this.save(key, list);
    this.audit(key, {actor, action: 'forget', id, before});
    return before;
  }

  touch(key, ids) {
    if (!ids.length) return;
    const set = new Set(ids);
    const at = this.now();
    const list = this.items(key).map(item => set.has(item.id) ? {...item, uses: (item.uses || 0) + 1, lastUsedAt: at} : item);
    this.save(key, list);
  }

  search(key, {query = '', category = ''} = {}) {
    const words = clean(query).toLowerCase().split(/\s+/).filter(Boolean);
    return this.items(key).filter(item => (!category || item.category === category)
      && words.every(word => item.text.toLowerCase().includes(word)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || score(b, this.now()) - score(a, this.now()));
  }

  stats(key) {
    const list = this.items(key);
    const byCategory = Object.fromEntries(CATEGORIES.map(name => [name, 0]));
    for (const item of list) if (byCategory[item.category] !== undefined) byCategory[item.category]++;
    const folder = this.folderOf(key);
    return {key, folder, name: folder ? path.basename(folder.replace(/[\\/]+$/, '')) || folder : '', count: list.length,
      byCategory, known: CATEGORIES.filter(name => byCategory[name] > 0).length,
      lastWriteAt: list.reduce((max, item) => Math.max(max, item.updatedAt || 0), 0)};
  }

  // 每轮开头注入的「项目档案」：钉住的在前，其余按用到次数和新近程度，按类别排，总长 ≤ 1800 字；
  // 用户级偏好排在后面，最多 400 字。返回文字和用上的条目 id（这些 id 算「用到一次」）。
  profile(key) {
    const used = [];
    const pick = (list, budget) => {
      let size = 0;
      const chosen = [];
      const ordered = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || score(b, this.now()) - score(a, this.now()));
      for (const item of ordered) {
        const line = `- [${item.id}] ${item.text}${item.confidence === 'guess' ? '（推测）' : ''}`;
        const cost = graphemes(line).length + 1;
        if (size + cost > budget) continue;
        size += cost;
        chosen.push({item, line});
      }
      return chosen;
    };
    const project = this.items(key);
    const folder = this.folderOf(key);
    const head = key === UNBOUND ? '【项目档案：没绑文件夹】' : `【项目档案：${folder || key}】`;
    const tail = project.length ? `（共 ${project.length} 条，这里放不下的用 metre_memory recall 查）` : '';
    const projectBudget = PROFILE_BUDGET - graphemes(head).length - graphemes(tail).length - 2;
    const chosen = pick(project, projectBudget);
    const render = () => {
      if (!chosen.length) return '';
      const out = [head];
      for (const name of CATEGORIES) {
        const group = chosen.filter(entry => entry.item.category === name);
        if (!group.length) continue;
        out.push(`${CATEGORY_NAMES[name]}：`, ...group.map(entry => entry.line));
      }
      if (project.length > chosen.length) out.push(tail);
      return out.join('\n');
    };
    let text = render();
    // 类别标题也算字数：放不下就去掉排得最靠后的一条（chosen 已按优先级排好）。
    while (graphemes(text).length > PROFILE_BUDGET && chosen.length) { chosen.pop(); text = render(); }
    used.push(...chosen.map(entry => entry.item.id));
    const userChosen = pick(this.items(USER), USER_BUDGET - 14);
    const userText = userChosen.length ? ['【用户偏好（不分项目）】', ...userChosen.map(entry => entry.line)].join('\n') : '';
    return {text, userText, used, userUsed: userChosen.map(entry => entry.item.id)};
  }
}

function score(item, now) {
  const age = Math.max(0, now - (item.lastUsedAt || item.createdAt || 0)) / 86_400_000;
  return (item.uses || 0) + (CONFIDENCE_RANK[item.confidence] || 0) + 10 / (1 + age);
}

function sanitizeSource(source = {}) {
  const out = {};
  for (const name of ['sessionKey', 'turn', 'file', 'childKey']) if (source[name]) out[name] = clip(clean(source[name]), 300);
  return out;
}

function publicItem(item) {
  return {id: item.id, category: item.category, categoryName: CATEGORY_NAMES[item.category], text: item.text,
    confidence: item.confidence, confidenceName: CONFIDENCE_NAMES[item.confidence], pinned: Boolean(item.pinned),
    uses: item.uses || 0, lastUsedAt: item.lastUsedAt || 0, createdAt: item.createdAt, updatedAt: item.updatedAt, source: item.source || {}};
}

const TOOL_DESCRIPTION = '你在当前项目文件夹里的记忆（只属于这个文件夹，不和别的项目混）。'
  + 'recall：按关键词 / 类别查；带 folder 时只读另一个项目（只在用户明说要参考时用，读来的不写进当前项目）。'
  + 'remember：记一条（一条一件事，≤400 字）；scope=user 记不分项目的用户偏好。'
  + 'update：改一条（事实变了就改，不另写相反的）；forget：删一条；list：按类别看全部。'
  + `类别：${CATEGORIES.map(name => `${name}（${CATEGORY_NAMES[name]}）`).join('、')}。`
  + 'confidence：user（用户亲口说的）/ verified（你看文件或验收确认的）/ guess（推测）。子会话的汇报要你验收过才能记，标 verified。';

export function registerMetreMemory(api, {root, stateRoot, bindingsFile, childrenRunning = async () => false, memory = null} = {}) {
  const store = memory || new MetreMemory(root);
  const folderFor = key => boundProjectRoot(key, {stateRoot, bindingsFile});
  const keyForSession = key => store.keyFor(folderFor(key));
  const lastKey = new Map();     // 会话 → 上一轮用的文件夹键（换绑提示用）
  const worked = new Set();      // 上次提醒之后用过工具的 Metre 会话
  const remind = new Set();      // 下一轮要带「记一下」的会话

  const run = (ctx, params) => {
    const sessionKey = String(ctx?.sessionKey || '');
    const folder = folderFor(sessionKey);
    const key = store.keyFor(folder);
    const action = params.action;
    if (action === 'recall') {
      if (params.folder) {
        const otherKey = store.keyFor(params.folder);
        if (otherKey === key) return recallResult(store.search(key, params), false);
        if (otherKey === UNBOUND || !fs.existsSync(store.dir(otherKey))) return {from: params.folder, items: [], note: '那个文件夹没有项目记忆'};
        const items = store.search(otherKey, params).slice(0, 20);
        return {fromOtherProject: true, from: store.folderOf(otherKey) || params.folder,
          note: `来自另一个项目：${store.folderOf(otherKey) || params.folder}。只作参考，不要写进当前项目`,
          items: items.map(item => ({...publicItem(item), from: `来自另一个项目：${store.folderOf(otherKey) || params.folder}`}))};
      }
      const found = store.search(key, params).slice(0, 20);
      store.touch(key, found.map(item => item.id));
      return recallResult(found, false);
    }
    if (action === 'list') {
      const scopeKey = params.scope === 'user' ? USER : key;
      return {folder: store.folderOf(scopeKey) || (scopeKey === USER ? '（不分项目）' : '（没绑文件夹）'),
        items: store.search(scopeKey, {category: params.category}).map(publicItem)};
    }
    // 写入：键只来自当前会话绑定的文件夹（或 _user），不认模型传的任何键 / 路径。
    if (params.folder) throw new Error('只能写当前项目的记忆：folder 只给 recall 读别的项目用');
    const scopeKey = params.scope === 'user' ? USER : key;
    if (action === 'remember') {
      worked.delete(sessionKey);
      remind.delete(sessionKey);
      const item = store.remember(scopeKey, {category: params.category, text: params.text, confidence: params.confidence,
        source: {sessionKey, file: params.file}}, {folder: scopeKey === USER ? '' : folder});
      return {ok: true, remembered: publicItem(item), count: store.items(scopeKey).length};
    }
    if (action === 'update') {
      if (!params.id) throw new Error('update 要写 id');
      const fields = {};
      for (const name of ['text', 'category', 'confidence']) if (params[name] !== undefined) fields[name] = params[name];
      return {ok: true, updated: publicItem(store.edit(scopeKey, params.id, fields))};
    }
    if (action === 'forget') {
      if (!params.id) throw new Error('forget 要写 id');
      return {ok: true, forgot: publicItem(store.forget(scopeKey, params.id))};
    }
    throw new Error('action 只能是 recall / remember / update / forget / list');
  };

  api.registerTool?.(ctx => isMetreKey(ctx?.sessionKey) ? sessionTool('metre_memory', TOOL_DESCRIPTION, {
    action: {type: 'string', enum: ['recall', 'remember', 'update', 'forget', 'list']},
    query: {type: 'string'}, category: {type: 'string', enum: CATEGORIES},
    text: {type: 'string'}, confidence: {type: 'string', enum: CONFIDENCE},
    id: {type: 'string'}, scope: {type: 'string', enum: ['project', 'user']},
    folder: {type: 'string', description: '只给 recall：读另一个项目的记忆'}, file: {type: 'string', description: '这条来自哪个文件（可选）'},
  }, ['action'], params => run(ctx, params)) : null, {name: 'metre_memory'});

  api.on?.('before_prompt_build', (event, ctx) => {
    const sessionKey = String(ctx?.sessionKey || '');
    if (!isMetreKey(sessionKey)) return;
    const key = keyForSession(sessionKey);
    const previous = lastKey.get(sessionKey);
    lastKey.set(sessionKey, key);
    const parts = [];
    if (previous && previous !== key) parts.push('【项目已换】这个会话换了文件夹，下面只有新文件夹的档案；上一个项目的记忆不带过来，也不要凭印象套用。');
    const {text, userText, used, userUsed} = store.profile(key);
    if (text) parts.push(text);
    if (userText) parts.push(userText);
    if (remind.has(sessionKey)) { parts.push(REMIND); remind.delete(sessionKey); }
    if (used.length) store.touch(key, used);
    if (userUsed.length) store.touch(USER, userUsed);
    return parts.length ? {appendSystemContext: `\n${parts.join('\n')}\n`} : undefined;
  }, {priority: -10870});

  api.on?.('after_tool_call', (event, ctx) => {
    const sessionKey = String(ctx?.sessionKey || '');
    const name = String(event?.toolName || event?.name || '');
    if (isMetreKey(sessionKey) && name !== 'metre_memory') worked.add(sessionKey);
  }, {priority: -10870});

  // 一件事做完（这一轮结束时没有子会话还在跑，且上次提醒之后动过手）：下一轮提醒一次，写不写由 Metre 定。
  api.on?.('agent_end', async (event, ctx) => {
    const sessionKey = String(ctx?.sessionKey || '');
    if (!isMetreKey(sessionKey) || !worked.has(sessionKey)) return;
    let running = false;
    try { running = await childrenRunning(sessionKey); } catch { running = true; }
    if (running) return;
    worked.delete(sessionKey);
    remind.add(sessionKey);
  }, {priority: -10870});

  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params || {}); } catch (error) { return {ok: false, error: error.message}; }
  });
  // 看板和状态条芯片只读这一个接口；改动也走它（actor=user），有审计。
  const scopeOf = params => {
    if (params.scope === 'user') return USER;
    if (params.sessionKey) {
      if (!isMetreKey(params.sessionKey)) throw new Error('只有 Metre 会话有项目记忆');
      return keyForSession(params.sessionKey);
    }
    if (params.folder) return store.keyFor(params.folder);
    throw new Error('要给 sessionKey 或 folder');
  };
  method('pinkie.metre.memory', params => {
    const key = scopeOf(params);
    const action = params.action || 'stats';
    if (action === 'stats') return {ok: true, ...store.stats(key)};
    if (action === 'list') return {ok: true, ...store.stats(key), items: store.search(key, {category: params.category}).map(publicItem)};
    if (action === 'search') return {ok: true, items: store.search(key, {query: params.query, category: params.category}).map(publicItem)};
    if (action === 'pin') return {ok: true, item: publicItem(store.edit(key, params.id, {pinned: params.pinned !== false}, {actor: 'user'}))};
    if (action === 'edit') {
      const fields = {};
      for (const name of ['text', 'category', 'confidence']) if (params[name] !== undefined) fields[name] = params[name];
      return {ok: true, item: publicItem(store.edit(key, params.id, fields, {actor: 'user'}))};
    }
    if (action === 'delete') return {ok: true, item: publicItem(store.forget(key, params.id, {actor: 'user'}))};
    if (action === 'audit') return {ok: true, entries: store.auditLog(key, Math.min(200, Number(params.limit) || 50))};
    throw new Error('action 只能是 stats / list / search / pin / edit / delete / audit');
  });
  return store;
}

function recallResult(items) {
  return {items: items.map(publicItem), ...(items.length ? {} : {note: '当前项目里没查到；动手前可以先看文件'})};
}
