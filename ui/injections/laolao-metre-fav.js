/* laolao-metre-fav —— U4 收藏模型（界面线 5 第二批）。只在 Metre 里起作用。
 * 引擎菜单「<引擎> 用哪个模型」那一步（laolao-metre-engine.js 画的 .pk-eng-menu；那个文件已到行数例外上限，所以另起这个文件，不改它）：
 *   每个模型一行右边加一个星标键（aria-pressed，aria-label「收藏 / 取消收藏 <模型名>」），键盘 Tab 能到，空格 / 回车切换。
 *   菜单每次画出这一步时，收藏的模型排到「‹ 换引擎」后面最前；收藏之间、非收藏之间保持引擎报上来的原顺序。
 *   点星标只改星标和存储，不当场重排（行不跳位），下次打开菜单才按新收藏排。星标是行旁边的兄弟按键，不在行按键里面，
 *   点它不会选中模型，也不会关菜单（菜单的「点外面关掉」只看点没点在菜单里）。
 * 存储：localStorage pinkie:metre:fav-models:v1，值是「引擎名/模型 slug」的数组（菜单里只看得到引擎名，没有引擎 id）。
 * 发现菜单：window.Pinkie.domWatch.watch（共用观察器，不新增观察器、定时器）。已经包过的行不再是 body 的直接子元素，所以重复触发不会重复包。
 * 样式在 laolao-metre-fav.css（.pk-fav-*）。对外只挂 window.Pinkie.metre.fav，给单测用。 */
(() => {
  'use strict';
  const pinkie = (window.Pinkie = window.Pinkie || {});
  const ns = (pinkie.metre = pinkie.metre || {});
  if (ns.fav) return;
  const KEY = 'pinkie:metre:fav-models:v1';
  const MAX = 200;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';

  function read() {
    try {
      const list = JSON.parse(window.localStorage?.getItem(KEY) || '[]');
      return Array.isArray(list) ? list.filter((key) => typeof key === 'string' && key) : [];
    } catch { return []; }
  }
  function write(list) {
    try { window.localStorage?.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* 存不了（无痕窗口等）：星标照样能点，只是不记 */ }
  }
  function toggle(key) {
    const list = read(), on = !list.includes(key);
    write(on ? [key, ...list] : list.filter((item) => item !== key));
    return on;
  }

  // 副标题是「<引擎名> 用哪个模型」才是选模型这一步；行里 .pk-eng-menu__note 是「slug · 默认 · 额度用完了…」，slug 在第一个「 · 」前面。
  const engineOf = (menu) => (/^(.+) 用哪个模型$/.exec(menu.querySelector('.pk-eng-menu__sub')?.textContent || '') || [])[1] || '';
  const slugOf = (item) => (item.querySelector('.pk-eng-menu__note')?.textContent || '').split(' · ')[0].trim();
  const nameOf = (item) => (item.querySelector('.pk-eng-menu__name')?.textContent || '').trim() || slugOf(item);

  function paint(star, on, name) {
    star.setAttribute('aria-pressed', String(on));
    star.setAttribute('aria-label', (on ? '取消收藏 ' : '收藏 ') + name);
    star.title = on ? '取消收藏' : '收藏：下次打开排在最前';
    star.textContent = on ? '★' : '☆';
  }

  function decorate(menu) {
    if (!isMetre() || !menu?.isConnected) return;
    const engine = engineOf(menu), body = menu.querySelector('.pk-eng-menu__body');
    if (!engine || !body) return;
    const items = [...body.querySelectorAll(':scope > .pk-eng-menu__item[role="menuitemradio"]')];
    if (!items.length) return;
    const favs = read(), first = [], rest = [];
    for (const item of items) {
      const slug = slugOf(item);
      if (!slug) continue;
      const key = engine + '/' + slug, name = nameOf(item);
      const row = document.createElement('div');
      row.className = 'pk-fav-row';
      row.setAttribute('role', 'none');
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'pk-fav-star';
      paint(star, favs.includes(key), name);
      star.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); paint(star, toggle(key), name); });
      item.replaceWith(row);
      row.append(item, star);
      (favs.includes(key) ? first : rest).push(row);
    }
    // 行原来紧跟在「‹ 换引擎」后面、后面没有别的东西（没有模型时才有提示，那时也没有行），所以按顺序重新接到末尾就是排好的样子。
    if (first.length) for (const row of [...first, ...rest]) body.append(row);
  }

  ns.fav = {KEY, read, toggle, decorate};
  const start = () => window.Pinkie?.domWatch?.watch?.('.pk-eng-menu', (menus) => menus.forEach(decorate), {immediate: true});
  if (window.Pinkie?.domWatch?.watch) start();
  else document.addEventListener('DOMContentLoaded', start, {once: true});
})();
