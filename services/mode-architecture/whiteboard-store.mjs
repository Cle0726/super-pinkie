import crypto from 'node:crypto';
import path from 'node:path';
import {agentOf, readSessionJson, registerSessionMethod, writeSessionJson} from './session-titles.mjs';

// 白板（想法模式 / 灵感圆桌）：每个会话一块，跟着会话存。
// 并发：每个元素带自己的 rev。改一个元素要带上它的 baseRev（新建填 0）；
// 服务器上这个元素已经被别人改过（rev 更大）就不改，原样退回当前版本，
// 所以用户和碧琪同时改不同元素都生效，同时改同一个元素后到的不会盖掉先到的。
// 删除留墓碑，轮询的一方也能看到。谁改的（by）由服务器按调用方写，不信客户端。
export const KINDS = ['note', 'ink', 'box', 'link'];
export const COLORS = ['sun', 'mint', 'sky', 'rose', 'paper'];
export const ACTORS = ['user', 'pinkie'];
export const LIMITS = Object.freeze({items: 2000, text: 2000, label: 200, points: 2000, ops: 200, coord: 1e6, size: 2e4, group: 40});
// 只有想法模式的会话能开白板；灵感圆桌的白板存在圆桌自己的服务里，规则同这里。
export const BOARD_AGENTS = new Set(['thinking']);

const ID = /^[A-Za-z0-9_-]{6,40}$/;
const num = (v, lim = LIMITS.coord) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const text = (v, max) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Error('白板文字格式不对');
  if (v.length > max) throw new Error(`白板文字太长（最多 ${max} 个字）`);
  return v;
};

export function boardAllowed(key) { return BOARD_AGENTS.has(agentOf(key)); }

// 把客户端送来的元素清洗成只含已知字段的对象；不合规就抛错，整批不写。
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('白板元素格式不对');
  const {id, kind} = raw;
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('白板元素编号不对');
  if (!KINDS.includes(kind)) throw new Error('没有这种白板元素');
  const item = {id, kind};
  if (raw.group !== undefined && raw.group !== null && raw.group !== '') item.group = text(raw.group, LIMITS.group);
  if (kind === 'link') {
    for (const end of ['from', 'to']) if (typeof raw[end] !== 'string' || !ID.test(raw[end])) throw new Error('连线两头要连到元素上');
    if (raw.from === raw.to) throw new Error('连线不能连到自己');
    Object.assign(item, {from: raw.from, to: raw.to, label: text(raw.label, LIMITS.label)});
    return item;
  }
  if (kind === 'ink') {
    const pts = raw.points;
    if (!Array.isArray(pts) || pts.length < 2 || pts.length > LIMITS.points) throw new Error('笔迹点数不对');
    item.points = pts.map(p => {
      if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) throw new Error('笔迹坐标不对');
      return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    });
    item.width = num(raw.width, 12) && raw.width >= 1 ? raw.width : 2;
    return item;
  }
  for (const k of ['x', 'y']) if (!num(raw[k])) throw new Error('白板位置不对');
  for (const k of ['w', 'h']) if (!num(raw[k], LIMITS.size) || raw[k] < 8) throw new Error('白板大小不对');
  Object.assign(item, {x: raw.x, y: raw.y, w: raw.w, h: raw.h});
  if (kind === 'note') {
    item.text = text(raw.text, LIMITS.text);
    item.color = COLORS.includes(raw.color) ? raw.color : 'sun';
  } else item.label = text(raw.label, LIMITS.label);
  return item;
}

export class WhiteboardStore {
  constructor(root) { this.dir = path.join(root, 'whiteboards'); }
  file(key) { return path.join(this.dir, crypto.createHash('sha256').update(key).digest('hex').slice(0, 32) + '.json'); }
  read(key) {
    const data = readSessionJson(this.file(key));
    return {rev: Number.isInteger(data.rev) ? data.rev : 0, items: data.items && typeof data.items === 'object' ? data.items : {}};
  }
  check(key) { if (!boardAllowed(key)) throw new Error('这个会话不能开白板'); }
  // since=0 拿全部（不含墓碑）；since>0 只拿之后改过的（含墓碑），给轮询用。
  get(key, since = 0) {
    this.check(key);
    const board = this.read(key), from = Number.isInteger(since) && since > 0 ? since : 0;
    const items = Object.values(board.items).filter(it => from ? it.rev > from : !it.deleted);
    return {ok: true, rev: board.rev, items};
  }
  apply(key, ops, actor) {
    this.check(key);
    if (!ACTORS.includes(actor)) throw new Error('不知道是谁在改白板');
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > LIMITS.ops) throw new Error('一次改动的条数不对');
    const prepared = ops.map(op => {
      const baseRev = Number.isInteger(op?.baseRev) && op.baseRev >= 0 ? op.baseRev : -1;
      if (baseRev < 0) throw new Error('白板改动缺少版本号');
      if (op.op === 'put') return {op: 'put', baseRev, item: cleanItem(op.item)};
      if (op.op === 'del' && typeof op.id === 'string' && ID.test(op.id)) return {op: 'del', baseRev, id: op.id};
      throw new Error('没有这种白板改动');
    });
    const board = this.read(key), applied = [], conflicts = [], now = Date.now();
    let rev = board.rev;
    for (const op of prepared) {
      const id = op.op === 'put' ? op.item.id : op.id, current = board.items[id];
      const currentRev = current ? current.rev : 0;
      if (currentRev !== op.baseRev) { if (current) conflicts.push(current); else conflicts.push({id, rev: 0, deleted: true}); continue; }
      if (op.op === 'del' && (!current || current.deleted)) continue;
      rev += 1;
      const next = op.op === 'put'
        ? {...op.item, rev, by: actor, updatedAt: now}
        : {id, kind: current.kind, rev, by: actor, updatedAt: now, deleted: true};
      board.items[id] = next; applied.push(next);
    }
    // 连线的两头必须是还在的元素；一头被删的连线跟着删掉（同一批里先放元素再放连线也行）。
    for (const it of Object.values(board.items)) {
      if (it.kind !== 'link' || it.deleted) continue;
      const alive = end => board.items[end] && !board.items[end].deleted && board.items[end].kind !== 'link';
      if (alive(it.from) && alive(it.to)) continue;
      rev += 1;
      const gone = {id: it.id, kind: 'link', rev, by: actor, updatedAt: now, deleted: true};
      board.items[it.id] = gone; applied.push(gone);
    }
    if (Object.values(board.items).filter(it => !it.deleted).length > LIMITS.items) throw new Error(`白板最多放 ${LIMITS.items} 个元素`);
    if (applied.length) writeSessionJson(this.file(key), {version: 1, rev, items: board.items});
    return {ok: true, rev, applied, conflicts};
  }
}

const STORES = Symbol.for('pinkie.whiteboard-store.instances');
export function sharedWhiteboardStore(root) {
  const shared = globalThis[STORES] ??= new Map();
  if (!shared.has(root)) shared.set(root, new WhiteboardStore(root));
  return shared.get(root);
}

// 界面上的手动改动走这两个方法，by 一律是 user；碧琪动手的工具（PR ②）另走 actor = pinkie。
export function registerWhiteboard(api, {root}) {
  const store = sharedWhiteboardStore(root);
  registerSessionMethod(api, 'pinkie.whiteboard.get', ({key, since}) => store.get(key, since));
  registerSessionMethod(api, 'pinkie.whiteboard.apply', ({key, ops}) => store.apply(key, ops, 'user'));
  return store;
}
