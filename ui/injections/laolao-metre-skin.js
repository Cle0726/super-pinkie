/* laolao-metre-skin —— Metre 不用碧琪的任何视觉（PLAN R6：「不要碧琪 IP 感和视觉，页面参考 Claude，
 * 只保留输出动画和前后端运行时的可视化」；用户 11-14 重申：和 Claude 界面一样，禁止碧琪的任何素材、UI、边框）。
 *
 * 做法：进 Metre 时把碧琪纯装饰的样式表整张停用（link.disabled，不删、不改文件），离开时原样恢复，
 * 所以其他模式的样式一点不变。负责布局和运行时可视化的样式表（侧栏、输入框、过程卡、工具流、状态条、
 * 计划清单、ask_user、模型选择器、工作台……）留着，由 laolao-metre-skin.css 把它们的形状和颜色改成素净的样子。
 * 同步加载（不 defer）：在第一帧之前就停掉，不闪粉色。 */
(() => {
  'use strict';
  if (window.__pinkieMetreSkin) return;
  // 纯装饰：墙纸和玻璃（redesign）、对话分隔星（divider）、碧琪的黑夜配色（night）、小碧琪和气球（companion）、
  // 开场动画（splash）、模式转场和菜单特效、学习台和游戏（Metre 里不出现）。
  const DECOR = /\/laolao-(?:redesign|divider|night|companion|splash|mode-transition-fx|mode-menu-fx|learning-[a-z-]+|study-desk[a-z-]*|desk-[a-z-]+|game-[a-z-]+)\.css(?:\?|$)/;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  let applied = null;
  function apply() {
    const on = isMetre();
    for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
      if (!DECOR.test(link.getAttribute('href') || '')) continue;
      if (on && !link.disabled) { link.dataset.metreOff = '1'; link.disabled = true; }
      else if (!on && link.dataset.metreOff === '1') { link.disabled = false; delete link.dataset.metreOff; }
    }
    applied = on;
  }
  new MutationObserver(() => { if (isMetre() !== applied) apply(); })
    .observe(root, {attributes: true, attributeFilter: ['data-laolao-mode']});
  // 后加载的样式表（defer 的那批在本文件之后才插进来）也要拦住。
  // 只看 <head>（样式表都在那里），不看聊天区，避免每条消息都触发。
  new MutationObserver((records) => {
    if (!isMetre()) return;
    if (records.some((r) => [...r.addedNodes].some((n) => n.tagName === 'LINK'))) apply();
  }).observe(document.head || root, {childList: true});
  apply();
  window.addEventListener('laolao:modechange', apply);
  window.__pinkieMetreSkin = {DECOR, apply, get on() { return applied; }};
})();
