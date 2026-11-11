/* Shared native updater presentation. Values come only from the updater bridge. */
(() => {
  'use strict';
  if (window.__pinkieUpdateDialog) return;
  const modes = new Set(['chat', 'project', 'thinking', 'learning']);
  const stages = ['check', 'download', 'verify', 'install', 'restart'];
  const labels = ['检查', '下载', '校验', '安装', '重启'];
  const manualUrl = 'https://github.com/Cle0726/super-pinkie/releases/latest';
  // 碧琪的表情贴纸跟着更新阶段换（和过程卡同一套图，放在 control-ui 根目录）。
  const stickers = {check:'thinking', available:'done', current:'writing', download:'working', verify:'thinking',
    ready:'done', install:'working', error:'oops', installed:'done'};
  // 更新说明：碧琪口吻的一段摘要 + 细节。细节多时先收着，入口也用碧琪的话（docs/RELEASE-NOTES.md）。
  const MORE = '听碧琪一件件说', LESS = '先说到这儿';
  const notesOf = info => {
    const clean = x => String(x || '').replace(/\s+/g, ' ').trim();
    let summary = clean(info?.summary);
    let details = Array.isArray(info?.details) ? info.details.map(clean).filter(Boolean) : [];
    if (!summary && !details.length) {
      // 旧版发布正文只有一串行：第一行当摘要。
      const lines = String(info?.notes || '').split('\n').map(clean).filter(Boolean);
      summary = lines.shift() || ''; details = lines;
    }
    return {summary, details: details.slice(0, 12)};
  };
  const ICON_MORE = 'M6 9l6 6 6-6';
  const routeKey = 'pinkie-update-route';
  // 国内网络连 GitHub 常常很慢：第一次打开时，时区在国内就默认走国内线路；用户选过就记住。
  const defaultRoute = () => {
    try { const saved = localStorage.getItem(routeKey); if (saved === 'mirror' || saved === 'official') return saved; } catch (_) {}
    let zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    return /^Asia\/(?:Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar)$/.test(zone) ? 'mirror' : 'official';
  };
  const state = { stage: 'check', info: null, progress: null, busy: false, operation: null, opener: null, route: defaultRoute() };
  const pending = new Map(); let nextRequest = 0;
  window.__pinkieUpdateResult = (id, value) => {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); clearTimeout(request.timer); request.resolve(value);
  };
  const macRequest = (action, route) => new Promise((resolve, reject) => {
    const id = ++nextRequest;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('update timed out')); }, action === 'prepare' ? 31 * 60 * 1000 : 150000);
    pending.set(id, {resolve, reject, timer});
    try { window.webkit.messageHandlers.laolaoUpdate.postMessage({action, request:id, route}); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  const macApi = {check_for_updates:route => macRequest('check', route),prepare_update:route => macRequest('prepare', route),apply_update:() => macRequest('apply')};
  const api = () => window.pywebview?.api || (window.__pinkieMacUpdaterV2 && window.webkit?.messageHandlers?.laolaoUpdate ? macApi : null);
  const supported = () => modes.has(document.documentElement.dataset.laolaoMode)
    && typeof api()?.check_for_updates === 'function'
    && typeof api()?.prepare_update === 'function'
    && typeof api()?.apply_update === 'function';
  const size = n => `${(n / 1048576).toFixed(1)} MB`;
  const duration = n => n < 60 ? `${Math.max(1, Math.ceil(n))} 秒` : `${Math.ceil(n / 60)} 分钟`;
  const validNumber = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const node = () => document.getElementById('pinkie-update-v2');
  const close = () => { const modal = node(); if (!modal) return; modal.remove(); state.opener?.focus?.(); };
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  const ICON_CHECK = 'M5 12.5l4.2 4.2L19 7';
  const ICON_SHIELD = 'M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z';
  const ICON_GLOBE = 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 0c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9m0-18C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9M3.5 9h17M3.5 15h17';
  function mount() {
    if (node()) return node();
    state.opener = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.id = 'pinkie-update-v2';
    backdrop.innerHTML = `<section class="pinkie-upd" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="pinkie-upd-title" aria-describedby="pinkie-upd-intro">
      <button type="button" class="pinkie-upd__close" aria-label="关闭更新窗口">${icon('M6 6l12 12M18 6L6 18')}</button>
      <header class="pinkie-upd__hero">
        <div class="pinkie-upd__headline">
          <div class="pinkie-upd__eyebrow"><span class="pinkie-upd__brand">碧琪</span><span class="pinkie-upd__version"></span></div>
          <h2 id="pinkie-upd-title"></h2><p id="pinkie-upd-intro" class="pinkie-upd__intro"></p>
        </div>
        <div class="pinkie-upd__mascot" aria-hidden="true"><img alt="" draggable="false"></div>
      </header>
      <div class="pinkie-upd__route" role="radiogroup" aria-label="下载线路">
        <span class="pinkie-upd__route-label">${icon(ICON_GLOBE)}下载线路</span>
        <div class="pinkie-upd__segments">
          <button type="button" role="radio" data-route="official">官方线路</button>
          <button type="button" role="radio" data-route="mirror">国内线路</button>
        </div>
      </div>
      <div class="pinkie-upd__panel">
        <ol class="pinkie-upd__steps" aria-label="更新步骤">${labels.map(x => `<li><i aria-hidden="true"></i><span>${x}</span></li>`).join('')}</ol>
        <div class="pinkie-upd__measure" aria-live="polite"><strong></strong><span></span></div>
        <div class="pinkie-upd__track" role="progressbar" aria-label="更新进度" aria-valuemin="0" aria-valuemax="100"><div></div></div>
        <p class="pinkie-upd__detail"><span></span><span></span></p>
      </div>
      <div class="pinkie-upd__notes" hidden><h3>碧琪的新变化</h3>
        <p class="pinkie-upd__summary"><span></span><button type="button" class="pinkie-upd__more" aria-expanded="false" aria-controls="pinkie-upd-details"><span>${MORE}</span>${icon(ICON_MORE)}</button></p>
        <ul id="pinkie-upd-details"></ul></div>
      <p class="pinkie-upd__reassure">${icon(ICON_SHIELD)}<span>安装时会暂时退出，<strong>你的记忆和设置不会丢。</strong></span></p>
      <div class="pinkie-upd__actions"><a class="pinkie-upd__manual" href="${manualUrl}" target="_blank" rel="noopener noreferrer" hidden>手动下载</a><button type="button" class="pinkie-upd__switch" hidden>换国内线路</button><button type="button" class="pinkie-upd__later">稍后再说</button><button type="button" class="pinkie-upd__primary"></button></div>
    </section>`;
    const img = backdrop.querySelector('.pinkie-upd__mascot img');
    img.addEventListener('error', () => { img.closest('.pinkie-upd__mascot').classList.add('is-missing'); });
    backdrop.querySelector('.pinkie-upd__close').addEventListener('click', close);
    backdrop.querySelector('.pinkie-upd__later').addEventListener('click', close);
    backdrop.querySelector('.pinkie-upd__primary').addEventListener('click', primary);
    backdrop.querySelector('.pinkie-upd__more').addEventListener('click', () => { state.notesOpen = !state.notesOpen; paint(); });
    backdrop.querySelector('.pinkie-upd__switch').addEventListener('click', () => chooseRoute('mirror'));
    backdrop.querySelectorAll('.pinkie-upd__segments button').forEach(button => button.addEventListener('click', () => chooseRoute(button.dataset.route)));
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.stage !== 'install') { e.preventDefault(); close(); }
      if (e.key !== 'Tab') return;
      const controls = [...backdrop.querySelectorAll('button:not(:disabled):not([hidden]),a:not([hidden])')].filter(el => el.offsetParent !== null);
      if (!controls.length) return;
      if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === controls[controls.length - 1]) { e.preventDefault(); controls[0].focus(); }
    });
    document.body.append(backdrop);
    // 焦点先放在对话框本身：读屏会读标题，键盘 Tab 一下就到按钮，也不会一打开就在关闭键上画一圈焦点框。
    backdrop.querySelector('.pinkie-upd').focus({preventScroll: true});
    return backdrop;
  }
  // 换线路：记住选择；还没开始下载时重新检查一次（两条线路看到的版本信息来自不同地方）。
  function chooseRoute(route) {
    if (route !== 'mirror' && route !== 'official') return;
    const changed = state.route !== route;
    state.route = route;
    try { localStorage.setItem(routeKey, route); } catch (_) {}
    if (state.busy) return void paint();
    if (state.stage === 'error' && state.errorAt === 1) return void download();
    if (changed || state.stage === 'error') return void check();
    paint();
  }
  function paint() {
    const root = node(); if (!root) return;
    const s = state.stage, p = state.progress || {};
    const mirror = state.route === 'mirror';
    const details = {
      check: ['正在看看有没有新版本', mirror ? '正在通过国内线路连接更新服务。' : '稍等一下，碧琪正在连接更新服务。', '正在检查', '连接更新服务…'],
      available: ['有新版本啦', '下载时可以继续聊天；安装时需要短暂退出，完成后会自动回来。', '准备下载', '下载时间取决于网络'],
      current: ['已经是最新版本啦', '暂时不用更新，可以继续使用碧琪。', '检查完成', ''],
      download: ['更新包正在路上', '下载时可以继续聊天，安装时需要短暂退出，完成后会自动回来。', '正在下载', ''],
      verify: ['下载好了，正在检查', '正在核对更新包是否完整，请稍等片刻。', '正在校验', '确认文件完整后就可以安装'],
      ready: ['准备好了', '下载和校验已经完成，可以开始安装。', '校验完成', '安装时碧琪会暂时退出'],
      install: ['正在准备安装', '碧琪要暂时离开一会儿，安装结束后会自动回来。', '正在启动安装', '请保持电脑开机'],
      installed: ['碧琪换上新版本啦', '记忆和设置都还在，可以接着用。', '', ''],
      error: ['这次没更新成功', mirror ? '国内线路暂时没连上，可以重试、换回官方线路，或手动下载安装包。'
        : '网络或更新服务可能开了个小差。在国内的话，换成国内线路通常会快很多。', '更新没有完成', '已经下载的内容会尽量保留']
    }[s] || [];
    if (s === 'available' && state.info?.unchangedCheckout) {
      details[0] = '源码没有新提交';
      details[1] = '当前应用的构建版本无法确认。你仍然可以重新准备并安装。';
    }
    if (s === 'error' && state.errorMessage) details[1] = state.errorMessage;
    root.dataset.stage = s;
    root.querySelector('#pinkie-upd-title').textContent = details[0] || '';
    root.querySelector('#pinkie-upd-intro').textContent = details[1] || '';
    root.querySelector('.pinkie-upd__version').textContent = state.info?.version ? `${s === 'installed' ? '现在是' : '新版本'} ${state.info.version}` : '';
    root.querySelector('.pinkie-upd__panel').hidden = s === 'installed';
    root.querySelector('.pinkie-upd__reassure').hidden = s === 'installed';
    const img = root.querySelector('.pinkie-upd__mascot img');
    const sticker = `./laolao-pinkie-status-${stickers[s] || 'thinking'}.png`;
    if (img.getAttribute('src') !== sticker) img.setAttribute('src', sticker);
    let index = stages.indexOf(s); if (s === 'available' || s === 'current') index = 0; if (s === 'ready') index = 2; if (s === 'error') index = state.errorAt || 0;
    root.querySelectorAll('.pinkie-upd__steps li').forEach((el, i) => {
      el.classList.toggle('done', i < index || (s === 'current' && i === 0) || (s === 'ready' && i === 2));
      el.classList.toggle('current', i === index && !(s === 'current' || s === 'ready'));
      el.classList.toggle('failed', s === 'error' && i === index);
    });
    let amount = details[2] || '', percent = '', left = details[3] || '', right = '', value = null;
    if (s === 'download' && validNumber(p.downloaded)) {
      const total = validNumber(p.total) && p.total > 0 && p.downloaded <= p.total ? p.total : null;
      amount = total ? `${size(p.downloaded)} / ${size(total)}` : `已下载 ${size(p.downloaded)}`;
      if (total) { value = Math.min(100, p.downloaded / total * 100); percent = `${Math.floor(value)}%`; }
      left = validNumber(p.bytesPerSecond) && p.bytesPerSecond > 0 ? `下载速度 ${size(p.bytesPerSecond)}/s` : '正在下载';
      right = validNumber(p.etaSeconds) && total ? `预计还要 ${duration(p.etaSeconds)}` : (total ? '预计时间暂时无法计算' : '暂时拿不到文件总大小');
    }
    if (s === 'download' && mirror) left = `${left} · 国内线路`;
    root.querySelector('.pinkie-upd__measure strong').textContent = amount;
    root.querySelector('.pinkie-upd__measure span').textContent = percent;
    const track = root.querySelector('.pinkie-upd__track');
    track.classList.toggle('is-indeterminate', ['check','download','verify','install'].includes(s) && value == null);
    track.classList.toggle('is-complete', s === 'ready' || s === 'current');
    track.setAttribute('aria-valuetext', amount);
    if (value == null) { track.removeAttribute('aria-valuenow'); track.firstElementChild.style.width = s === 'error' ? '0%' : ''; }
    else { track.setAttribute('aria-valuenow', String(Math.round(value))); track.firstElementChild.style.width = `${value}%`; }
    const detail = root.querySelectorAll('.pinkie-upd__detail span'); detail[0].textContent = left; detail[1].textContent = right;
    const {summary, details: items} = notesOf(state.info);
    const notesRoot = root.querySelector('.pinkie-upd__notes'); notesRoot.hidden = !summary && !items.length;
    // 两三句短话就直接摆出来；多了只给摘要，旁边放碧琪的展开入口。
    const long = items.length > 2 || items.join('').length > 90;
    const open = !long || !!state.notesOpen;
    notesRoot.classList.toggle('is-open', open);
    const summaryRoot = notesRoot.querySelector('.pinkie-upd__summary');
    summaryRoot.hidden = !summary && !long;
    summaryRoot.firstElementChild.textContent = summary;
    const more = notesRoot.querySelector('.pinkie-upd__more');
    more.hidden = !long || !items.length;
    more.setAttribute('aria-expanded', String(open));
    more.firstElementChild.textContent = open ? LESS : MORE;
    const list = notesRoot.querySelector('ul'); list.hidden = !open || !items.length;
    list.replaceChildren(...items.map(note => {
      const li = document.createElement('li'); li.innerHTML = icon(ICON_CHECK); const text = document.createElement('span'); text.textContent = note; li.append(text); return li;
    }));
    // 线路切换只在还没开始下载、或者失败时出现；下载中途换线路没有意义。
    const routeRoot = root.querySelector('.pinkie-upd__route');
    routeRoot.hidden = !['available', 'error', 'current'].includes(s) || state.busy;
    routeRoot.querySelectorAll('button').forEach(button => {
      const on = button.dataset.route === state.route;
      button.setAttribute('aria-checked', String(on)); button.classList.toggle('on', on); button.tabIndex = on ? 0 : -1;
    });
    const manual = root.querySelector('.pinkie-upd__manual');
    const mirrorManual = /^https:\/\//.test(String(state.info?.manualUrl || '')) ? state.info.manualUrl : '';
    manual.href = mirror && mirrorManual ? mirrorManual : manualUrl;
    manual.hidden = s !== 'error';
    root.querySelector('.pinkie-upd__switch').hidden = !(s === 'error' && !mirror);
    const action = root.querySelector('.pinkie-upd__primary');
    action.textContent = ({installed:'知道了',available:'开始下载',ready:'安装并重启',error:'重新试试',current:'知道了',download:'后台下载',verify:'后台处理',check:'稍后再说',install:'正在安装'})[s] || '知道了';
    action.disabled = s === 'install';
    root.querySelector('.pinkie-upd__later').hidden = ['check','current','download','verify','error','installed'].includes(s);
    root.querySelector('.pinkie-upd__close').disabled = s === 'install';
  }
  async function check() {
    if (state.busy) return;
    state.busy = true; state.stage = 'check'; state.progress = null; state.errorMessage = ''; paint();
    try {
      const info = await api().check_for_updates(state.route);
      state.notesOpen = false;
      if (info?.temporaryError || info?.supported === false) { state.errorAt = 0; state.errorMessage = info?.message || ''; state.stage = 'error'; }
      else if (info?.available) { state.info = info; state.stage = 'available'; }
      else { state.info = null; state.stage = 'current'; }
    } catch (_) { state.errorAt = 0; state.stage = 'error'; }
    finally { state.busy = false; paint(); }
  }
  async function download() {
    if (state.busy) return;
    state.busy = true; state.stage = 'download'; state.progress = null; state.errorMessage = ''; paint();
    try {
      const result = await api().prepare_update(state.route);
      if (result?.ready) state.stage = 'ready';
      else { state.errorAt = 1; state.errorMessage = result?.message || ''; state.stage = 'error'; }
    } catch (_) { state.errorAt = 1; state.stage = 'error'; }
    finally { state.busy = false; paint(); }
  }
  async function install() {
    if (state.busy) return;
    state.busy = true; state.stage = 'install'; state.errorMessage = ''; paint();
    try {
      const result = await api().apply_update();
      if (!result?.started) { state.errorAt = 3; state.errorMessage = result?.message || ''; state.stage = 'error'; }
    } catch (_) { state.errorAt = 3; state.stage = 'error'; }
    finally { state.busy = false; paint(); }
  }
  function primary() {
    if (state.stage === 'available') return void download();
    if (state.stage === 'ready') return void install();
    if (state.stage === 'error') return void (state.errorAt === 0 ? check() : state.errorAt === 3 ? install() : download());
    if (state.stage !== 'install') close();
  }
  window.__pinkieUpdateProgress = event => {
    if (!state.busy || !event || typeof event !== 'object') return;
    if (event.stage === 'metadata') { state.info = {...state.info, version:event.version, notes:event.notes, summary:event.summary, details:event.details}; }
    else if (event.stage === 'download' && validNumber(event.downloaded)) { state.stage = 'download'; state.progress = event; }
    else if (event.stage === 'verify') state.stage = 'verify';
    else return;
    paint();
  };
  window.__pinkieUpdateDialog = { open(info) {
    if (!supported()) return false;
    mount();
    if (state.busy) { paint(); return true; }
    if (info?.available) { state.info = info; state.stage = 'available'; state.notesOpen = false; paint(); }
    else if (state.stage === 'ready') paint();
    else void check();
    return true;
  },
  // Windows 更新装好后第一次打开：同一张卡，告诉用户这次碧琪变了什么。
  showInstalled(info) {
    if (!supported() || state.busy) return false;
    const {summary, details} = notesOf(info);
    if (!summary && !details.length) return false;
    mount(); state.info = info; state.stage = 'installed'; state.notesOpen = false; paint();
    return true;
  } };
})();
