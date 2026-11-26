/* 作品装成桌面上的独立应用（任务-官方新功能五项-1125 第 1 项，PR①：安装、打开、卸载）。
   作品预览里加「装到桌面」；碧琪设置弹层里加「已装的应用」卡片：打开、卸载。
   网关 pinkie.apps.*（desktop-apps.mjs）拷副本、记清单；原生端 installApp / uninstallApp / openApp
   做开始菜单 / 桌面 / ~/Applications 的入口和独立窗口。
   图标：用作品的小预览没法安全截图（沙箱 iframe），所以画一个碧琪风的字母图标（作品名第一个字），256×256 PNG。
   不新增观察器、定时器和 window 全局名：预览按钮走 laolao-artifacts.js 的 pinkie:art-viewer 事件，
   设置卡片走 pinkie:settings-ready。 */
(() => {
  'use strict';
  const S = 'pinkie-user-settings__';
  const request = (method, params, timeout = 20_000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    return typeof rpc === 'function' ? rpc(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  const rpcOk = async (method, params, timeout) => {
    const value = await request(method, params, timeout);
    if (value?.ok === false) throw new Error(value.error || '没有成功');
    return value;
  };
  const native = message => {
    const call = window.pinkieNative;
    return typeof call === 'function' ? call(message, 30_000) : Promise.reject(new Error('装到桌面要在碧琪 App 里用'));
  };
  const nativeOk = async message => {
    const value = await native(message);
    if (value?.ok === false) throw new Error(value.error || '没有成功');
    return value;
  };
  const hasNative = () => Boolean(window.webkit?.messageHandlers?.pinkieNative || window.pywebview?.api?.pinkieNative);
  const isMac = /Mac/i.test(navigator.platform || '');
  const placeLabel = () => (isMac ? '「应用程序」文件夹' : '开始菜单和桌面');
  const toast = text => {
    if (typeof window.__laolaoToast === 'function') window.__laolaoToast(text);
    else window.__laolaoSidebar?.toast?.(text);
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, className, onClick) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = event => { event.stopPropagation(); onClick(event); };
    return node;
  };
  const appName = item => String(item.title || '作品').replace(/\.(html?)$/i, '').trim() || '作品';

  // 256×256 圆角方块 + 名字第一个字。颜色按名字挑，同一件作品每次一样。
  const COLORS = ['#F26BA8', '#8E7CF0', '#4FB3E8', '#F2A65A', '#5BC79A', '#E8697A'];
  function drawIcon(name) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      let hash = 0;
      for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
      ctx.fillStyle = COLORS[hash % COLORS.length];
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(16, 16, 224, 224, 52) : ctx.rect(16, 16, 224, 224);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 132px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText([...name][0]?.toUpperCase() || '★', 128, 138);
      return canvas.toDataURL('image/png');
    } catch { return ''; }
  }

  function nameBox(item, current) {
    return new Promise(resolve => {
      const mask = el('div', 'laolao-modal-mask pinkie-tools-mask pinkie-art-confirm');
      const box = el('div', 'laolao-modal pinkie-tools-modal pk-apps-dialog');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', '装到桌面');
      const input = el('input', 'pk-apps-dialog__name');
      input.value = current || appName(item);
      input.maxLength = 40;
      input.setAttribute('aria-label', '应用名字');
      const hint = current
        ? '已经装过了。再装一次会换成作品现在的版本，名字也可以改。'
        : `装好以后在${placeLabel()}里有它自己的图标，双击直接打开，不用先开碧琪。默认不联网。`;
      box.append(el('h3', 'laolao-modal__title', '装到桌面'), el('p', 'pinkie-art-confirm__text', hint), input);
      const buttons = el('div', 'laolao-modal__buttons');
      const done = value => { mask.remove(); document.removeEventListener('keydown', onKey, true); resolve(value); };
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done(null); }
        else if (event.key === 'Enter' && event.target === input) { event.preventDefault(); done(input.value.trim() || appName(item)); }
      };
      document.addEventListener('keydown', onKey, true);
      buttons.append(button('取消', 'laolao-modal__button', () => done(null)),
        button(current ? '重新装' : '装到桌面', 'laolao-modal__button laolao-modal__button--primary', () => done(input.value.trim() || appName(item))));
      box.append(buttons);
      mask.append(box);
      document.body.append(mask);
      input.focus();
      input.select();
    });
  }

  async function install(item, trigger) {
    let existing = null;
    try { existing = (await rpcOk('pinkie.apps.forArtifact', {id: item.id})).app; } catch {}
    const name = await nameBox(item, existing?.name);
    if (!name) return;
    trigger.disabled = true;
    try {
      const {app} = await rpcOk('pinkie.apps.install', {id: item.id, name, icon: drawIcon(name)}, 60_000);
      try { await nativeOk({type: 'installApp', appId: app.id}); }
      catch (error) {
        // 入口没建成就别留半个应用：副本也删掉，用户看到的是「没装上」。
        await request('pinkie.apps.remove', {id: app.id}).catch(() => {});
        throw error;
      }
      toast(`「${app.name}」装好了，在${placeLabel()}里`);
      trigger.textContent = '已装到桌面';
    } catch (error) {
      toast('没装上：' + (error.message || '不知道为什么'));
    } finally {
      trigger.disabled = false;
    }
  }

  window.addEventListener('pinkie:art-viewer', event => {
    const {item, actions} = event.detail || {};
    if (!item || !actions || item.kind !== 'html' || !hasNative()) return;
    const trigger = button('装到桌面', 'pinkie-art-btn pk-apps-install', () => void install(item, trigger));
    trigger.title = `装成${placeLabel()}里的独立应用`;
    actions.insertBefore(trigger, actions.firstChild);
    rpcOk('pinkie.apps.forArtifact', {id: item.id}).then(({app}) => { if (app && trigger.isConnected) trigger.textContent = '已装到桌面'; }).catch(() => {});
  });

  // ---------- 设置里的「已装的应用」 ----------
  async function uninstall(app, row) {
    try {
      await nativeOk({type: 'uninstallApp', appId: app.id});
      await rpcOk('pinkie.apps.remove', {id: app.id});
      row.remove();
      toast(`「${app.name}」卸载了，图标也删了`);
    } catch (error) {
      toast('没卸载干净：' + (error.message || '不知道为什么'));
    }
  }
  async function paintList(list) {
    list.replaceChildren(el('p', S + 'hint', '正在读…'));
    let apps = [];
    try { apps = (await rpcOk('pinkie.apps.list', {})).apps || []; }
    catch (error) { list.replaceChildren(el('p', S + 'hint', '读不到：' + error.message)); return; }
    list.replaceChildren();
    if (!apps.length) { list.append(el('p', S + 'hint', '还没有。在作品预览里点「装到桌面」，网页作品就能变成单独的应用。')); return; }
    for (const app of apps) {
      const row = el('div', S + 'row pk-apps-row');
      const copy = el('div', S + 'row-copy');
      const note = app.latest > app.version ? `作品有新版本（第 ${app.latest} 版），装的是第 ${app.version} 版` : `第 ${app.version} 版 · 不联网`;
      copy.append(el('span', S + 'row-title', app.name), el('span', S + 'hint', note));
      const control = el('div', S + 'row-control pk-apps-row__actions');
      control.append(
        button('打开', 'pinkie-art-btn', () => nativeOk({type: 'openApp', appId: app.id}).catch(error => toast(error.message))),
        button('卸载', 'pinkie-art-btn pk-apps-uninstall', () => void uninstall(app, row)),
      );
      row.append(copy, control);
      list.append(row);
    }
  }
  function mount(target) {
    if (!target || !hasNative() || target.querySelector('.pk-apps-card')) return;
    const card = el('section', S + 'card pk-apps-card');
    const head = el('header', S + 'card-header');
    const icon = el('span', S + 'icon', '▣');
    icon.setAttribute('aria-hidden', 'true');
    head.append(icon, el('h3', S + 'card-title', '已装的应用'));
    const list = el('div', 'pk-apps-list');
    card.append(head, el('p', S + 'card-hint', `从作品装到${placeLabel()}的应用。卸载会把图标和碧琪里存的副本一起删掉，原来的作品文件不动。`), list);
    const footer = target.querySelector('.' + S + 'footer');
    footer ? footer.before(card) : target.append(card);
    void paintList(list);
  }
  window.addEventListener('pinkie:settings-ready', event => mount(event.detail));
  const ready = () => mount(document.querySelector('#laolao-user-settings .' + S + 'scroll'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
})();
