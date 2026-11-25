/* 工具箱「添加」组里的「截图」（「以后」S 级 I5，ui2）。
 *
 * 原生附件菜单有「拍照 / 照片 / 文件」，工具箱（laolao-composer-tray.js）整组照搬；原生没有截图，这里补一格。
 * 单独一个文件，不改工具箱脚本：工具箱菜单打开时（.pinkie-tray），在「添加」那一排末尾加一格，类名和工具箱自己的行一样，
 * 所以样式、上下键走焦点都照旧；工具箱重画把它冲掉时，下一轮页面变化再补上。
 *
 * 点了：浏览器自己的「选择要共享的屏幕或窗口」抓一帧 → PNG → 交给原生「照片」文件框（.agent-chat__photo-input）并发 change，
 * 和用户自己选了一张图同一条路；不自己拼附件、不经过后台。抓完一帧立刻停屏幕流。
 * 选择框里点取消（NotAllowedError / AbortError）不提示；别的失败用共用的 laolao:toast 说一句。
 * 环境没有 getDisplayMedia，或者照片框停用（还不能发消息）时不出这一格。
 * 不新增观察器、定时器和 window 全局名：页面变化走 window.Pinkie.domWatch.watch。 */
(() => {
  'use strict';
  const KEY = 'attach-shot';
  const anchorOf = () => document.querySelector('.agent-chat__input .pinkie-tray-btn[aria-expanded="true"]');
  const photoInput = (input) => input?.closest('.agent-chat__composer-shell')?.querySelector('.agent-chat__photo-input') || null;
  const canShoot = (input) => Boolean(navigator.mediaDevices?.getDisplayMedia) && photoInput(input)?.disabled === false;
  // 全部注入功能共用的通知出口（laolao-sidebar.js），不另造提示框。
  const notice = (message) => window.dispatchEvent(new CustomEvent('laolao:toast', {detail: {message}}));
  // 截图：四个取景角，中间一个小框（和工具箱自己的图标同一套线宽）。
  function icon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'pinkie-ic'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const corners = document.createElementNS(NS, 'path');
    corners.setAttribute('d', 'M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3');
    const frame = document.createElementNS(NS, 'rect');
    frame.setAttribute('class', 'pk-a');
    for (const [k, v] of Object.entries({x: 8.5, y: 9, width: 7, height: 6, rx: 1})) frame.setAttribute(k, String(v));
    svg.append(corners, frame);
    return svg;
  }
  const FRAME_WAIT_MS = 3000;
  // toBlob 回空（无头 WebKit 见过）就改用 toDataURL 解出同一张 PNG，和 laolao-rich-chart.js（#126）同一个退路；两样都不行才算没截到。
  function pngOf(canvas) {
    const viaUrl = () => {
      const url = canvas.toDataURL('image/png');
      const comma = url.indexOf(',');
      if (!url.startsWith('data:image/png') || comma < 0 || comma === url.length - 1) throw new Error('toDataURL');
      const bin = atob(url.slice(comma + 1)), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], {type: 'image/png'});
    };
    return new Promise((ok, no) => {
      const fallback = () => { try { ok(viaUrl()); } catch (error) { no(error); } };
      try { canvas.toBlob((b) => (b && b.size ? ok(b) : fallback()), 'image/png'); } catch { fallback(); }
    });
  }
  async function screenshot(input) {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      // 开播和第一帧合起来最多等 3 秒（监工 07:57）：没有画面的流上 play() 自己也可能一直不返回。
      // 等不到就当没截到，finally 照样停掉屏幕共享，不会一直挂着「正在共享」。
      let timer = 0;
      try {
        await new Promise((done, fail) => {
          timer = setTimeout(() => fail(new Error('no frame in time')), FRAME_WAIT_MS);
          const ready = () => (video.videoWidth ? done() : video.addEventListener('loadeddata', done, {once: true}));
          video.play().then(ready, fail);
        });
      } finally { clearTimeout(timer); }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await pngOf(canvas);
      const target = photoInput(input);
      if (!blob || !target || target.disabled) throw new Error('no frame');
      const now = new Date(), pad = (n) => String(n).padStart(2, '0');
      const name = `截图 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.png`;
      const files = new DataTransfer();
      files.items.add(new File([blob], name, {type: 'image/png'}));
      target.files = files.files;
      target.dispatchEvent(new Event('change', {bubbles: true}));
    } catch (error) {
      if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') notice('没截到图：没抓到画面，可以再试一次，或者用系统截图后粘贴进来');
    } finally {
      for (const track of stream?.getTracks?.() || []) track.stop();
    }
  }
  function tile(input, anchor) {
    const row = document.createElement('div');
    row.className = 'pinkie-tray__row'; row.dataset.key = KEY;
    const main = document.createElement('button');
    main.type = 'button'; main.className = 'pinkie-tray__item'; main.setAttribute('role', 'menuitem');
    const glyph = document.createElement('span'); glyph.className = 'pinkie-tray__icon'; glyph.append(icon());
    const body = document.createElement('span'); body.className = 'pinkie-tray__body';
    const title = document.createElement('span'); title.className = 'pinkie-tray__name'; title.textContent = '截图';
    body.append(title); main.append(glyph, body); row.append(main);
    // 先关菜单（再点一下工具箱按钮就是关），再弹浏览器的屏幕选择框。
    main.addEventListener('click', () => { if (anchor.getAttribute('aria-expanded') === 'true') anchor.click(); screenshot(input); });
    return row;
  }
  function paint(menus) {
    for (const menu of menus) {
      const tiles = menu.querySelector('.pinkie-tray__tiles');
      const have = menu.querySelector(`.pinkie-tray__row[data-key="${KEY}"]`);
      const anchor = anchorOf(), input = anchor?.closest('.agent-chat__input');
      const want = Boolean(tiles && input && canShoot(input));
      if (!want) { have?.remove(); continue; }
      if (have && have.parentElement === tiles && tiles.lastElementChild === have) continue;
      have?.remove();
      tiles.append(tile(input, anchor));
    }
  }
  window.Pinkie?.domWatch?.watch('.pinkie-tray', paint);
})();
