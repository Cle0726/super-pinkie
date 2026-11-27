// 「乐手」（briefs/metre-engines-1122 PLAN 3.5，E5；照 OpenMausBot「机器人当联系人」）：
// 一个乐手 = 名字 + 引擎（账号）+ 模型 + 放手程度 + 可选的 Metre 角色卡。引擎菜单里一键选用，Metre 派活时写 player 就用它。
// 存在 <引擎目录>/players.json，只有这台电脑上用；不存任何账号信息（引擎只记实例 id）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_PLAYERS = 24;
const LEVEL_IDS = new Set(['full-access', 'auto', 'auto-accept-edits', 'approval-required']);
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const text = (value, n) => String(value ?? '').replace(EMAIL, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

export class Players {
  constructor(file) { this.file = file; }
  list() {
    try {
      const rows = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(rows) ? rows.filter(row => row && ID.test(row.id || '') && row.name && ID.test(row.engine || '')) : [];
    } catch { return []; }
  }
  write(rows) {
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(rows, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    return rows;
  }
  // 名字或 id 都认（Metre 写 player 时多半写名字）。
  find(ref) {
    const key = String(ref || '').trim();
    if (!key) return null;
    const rows = this.list();
    return rows.find(row => row.id === key) || rows.find(row => row.name === key) || rows.find(row => row.name.toLowerCase() === key.toLowerCase()) || null;
  }
  save({id = '', name, engine, model = '', level = 'full-access', role = ''} = {}) {
    const label = text(name, 24);
    if (!label) throw new Error('给乐手起个名字');
    if (!ID.test(String(engine || '')) || engine === 'metre') throw new Error('乐手要选一个外部引擎');
    const rows = this.list();
    const clash = rows.find(row => row.name === label && row.id !== id);
    if (clash) throw new Error(`已经有一个叫「${label}」的乐手了`);
    const row = {id: id && rows.some(item => item.id === id) ? id : `player-${crypto.randomUUID().slice(0, 8)}`, name: label, engine: String(engine),
      model: text(model, 200), level: LEVEL_IDS.has(level) ? level : 'full-access', role: ID.test(String(role || '')) ? String(role) : ''};
    const index = rows.findIndex(item => item.id === row.id);
    if (index >= 0) rows[index] = row;
    else if (rows.length >= MAX_PLAYERS) throw new Error(`最多 ${MAX_PLAYERS} 个乐手，先删掉一个`);
    else rows.push(row);
    this.write(rows);
    return row;
  }
  remove(id) {
    const rows = this.list();
    if (!rows.some(row => row.id === id)) throw new Error('这个乐手已经不在了');
    return this.write(rows.filter(row => row.id !== id));
  }
}

// 网关方法：pinkie.engines.players {action: list | save | remove}。
// roles：能给乐手挂的 Metre 角色卡（id + 名字），界面里选。
export function registerPlayers(api, {players, register, roles = () => []}) {
  const view = extra => ({players: players.list(), roles: (() => { try { return roles(); } catch { return []; } })(), ...extra});
  register(api, 'pinkie.engines.players', async ({action = 'list', player, id} = {}) => {
    if (action === 'save') return view({saved: players.save(player || {})});
    if (action === 'remove') { players.remove(String(id || '')); return view(); }
    return view();
  });
}
