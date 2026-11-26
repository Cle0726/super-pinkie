/* Metre 引擎菜单：模型子菜单最底下那一行「用谁的模型」（用户 11-25：「对其他的也可以，比如 Codex」）。
 * - 能切的几家（引擎清单每行的 switchable.to）：一行「改用碧琪模型」，点了直接进那一家「碧琪模型」那一行的模型列表。
 * - 「碧琪模型」那一行反过来：一行「改回我自己的账号」。
 * - 不能切的几家：这一行灰掉（aria-disabled，点了不动），下面写一句为什么（switchable.why，引擎服务给的，不出现引擎服务的名字）。
 * 主文件 laolao-metre-engine.js 顶在行数例外上，画法放这里：主文件画完模型列表就在菜单里发一个 pk-eng-upstream 事件，
 * 带上这一行、整张引擎清单和「打开某一行的模型列表」的办法；这里接住，往菜单末尾加一行。不加全局名。
 */
(() => {
  'use strict';
  const LABEL = '碧琪模型';
  const esc = text => String(text ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));

  function item(name, note, off = false) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'pk-eng-menu__item pk-eng-menu__item--upstream' + (off ? ' pk-eng-menu__item--dim' : '');
    node.setAttribute('role', 'menuitem');
    node.innerHTML = `<span class="pk-eng-menu__name">${esc(name)}</span><span class="pk-eng-menu__note">${esc(note).replace(/(?:API )?密钥/g, '<span style="white-space:nowrap">$&</span>')}</span>`;   // 「密钥」不拆两行（协调者 11-25 20:14）
    if (off) node.setAttribute('aria-disabled', 'true');
    return node;
  }

  document.addEventListener('pk-eng-upstream', event => {
    const {row, rows = [], go} = event.detail || {};
    const menu = event.target;
    if (!row || typeof go !== 'function' || !(menu instanceof Element)) return;
    if (row.upstream === 'pinkie') {
      // 「碧琪模型」那一行：回到这一家自己的默认账号那一行。
      const own = rows.find(other => other.id === row.driver);
      if (!own) return;
      const back = item('改回我自己的账号', `${own.name || row.driver} 自己的登录和额度`);
      back.onclick = () => go(own.id);
      menu.append(back);
      return;
    }
    const {to, why} = row.switchable || {};
    if (to) {
      const target = rows.find(other => other.id === to);
      const next = item(`改用${LABEL}`, target ? '不用订阅，用量记在碧琪的额度上' : `${LABEL}那一行还没准备好`);
      next.onclick = () => go(to);
      menu.append(next);
      return;
    }
    // 不能切：灰掉、写原因。没给原因（老版本的引擎清单没有 switchable）就不画，不瞎猜。
    if (why) menu.append(item(`改用${LABEL}`, `用不了：${why}`, true));
  });
})();
