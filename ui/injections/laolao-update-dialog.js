/* Shared native updater presentation. Values come only from the updater bridge. */
(() => {
  'use strict';
  if (window.__pinkieUpdateDialog) return;
  const modes = new Set(['chat', 'project', 'thinking', 'learning']);
  const stages = ['check', 'download', 'verify', 'install', 'restart'];
  const labels = ['检查', '下载', '校验', '安装', '重启'];
  const manualUrl = 'https://github.com/Cle0726/super-pinkie/releases/latest';
  const state = { stage: 'check', info: null, progress: null, busy: false, operation: null, opener: null };
  const pending = new Map(); let nextRequest = 0;
  window.__pinkieUpdateResult = (id, value) => {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); clearTimeout(request.timer); request.resolve(value);
  };
  const macRequest = action => new Promise((resolve, reject) => {
    const id = ++nextRequest;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('update timed out')); }, action === 'prepare' ? 31 * 60 * 1000 : 150000);
    pending.set(id, {resolve, reject, timer});
    try { window.webkit.messageHandlers.laolaoUpdate.postMessage({action, request:id}); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  const macApi = {check_for_updates:() => macRequest('check'),prepare_update:() => macRequest('prepare'),apply_update:() => macRequest('apply')};
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
  function mount() {
    if (node()) return node();
    state.opener = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.id = 'pinkie-update-v2';
    backdrop.innerHTML = `<section class="pinkie-upd" role="dialog" aria-modal="true" aria-labelledby="pinkie-upd-title" aria-describedby="pinkie-upd-intro">
      <button type="button" class="pinkie-upd__close" aria-label="关闭更新窗口">×</button>
      <div class="pinkie-upd__eyebrow"><span class="pinkie-upd__spark" aria-hidden="true">✦</span><span>给碧琪更新一下</span><span class="pinkie-upd__version"></span></div>
      <h2 id="pinkie-upd-title"></h2><p id="pinkie-upd-intro" class="pinkie-upd__intro"></p>
      <ol class="pinkie-upd__steps" aria-label="更新步骤">${labels.map(x => `<li>${x}</li>`).join('')}</ol>
      <div class="pinkie-upd__measure" aria-live="polite"><strong></strong><span></span></div>
      <div class="pinkie-upd__track" role="progressbar" aria-label="更新进度" aria-valuemin="0" aria-valuemax="100"><div></div></div>
      <p class="pinkie-upd__detail"><span></span><span></span></p>
      <div class="pinkie-upd__notes" hidden><h3>这次更新了什么</h3><ul></ul></div>
      <p class="pinkie-upd__reassure">安装时会暂时退出，<strong>你的记忆和设置不会丢。</strong></p>
      <div class="pinkie-upd__actions"><button type="button" class="pinkie-upd__later">稍后再说</button><a class="pinkie-upd__manual" href="${manualUrl}" target="_blank" rel="noopener noreferrer" hidden>手动下载</a><button type="button" class="pinkie-upd__primary"></button></div>
    </section>`;
    backdrop.querySelector('.pinkie-upd__close').addEventListener('click', close);
    backdrop.querySelector('.pinkie-upd__later').addEventListener('click', close);
    backdrop.querySelector('.pinkie-upd__primary').addEventListener('click', primary);
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.stage !== 'install') { e.preventDefault(); close(); }
      if (e.key !== 'Tab') return;
      const controls = [...backdrop.querySelectorAll('button:not(:disabled),a:not([hidden])')];
      if (!controls.length) return;
      if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === controls[controls.length - 1]) { e.preventDefault(); controls[0].focus(); }
    });
    document.body.append(backdrop);
    backdrop.querySelector('.pinkie-upd__close').focus();
    return backdrop;
  }
  function paint() {
    const root = node(); if (!root) return;
    const s = state.stage, p = state.progress || {};
    const details = {
      check: ['正在看看有没有新版本', '稍等一下，碧琪正在连接更新服务。', '正在检查', '连接更新服务…'],
      available: ['有新版本啦', '下载时可以继续聊天；安装时需要短暂退出，完成后会自动回来。', '准备下载', '下载时间取决于网络'],
      current: ['已经是最新版本啦', '暂时不用更新，可以继续使用碧琪。', '检查完成', ''],
      download: ['更新包正在路上', '下载时可以继续聊天，安装时需要短暂退出，完成后会自动回来。', '正在下载', ''],
      verify: ['下载好了，正在检查', '正在核对更新包是否完整，请稍等片刻。', '正在校验', '确认文件完整后就可以安装'],
      ready: ['准备好了', '下载和校验已经完成，可以开始安装。', '校验完成', '安装时碧琪会暂时退出'],
      install: ['正在准备安装', '碧琪要暂时离开一会儿，安装结束后会自动回来。', '正在启动安装', '请保持电脑开机'],
      error: ['这次没更新成功', '网络或更新服务可能开了个小差，可以重试或手动下载安装包。', '更新没有完成', '已经下载的内容会尽量保留']
    }[s] || [];
    if (s === 'available' && state.info?.unchangedCheckout) {
      details[0] = '源码没有新提交';
      details[1] = '当前应用的构建版本无法确认。你仍然可以重新准备并安装。';
    }
    if (s === 'error' && state.errorMessage) details[1] = state.errorMessage;
    root.querySelector('#pinkie-upd-title').textContent = details[0] || '';
    root.querySelector('#pinkie-upd-intro').textContent = details[1] || '';
    root.querySelector('.pinkie-upd__version').textContent = state.info?.version ? `新版本 ${state.info.version}` : '';
    let index = stages.indexOf(s); if (s === 'available' || s === 'current') index = 0; if (s === 'ready') index = 2; if (s === 'error') index = state.errorAt || 0;
    root.querySelectorAll('.pinkie-upd__steps li').forEach((el, i) => { el.classList.toggle('done', i < index); el.classList.toggle('current', i === index); });
    let amount = details[2] || '', percent = '', left = details[3] || '', right = '', value = null;
    if (s === 'download' && validNumber(p.downloaded)) {
      const total = validNumber(p.total) && p.total > 0 && p.downloaded <= p.total ? p.total : null;
      amount = total ? `${size(p.downloaded)} / ${size(total)}` : `已下载 ${size(p.downloaded)}`;
      if (total) { value = Math.min(100, p.downloaded / total * 100); percent = `${Math.floor(value)}%`; }
      left = validNumber(p.bytesPerSecond) && p.bytesPerSecond > 0 ? `下载速度 ${size(p.bytesPerSecond)}/s` : '正在下载';
      right = validNumber(p.etaSeconds) && total ? `预计还要 ${duration(p.etaSeconds)}` : (total ? '预计时间暂时无法计算' : '暂时拿不到文件总大小');
    }
    root.querySelector('.pinkie-upd__measure strong').textContent = amount;
    root.querySelector('.pinkie-upd__measure span').textContent = percent;
    const track = root.querySelector('.pinkie-upd__track');
    track.classList.toggle('is-indeterminate', ['check','download','verify','install'].includes(s) && value == null);
    track.setAttribute('aria-valuetext', amount);
    if (value == null) { track.removeAttribute('aria-valuenow'); track.firstElementChild.style.width = s === 'error' ? '0%' : ''; }
    else { track.setAttribute('aria-valuenow', String(Math.round(value))); track.firstElementChild.style.width = `${value}%`; }
    const detail = root.querySelectorAll('.pinkie-upd__detail span'); detail[0].textContent = left; detail[1].textContent = right;
    const notes = String(state.info?.notes || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0,5);
    const notesRoot = root.querySelector('.pinkie-upd__notes'); notesRoot.hidden = !notes.length;
    const list = notesRoot.querySelector('ul'); list.replaceChildren(...notes.map(note => { const li = document.createElement('li'); li.textContent = note; return li; }));
    root.querySelector('.pinkie-upd__manual').hidden = s !== 'error';
    const action = root.querySelector('.pinkie-upd__primary');
    action.textContent = ({available:'开始下载',ready:'安装并重启',error:'重新试试',current:'知道了',download:'后台下载',verify:'后台处理',check:'稍后再说',install:'正在安装'})[s] || '知道了';
    action.disabled = s === 'install';
    root.querySelector('.pinkie-upd__later').hidden = ['check','current','download','verify'].includes(s);
    root.querySelector('.pinkie-upd__close').disabled = s === 'install';
  }
  async function check() {
    if (state.busy) return;
    state.busy = true; state.stage = 'check'; state.progress = null; state.errorMessage = ''; paint();
    try {
      const info = await api().check_for_updates();
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
      const result = await api().prepare_update();
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
    if (event.stage === 'metadata') { state.info = {...state.info, version:event.version, notes:event.notes}; }
    else if (event.stage === 'download' && validNumber(event.downloaded)) { state.stage = 'download'; state.progress = event; }
    else if (event.stage === 'verify') state.stage = 'verify';
    else return;
    paint();
  };
  window.__pinkieUpdateDialog = { open(info) {
    if (!supported()) return false;
    mount();
    if (state.busy) { paint(); return true; }
    if (info?.available) { state.info = info; state.stage = 'available'; paint(); }
    else if (state.stage === 'ready') paint();
    else void check();
    return true;
  } };
})();
