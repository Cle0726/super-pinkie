/* 碧琪的一套线条图标 · 侧栏、右侧快捷栏共用。
 *
 * 同一套线条语言：24 网格、圆头细线，颜色跟着所在按钮走（currentColor）。
 * 每个图标只带一个小记号（加号、星、樱桃、圆心），小记号平时是一点粉，其余单色。
 * 外表克制，回应丰富：按钮悬停 / 聚焦时动的只有那个小记号（样式在 laolao-icons.css）。
 *
 * 用法：window.PinkieIcons.markup('search') 得到一段 <svg>；.node('search') 得到元素。
 * 没有这个名字时返回空串 / null，调用的地方各自留着原来的图标当后备。
 * 必须排在用它的脚本前面加载（laolao-session-list.js 是同步脚本，所以这个也是）。 */
(() => {
  'use strict';
  if (window.PinkieIcons) return;
  const STAR = 'M0-3c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3z';
  const star = (x, y, scale, className) => `<g transform="translate(${x} ${y}) scale(${scale})"><path class="${className}" d="${STAR}"/></g>`;
  const ICONS = {
    // 新会话：一只气球，右上角一个小加号。
    'new-session': '<g class="pk-balloon"><ellipse cx="10.5" cy="10.5" rx="5.6" ry="6.4"/><path d="M9.7 16.8l.8 1.1.8-1.1"/></g>'
      + '<path class="pk-string" d="M10.5 17.9c.2 1.2-1.3 1.7-.6 3.3"/><path class="pk-plus pk-a" d="M18 3.6v4.4M15.8 5.8h4.4"/>',
    // 临时会话：同一只气球，虚线的。
    temp: '<g class="pk-balloon"><ellipse cx="12" cy="10" rx="5.8" ry="6.6" stroke-dasharray="2.3 2.5"/></g>'
      + '<path class="pk-string" d="M12 16.8c.2 1.4-1.3 1.9-.6 3.9"/>',
    // 搜索：镜片里一颗小星。
    search: '<g class="pk-lens"><circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.3 15.3L20 20"/></g>' + star(10.5, 10.5, .82, 'pk-twinkle pk-f'),
    // 作品：纸杯蛋糕，顶上一颗樱桃。
    works: '<path d="M6.6 13h10.8l-1.4 7.2H8z"/><path d="M12 14.2v4.8" opacity=".5"/>'
      + '<path class="pk-frost" d="M6 13c-1.1-2.2.5-4.3 2.6-4.1.2-2.3 1.9-3.5 3.4-3.5s3.2 1.2 3.4 3.5c2.1-.2 3.7 1.9 2.6 4.1"/>'
      + '<circle class="pk-cherry pk-f" cx="12" cy="3.6" r="1.35"/>',
    // 深色 / 浅色。
    moon: '<path class="pk-moon" d="M18.6 14.7A7.6 7.6 0 1 1 9.3 5.4a6 6 0 0 0 9.3 9.3z"/>' + star(17.2, 6.2, .78, 'pk-twinkle pk-f'),
    sun: '<g class="pk-rays"><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6"/></g>'
      + '<circle cx="12" cy="12" r="4.4"/><circle class="pk-twinkle pk-f" cx="12" cy="12" r="1.5"/>',
    // 演示工具：魔杖，杖头是四角星。
    wand: '<path class="pk-wand" d="M4.8 19.2L13.6 10.4"/>' + star(16.3, 7.7, 1.25, 'pk-twinkle pk-f')
      + '<path class="pk-spark pk-a" d="M6.2 6.4v2.2M5.1 7.5h2.2"/><path class="pk-spark pk-a" d="M19 15.4v2.2M17.9 16.5h2.2"/>',
    // 浏览器：地球，一条经线是粉的。
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16" opacity=".6"/><path class="pk-sweep pk-a" pathLength="100" d="M12 4c2.7 2.5 2.7 13.5 0 16"/>'
      + '<path d="M12 4c-2.7 2.5-2.7 13.5 0 16" opacity=".6"/>',
    // 更多：三个点，中间那个是粉的。
    more: '<circle class="pk-dot pk-solid" cx="6" cy="12" r="1.4"/><circle class="pk-dot pk-f" cx="12" cy="12" r="1.4"/><circle class="pk-dot pk-solid" cx="18" cy="12" r="1.4"/>',
  };
  const markup = (name) => Object.prototype.hasOwnProperty.call(ICONS, name)
    ? `<svg class="pinkie-ic" data-pinkie-ic="${name}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>` : '';
  const node = (name) => {
    const html = markup(name);
    if (!html || typeof document === 'undefined') return null;
    const holder = document.createElement('span');
    holder.innerHTML = html;
    return holder.firstElementChild;
  };
  window.PinkieIcons = Object.freeze({markup, node, names: Object.freeze(Object.keys(ICONS))});
})();
