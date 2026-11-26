/* laolao-metre-worktree —— S7：Metre 侧栏会话行显示这个会话开的工作树「目录 · 分支」（11-26 ui2，只在 Metre）。
 * 数据只用网关现成的 worktrees.list（{worktrees: [{name, path, branch, ownerKind, ownerId?, removedAt?}]}）：
 * 会话开的工作树 ownerKind = "session"、ownerId = 会话的 canonicalKey（网关 sessions 里 managedWorktrees.create）。
 * 只认还活着的（没有 removedAt）；对不上的行什么都不加。不造后台、不自己猜目录。
 * laolao-metre-list.js 的 decorate 每次画完列表叫 mark(groups)；本文件晚加载时自己补画一次。
 * 结果缓存 30 秒；会话有变化（laolao:sessions-changed）后最多 5 秒重取一次。出错就当没有，不报错。
 * 样子在 laolao-metre-worktree.css。 */
(() => {
  'use strict';
  if (window.PinkieMetreWorktree) return;
  const TTL = 30_000, MIN_GAP = 5_000;
  let byOwner = new Map(), fetchedAt = 0, stale = false, pending = null;
  const isMetre = () => document.documentElement.getAttribute('data-laolao-mode') === 'metre';
  const norm = (key) => String(key || '').trim().toLowerCase();
  function index(reply) {
    const map = new Map();
    for (const w of Array.isArray(reply?.worktrees) ? reply.worktrees : []) {
      if (!w || w.ownerKind !== 'session' || !w.ownerId || w.removedAt != null) continue;
      const folder = String(w.name || String(w.path || '').split(/[\\/]/).filter(Boolean).at(-1) || '').trim();
      if (folder || w.branch) map.set(norm(w.ownerId), {folder, branch: String(w.branch || '').trim(), path: String(w.path || '')});
    }
    return map;
  }
  function load() {
    const gw = window.__laolaoSidebar?.gwRequest;
    if (pending || typeof gw !== 'function') return pending;
    if (fetchedAt && Date.now() - fetchedAt < (stale ? MIN_GAP : TTL)) return null;
    pending = Promise.resolve().then(() => gw('worktrees.list', {}, 10_000)).then(index, () => new Map())
      .then((map) => { byOwner = map; fetchedAt = Date.now(); stale = false; pending = null; paint(document.querySelector('aside.sidebar') || document); });
    return pending;
  }
  function paint(root) {
    if (!root || !isMetre()) return;
    for (const n of root.querySelectorAll('.session-row-host[data-session-key]')) {
      const link = n.querySelector(':scope > .sidebar-recent-session__link');
      if (!link) continue;
      const w = byOwner.get(norm(n.dataset.sessionKey));
      let tag = link.querySelector(':scope > .pk-ml-wt');
      if (!w) { tag?.remove(); continue; }
      const text = [w.folder, w.branch].filter(Boolean).join(' · ');
      if (!tag) { tag = document.createElement('span'); tag.className = 'pk-ml-wt'; link.append(tag); }
      if (tag.textContent !== text) tag.textContent = text;
      const tip = '工作树 ' + (w.path || w.folder) + (w.branch ? '，分支 ' + w.branch : '');
      tag.dataset.pinkieTooltip = tip; tag.setAttribute('aria-label', tip);
    }
  }
  function mark(groups) { if (!isMetre()) return; paint(groups); load(); }
  window.addEventListener('laolao:sessions-changed', () => { stale = true; });
  window.PinkieMetreWorktree = Object.freeze({mark, index});
  if (isMetre()) mark(document.querySelector('aside.sidebar'));   // 列表可能在本文件加载前已经画过一遍
})();
