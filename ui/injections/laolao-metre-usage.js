/* laolao-metre-usage —— 界面吸收计划第 27 项「用量页入口」（#96 L39），只在 Metre 生效。
 *
 * 原生控制台本来就有用量页（路由 /usage，openclaw-usage-page：按天 / 按模型的令牌和估算花费），
 * 但 Metre 侧栏展开时整条原生导航被 laolao-metre-skin.css 藏掉，命令面板的原生导航也没有它，Metre 里就没有入口。
 * 这里只在侧栏顶上加一颗「用量」，和「总谱」「筛选」同一排；点了走原生路由打开那一页，不另画一份用量页、不另取数据。
 * 路由：原生 openclaw-app-shell 的 navigate 优先（不重载页面、不断网关），老版本退回 history + popstate，
 * 和 laolao-metre-prefs.js 的「打开技能」、laolao-mode-switcher.js 一样。
 * 按键带 pk-metre-nav 类：会话列表重画时和「总谱」一样被留住；其他五个模式里 laolao-metre-board.css 统一藏掉 pk-metre-nav。
 * 不自己开定时器、不自己开 DOM 观察器、不加新的全局名：刷新只挂在 Pinkie.domWatch、会话列表事件和 popstate 上。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreUsage) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const CONTROLS = 'aside.sidebar .laolao-session-controls';
  const CLS = 'pk-metre-nav--usage';
  const ROUTE = 'usage';
  const onUsage = () => /^\/usage(?:[/?#]|$)/.test(String(window.location?.pathname || ''));

  function openUsage() {
    const shell = document.querySelector('openclaw-app-shell');
    const nav = [shell, shell?.context].find((o) => typeof o?.navigate === 'function');
    if (nav) { nav.navigate(ROUTE); return 'navigate'; }
    window.history.pushState({}, '', '/' + ROUTE);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return 'history';
  }

  // 在用量页上时按键标成当前页（aria-current），样子和「总谱」打开态一样由 css 管。
  function paint(btn) {
    if (!btn) return;
    if (onUsage()) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }

  function ensure() {
    if (!isMetre()) return;
    const controls = document.querySelector(CONTROLS);
    if (!controls) return;
    let btn = controls.querySelector('.' + CLS);
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'pinkie-sidebar-entry pk-metre-nav ' + CLS;
      btn.type = 'button';
      btn.setAttribute('aria-label', '打开用量页：按天、按模型看令牌和估算花费');
      const label = document.createElement('span');
      label.textContent = '用量';
      btn.append(label);
      btn.addEventListener('click', () => { openUsage(); paint(btn); });
      controls.append(btn);
    }
    paint(btn);
  }

  window.addEventListener('laolao:sessions-changed', () => setTimeout(ensure, 0));
  window.addEventListener('popstate', () => setTimeout(ensure, 0));
  window.Pinkie?.domWatch?.poll?.(ensure, 1500);
  ensure();

  ns.metreUsage = Object.freeze({ROUTE, ensure, openUsage, onUsage});
})();
