/* 帮碧琪变好：首次启动询问（仅正式版） + 设置页开关 / 预览将要上传的内容 / 删除本地待传记录 */
(() => {
  'use strict';
  if (window.__pinkieFeedback) return;

  const S = 'pinkie-user-settings__';
  const node = (tag, className, text, parent) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (parent) parent.append(el);
    return el;
  };
  const setText = (el, value) => {
    if (el) el.textContent = value == null ? '' : String(value);
  };
  const rpc = () => window.__laolaoSidebar?.gwRequest;
  const request = (method, params = {}, timeout = 12000) => {
    const fn = rpc();
    return typeof fn === 'function'
      ? fn(method, params, timeout)
      : Promise.reject(new Error('暂时没有连上碧琪，稍后再试。'));
  };
  const formatTime = (ms) => {
    if (!ms) return '';
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  const isDocked = () => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('laolao-dock') === '1'
        || document.documentElement?.getAttribute?.('data-laolao-workspace-dock') === '1';
    } catch {
      return false;
    }
  };

  const state = {
    card: null,
    hint: null,
    toggleTitle: null,
    toggleHint: null,
    toggleBtn: null,
    countText: null,
    uploadText: null,
    previewBtn: null,
    clearBtn: null,
    statusLine: null,
    lastStatus: null,
    busy: false,
    onboardingShown: false,
    onboardingPromise: null,
    activeModal: null,
  };

  function closeModal() {
    if (!state.activeModal) return;
    const modal = state.activeModal;
    state.activeModal = null;
    if (typeof modal.remove === 'function') modal.remove();
    else if (modal.parentNode) modal.parentNode.removeChild(modal);
  }

  function renderCard(data) {
    if (!state.card || !data) return;
    state.lastStatus = data;
    const isRelease = data.isRelease === true;
    const active = isRelease ? data.consent === true : data.localDebug === true;

    setText(state.hint, isRelease
      ? '默认关闭。开启后，只会在本地脱敏并加密后上报使用模式、任务类型、工具和纠错分类摘要，绝不上传聊天原文、文件内容、用户名或密钥。'
      : '当前是开发版，绝不会联网上传任何内容；可以开启「只写本机」，把脱敏摘要留在本机队列里方便调试。');
    setText(state.toggleTitle, isRelease ? '帮碧琪变好（上传脱敏摘要）' : '只写本机（开发调试，不上传）');
    setText(state.toggleHint, isRelease
      ? (active ? '已开启：定期将脱敏加密摘要上传给作者。' : '已关闭：不记录、不上传任何反馈。')
      : (active ? '已开启：摘要只写进本机队列，不会联网发送。' : '已关闭：不写本机队列，也不会上传。'));

    state.toggleBtn.setAttribute('aria-checked', active ? 'true' : 'false');
    state.toggleBtn.disabled = state.busy;

    const count = Number(data.queueCount) || 0;
    setText(state.countText, `本机待传记录：${count} 条`);
    if (isRelease) {
      const uploaded = Number(data.uploadedCount) || 0;
      const lastStr = data.lastUploadAt ? ` · 最近上报 ${formatTime(data.lastUploadAt)}` : '';
      setText(state.uploadText, `累计已上报：${uploaded} 条${lastStr}`);
    } else {
      setText(state.uploadText, '开发版仅限本机查看，不上报');
    }

    state.clearBtn.disabled = state.busy || count === 0;
    if (data.lastErrorCode && isRelease && active) {
      const reason = data.lastErrorCode === 'offline' || data.lastErrorCode === 'timeout'
        ? '网络暂时不通，记录已先留在本机，下次联网会再试。'
        : data.lastErrorCode === 'auth' || data.lastErrorCode === 'not_found'
          ? '当前版本暂时无法投递到反馈仓库，记录已安全留在本机，不影响正常使用。'
          : '本次上报暂时延后，记录已留在本机。';
      setText(state.statusLine, reason);
      state.statusLine.dataset.state = '';
    }
  }

  async function refresh() {
    if (!state.card || typeof rpc() !== 'function') return null;
    try {
      const data = await request('pinkie.feedback.status', {}, 8000);
      if (data?.ok) renderCard(data);
      return data;
    } catch {
      return null;
    }
  }

  async function toggleSwitch() {
    if (state.busy) return;
    const current = state.lastStatus || await refresh();
    if (!current) {
      setText(state.statusLine, '暂时没有连上碧琪，请稍后再试。');
      state.statusLine.dataset.state = 'error';
      return;
    }
    state.busy = true;
    state.toggleBtn.disabled = true;
    setText(state.statusLine, '正在保存…');
    state.statusLine.dataset.state = 'busy';
    try {
      const nextParams = current.isRelease
        ? {consent: !(current.consent === true), asked: true}
        : {localDebug: !(current.localDebug === true)};
      const updated = await request('pinkie.feedback.setPrefs', nextParams, 8000);
      renderCard(updated);
      const turnedOn = updated.isRelease ? updated.consent : updated.localDebug;
      setText(state.statusLine, turnedOn
        ? (updated.isRelease ? '已开启改进摘要，感谢帮忙。' : '已开启本机调试记录（不会上传）。')
        : '已关闭。');
      state.statusLine.dataset.state = 'success';
    } catch (error) {
      setText(state.statusLine, error?.message || '保存失败，请重试。');
      state.statusLine.dataset.state = 'error';
    } finally {
      state.busy = false;
      if (state.lastStatus) renderCard(state.lastStatus);
    }
  }

  async function openPreview() {
    closeModal();
    let payload = null;
    try {
      payload = await request('pinkie.feedback.preview', {}, 8000);
    } catch (error) {
      setText(state.statusLine, error?.message || '暂时读不到待传记录。');
      state.statusLine.dataset.state = 'error';
      return;
    }

    const backdrop = node('div', 'pinkie-feedback-modal-backdrop');
    const dialog = node('section', 'pinkie-feedback-modal pinkie-feedback-modal--wide', null, backdrop);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pinkie-feedback-preview-title');

    const head = node('div', 'pinkie-feedback-modal__head', null, dialog);
    const title = node('h3', 'pinkie-feedback-modal__title', '看看会上传什么', head);
    title.id = 'pinkie-feedback-preview-title';
    const closeBtn = node('button', 'pinkie-feedback-modal__close', '×', head);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '关闭预览');
    closeBtn.addEventListener('click', closeModal);

    const hasItems = Array.isArray(payload?.items) && payload.items.length > 0;
    const summaryText = hasItems
      ? `本机队列里目前有 ${payload.count} 条待传摘要（下面按最新顺序展示）：`
      : '本机目前还没有待传记录。下面是开启后每条记录的真实格式示例：';
    node('p', 'pinkie-feedback-modal__copy', summaryText, dialog);
    node('p', 'pinkie-feedback-modal__note', '正式版上传前会在本机用作者公钥加密，仓库里看到的只是密文；里面不包含聊天原文、文件内容、路径用户名或密钥。', dialog);

    const shown = hasItems ? payload.items : [payload?.sample || {}];
    node('pre', 'pinkie-feedback-modal__pre', JSON.stringify(shown, null, 2), dialog);

    const footer = node('div', 'pinkie-feedback-modal__footer', null, dialog);
    const okBtn = node('button', 'pinkie-feedback-modal__btn', '知道了', footer);
    okBtn.type = 'button';
    okBtn.addEventListener('click', closeModal);

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal();
    });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });

    document.body.append(backdrop);
    state.activeModal = backdrop;
    okBtn.focus?.();
  }

  async function clearPending() {
    if (state.busy) return;
    state.busy = true;
    state.clearBtn.disabled = true;
    setText(state.statusLine, '正在删除本机待传记录…');
    state.statusLine.dataset.state = 'busy';
    try {
      const result = await request('pinkie.feedback.clear', {}, 8000);
      if (result?.status) renderCard(result.status);
      const n = Number(result?.cleared) || 0;
      setText(state.statusLine, n > 0 ? `已删除 ${n} 条本机还没上传的记录。` : '本机没有待传记录。');
      state.statusLine.dataset.state = 'success';
    } catch (error) {
      setText(state.statusLine, error?.message || '删除失败，请重试。');
      state.statusLine.dataset.state = 'error';
    } finally {
      state.busy = false;
      if (state.lastStatus) renderCard(state.lastStatus);
    }
  }

  function mount(target) {
    if (!target || target.querySelector('#pinkie-feedback-card')) return state.card;
    const card = node('section', `${S}card`);
    card.id = 'pinkie-feedback-card';

    const header = node('header', `${S}card-header`, null, card);
    const icon = node('span', `${S}icon`, '💌', header);
    icon.setAttribute('aria-hidden', 'true');
    node('h3', `${S}card-title`, '帮碧琪变好', header);

    state.hint = node('p', `${S}card-hint`, '读取中…', card);

    const toggleRow = node('div', `${S}row`, null, card);
    const toggleCopy = node('div', `${S}row-copy`, null, toggleRow);
    state.toggleTitle = node('span', `${S}row-title`, '改进摘要上报', toggleCopy);
    state.toggleHint = node('span', `${S}hint`, '默认关闭', toggleCopy);
    const toggleControl = node('div', `${S}row-control`, null, toggleRow);
    state.toggleBtn = node('button', `${S}switch`, null, toggleControl);
    state.toggleBtn.type = 'button';
    state.toggleBtn.setAttribute('role', 'switch');
    state.toggleBtn.setAttribute('aria-checked', 'false');
    state.toggleBtn.setAttribute('aria-label', '帮碧琪变好开关');
    node('span', `${S}switch-knob`, null, state.toggleBtn);
    state.toggleBtn.addEventListener('click', () => { void toggleSwitch(); });

    const dataRow = node('div', `${S}row`, null, card);
    const dataCopy = node('div', `${S}row-copy`, null, dataRow);
    node('span', `${S}row-title`, '本机待传记录', dataCopy);
    const meta = node('div', 'pinkie-feedback-card__meta', null, dataCopy);
    state.countText = node('span', '', '读取中…', meta);
    state.uploadText = node('span', '', '', meta);

    const dataActions = node('div', `${S}row-control ${S}actions`, null, dataRow);
    state.previewBtn = node('button', `${S}button`, '看看会上传什么', dataActions);
    state.previewBtn.type = 'button';
    state.previewBtn.addEventListener('click', () => { void openPreview(); });

    state.clearBtn = node('button', `${S}text-button`, '删除本机还没上传的记录', dataActions);
    state.clearBtn.type = 'button';
    state.clearBtn.addEventListener('click', () => { void clearPending(); });

    state.statusLine = node('p', `${S}status`, '', card);
    state.statusLine.setAttribute('aria-live', 'polite');

    const footer = target.querySelector(`.${S}footer`);
    if (footer) footer.before(card);
    else target.append(card);
    state.card = card;
    void refresh();
    return card;
  }

  function showOnboardingModal() {
    if (state.onboardingShown || state.activeModal) return null;
    state.onboardingShown = true;
    closeModal();

    const backdrop = node('div', 'pinkie-feedback-modal-backdrop');
    backdrop.id = 'pinkie-feedback-onboarding';
    const dialog = node('section', 'pinkie-feedback-modal', null, backdrop);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pinkie-feedback-ask-title');

    const head = node('div', 'pinkie-feedback-modal__head', null, dialog);
    const title = node('h2', 'pinkie-feedback-modal__title', '愿意帮碧琪变好吗？', head);
    title.id = 'pinkie-feedback-ask-title';
    const closeBtn = node('button', 'pinkie-feedback-modal__close', '×', head);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '暂不开启并关闭');

    node('p', 'pinkie-feedback-modal__copy',
      '只上传使用情况的摘要，不上传聊天内容。开启后，只会在本地脱敏并加密后发送你常用的模式、任务类型、用到的工具、是否成功，以及你纠正过的问题分类。',
      dialog);
    node('p', 'pinkie-feedback-modal__note',
      '绝不上传聊天原文、文件内容、文件路径里的用户名、网址参数、称呼或密钥。之后随时可以在「设置 → 帮碧琪变好」里开关、查看待传内容或删除记录。',
      dialog);

    const actions = node('div', 'pinkie-feedback-modal__equal-actions', null, dialog);
    const declineBtn = node('button', 'pinkie-feedback-modal__equal-btn', '暂不开启', actions);
    declineBtn.type = 'button';
    declineBtn.dataset.choice = 'decline';
    const acceptBtn = node('button', 'pinkie-feedback-modal__equal-btn', '愿意帮忙', actions);
    acceptBtn.type = 'button';
    acceptBtn.dataset.choice = 'accept';

    const choose = async (consent) => {
      declineBtn.disabled = true;
      acceptBtn.disabled = true;
      closeBtn.disabled = true;
      try {
        const updated = await request('pinkie.feedback.setPrefs', {consent: Boolean(consent), asked: true}, 8000);
        if (updated?.ok) renderCard(updated);
      } catch {}
      closeModal();
    };

    declineBtn.addEventListener('click', () => { void choose(false); });
    acceptBtn.addEventListener('click', () => { void choose(true); });
    closeBtn.addEventListener('click', () => { void choose(false); });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') void choose(false);
    });

    document.body.append(backdrop);
    state.activeModal = backdrop;
    declineBtn.focus?.();
    return backdrop;
  }

  async function checkOnboarding() {
    if (state.onboardingShown || isDocked()) return false;
    if (state.onboardingPromise) return state.onboardingPromise;
    state.onboardingPromise = (async () => {
      if (typeof rpc() !== 'function') return false;
      try {
        const data = await request('pinkie.feedback.status', {}, 8000);
        if (!data?.ok) return false;
        if (state.card) renderCard(data);
        // 仅正式版且从未询问过时问一次；开发版不弹窗。
        if (data.isRelease === true && data.asked === false) {
          showOnboardingModal();
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        state.onboardingPromise = null;
      }
    })();
    return state.onboardingPromise;
  }

  function waitAndPromptOnboarding(attempt = 0) {
    if (state.onboardingShown || isDocked()) return;
    if (document.getElementById?.('laolao-splash')) {
      if (attempt < 40) window.setTimeout(() => waitAndPromptOnboarding(attempt + 1), 500);
      return;
    }
    if (typeof rpc() !== 'function') {
      if (attempt < 40) window.setTimeout(() => waitAndPromptOnboarding(attempt + 1), 500);
      return;
    }
    void checkOnboarding();
  }

  let wasSettingsVisible = false;
  function syncWhenSettingsOpens() {
    const settingsRoot = state.card?.closest?.('#laolao-user-settings');
    const visible = Boolean(settingsRoot && settingsRoot.hidden === false);
    if (visible && !wasSettingsVisible) void refresh();
    wasSettingsVisible = visible;
  }

  window.__pinkieFeedback = {
    mount,
    refresh,
    openPreview,
    clearPending,
    checkOnboarding,
    showOnboardingModal,
    closeModal,
  };

  window.addEventListener('pinkie:settings-ready', (event) => mount(event.detail));
  window.addEventListener('laolao:splash-cleared', () => waitAndPromptOnboarding(0), {once: true});

  const onReady = () => {
    const scroll = document.querySelector?.(`#laolao-user-settings .${S}scroll`);
    if (scroll) mount(scroll);
    waitAndPromptOnboarding(0);
    if (typeof window.setInterval === 'function') window.Pinkie?.domWatch?.poll(syncWhenSettingsOpens, 1200);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, {once: true});
  else onReady();
})();
