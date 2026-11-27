(() => {
  'use strict';
  if (window.__pinkieMetreLock) return;
  const zh = (error, fallback) => { const raw = String(error?.message ?? error ?? ''); globalThis.console?.warn?.('[pinkie-metre-lock]', error); return /[㐀-鿿]/.test(raw) && !/[A-Za-z]{3,}\s+[A-Za-z]{3,}|\n\s+at\s|[{}]|undefined|\[object/.test(raw) ? raw : fallback; }; // P4：英文原文 / 堆栈 / JSON / undefined / [object Object] 不上界面，原文进日志
  const ACTIVE_MODE_KEY = 'laolao:active-mode';
  let cachedStatus = null;
  let activePrompt = null;
  let dockCurtain = null;
  let enforcingExit = false;

  const rpc = (method, params, timeout = 10_000) => {
    const fn = window.__laolaoSidebar?.gwRequest;
    return typeof fn === 'function' ? fn(method, params, timeout) : Promise.reject(new Error('还没有连上后台服务'));
  };

  const isDocked = () => {
    try {
      if (document.documentElement.getAttribute('data-laolao-workspace-dock') === '1') return true;
      return new URLSearchParams(location.search).get('laolao-dock') === '1';
    } catch {
      return false;
    }
  };

  const closeDock = () => {
    try {
      const mac = window.webkit?.messageHandlers?.laolaoWorkspaceDock;
      if (mac?.postMessage) { mac.postMessage({action: 'close'}); return; }
      window.pywebview?.api?.close_workspace_dock?.();
    } catch {}
  };

  const isMetreContext = () => {
    try {
      if (document.documentElement.getAttribute('data-laolao-mode') === 'metre') return true;
      if (document.documentElement.getAttribute('data-laolao-mode-pending') === 'metre') return true;
      const session = new URLSearchParams(location.search).get('session') || '';
      if (/^agent:metre(?::|$)/i.test(session)) return true;
      if (localStorage.getItem(ACTIVE_MODE_KEY) === 'metre' && !session) return true;
    } catch {}
    return false;
  };

  const formatWait = (ms) => {
    const totalSec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) return `${hours} 小时 ${minutes} 分 ${seconds} 秒`;
    if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
    return `${seconds} 秒`;
  };

  const emitChange = (status) => {
    cachedStatus = status;
    window.dispatchEvent(new CustomEvent('pinkie:metre-lock-change', {detail: status}));
  };

  async function fetchStatus(force = false) {
    if (!force && cachedStatus) return cachedStatus;
    try {
      const res = await rpc('pinkie.guard.metreStatus', {}, 8_000);
      if (res && typeof res.locked === 'boolean') {
        cachedStatus = res;
        return res;
      }
    } catch {}
    // 连不上时若已知上次是正式版或尚未连上，宁可保守报错，不放行解锁框绕过。
    throw new Error('还没连上后台服务，请稍后再试');
  }

  function exitMetreToChat() {
    if (enforcingExit) return;
    enforcingExit = true;
    try {
      try { localStorage.setItem(ACTIVE_MODE_KEY, 'chat'); } catch {}
      try { window.__pinkieMetreBoard?.close?.(); } catch {}
      document.documentElement.setAttribute('data-laolao-mode', 'chat');
      document.documentElement.removeAttribute('data-laolao-mode-pending');
      document.documentElement.removeAttribute('data-laolao-splash-metre');
      const next = new URL(location.href);
      const currentSession = next.searchParams.get('session') || '';
      const onSettingsRoute = String(next.pathname || '').startsWith('/settings');
      const hasMetreSession = /^agent:metre(?::|$)/i.test(currentSession);
      if (hasMetreSession || (!onSettingsRoute && !currentSession)) {
        next.searchParams.set('session', 'agent:main:main');
        const shell = document.querySelector('openclaw-app-shell');
        if (typeof shell?.navigate === 'function') shell.navigate('chat', {search: next.search});
        else if (typeof shell?.context?.navigate === 'function') shell.context.navigate('chat', {search: next.search});
        else {
          history.replaceState(history.state, '', `${next.pathname}${next.search}${next.hash}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }
      window.dispatchEvent(new CustomEvent('laolao:modechange', {detail: {mode: 'chat'}}));
    } finally {
      window.setTimeout(() => { enforcingExit = false; }, 120);
    }
  }

  function buildLockCard({initialStatus, cancelLabel, onCancel, onUnlocked}) {
    const dialog = document.createElement('div');
    dialog.className = 'laolao-metre-lock-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'laolao-metre-lock-title');

    const title = document.createElement('h2');
    title.id = 'laolao-metre-lock-title';
    title.className = 'laolao-metre-lock-dialog__title';
    title.textContent = '输入开发者密码解锁 Metre';

    const desc = document.createElement('p');
    desc.className = 'laolao-metre-lock-dialog__desc';
    desc.textContent = '正式版里 Metre 默认锁定。输入开发者密码后，这台电脑会记住解锁状态。';

    const form = document.createElement('form');
    form.className = 'laolao-metre-lock-dialog__form';

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'laolao-metre-lock-dialog__input';
    input.autocomplete = 'current-password';
    input.placeholder = '输入开发者密码';
    input.setAttribute('aria-label', '开发者密码');

    const errorEl = document.createElement('p');
    errorEl.className = 'laolao-metre-lock-dialog__error';
    errorEl.setAttribute('role', 'status');
    errorEl.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'laolao-metre-lock-dialog__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'laolao-metre-lock-dialog__btn';
    cancelBtn.textContent = cancelLabel || '取消';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'laolao-metre-lock-dialog__btn laolao-metre-lock-dialog__btn--primary';
    submitBtn.textContent = '解锁';

    actions.append(cancelBtn, submitBtn);
    form.append(input, errorEl, actions);
    dialog.append(title, desc, form);

    let cooldownTimer = 0;
    let lockedUntil = Number(initialStatus?.lockedUntil || 0);
    let busy = false;
    const configured = initialStatus?.configured !== false;

    const stopTimer = () => {
      if (cooldownTimer) { window.clearInterval(cooldownTimer); cooldownTimer = 0; }
    };

    const syncState = () => {
      const remainingMs = lockedUntil > Date.now() ? lockedUntil - Date.now() : 0;
      if (!configured) {
        input.disabled = true;
        submitBtn.disabled = true;
        errorEl.textContent = '当前正式版还没有设置开发者密码，暂时无法解锁。';
        stopTimer();
        return;
      }
      if (remainingMs > 0) {
        input.disabled = true;
        submitBtn.disabled = true;
        errorEl.textContent = `输错次数过多，请等 ${formatWait(remainingMs)} 后再试。`;
        if (!cooldownTimer) {
          cooldownTimer = window.setInterval(syncState, 1000);
        }
        return;
      }
      stopTimer();
      input.disabled = busy;
      submitBtn.disabled = busy;
      if (/输错次数过多，请等/.test(errorEl.textContent)) errorEl.textContent = '';
    };

    cancelBtn.addEventListener('click', () => { stopTimer(); onCancel(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !configured || lockedUntil > Date.now()) return;
      const password = input.value;
      if (!password) {
        errorEl.textContent = '请输入开发者密码。';
        input.focus();
        return;
      }
      busy = true;
      submitBtn.textContent = '验证中…';
      syncState();
      try {
        const res = await rpc('pinkie.guard.metreUnlock', {password}, 15_000);
        if (res?.ok === true) {
          stopTimer();
          emitChange(res);
          onUnlocked(res);
          return;
        }
        if (res && typeof res.locked === 'boolean') emitChange(res);
        lockedUntil = Number(res?.lockedUntil || 0);
        if (res?.code === 'COOLDOWN' || lockedUntil > Date.now()) {
          syncState();
        } else if (res?.code === 'NOT_CONFIGURED') {
          errorEl.textContent = res.error || '当前正式版还没有设置开发者密码。';
        } else {
          const left = Number(res?.remainingAttempts);
          const suffix = Number.isFinite(left) && left > 0 ? `（连续错 5 次需等待 10 分钟，还剩 ${left} 次）` : '';
          errorEl.textContent = `${res?.error || '开发者密码不正确。'}${suffix}`;
        }
        input.value = '';
      } catch (err) {
        errorEl.textContent = zh(err, '验证失败，请再试一次。');
      } finally {
        busy = false;
        submitBtn.textContent = '解锁';
        syncState();
        if (!input.disabled) input.focus();
      }
    });

    syncState();
    return {dialog, input, stopTimer};
  }

  function showPrompt(initialStatus) {
    if (activePrompt) return activePrompt.promise;
    let settled = false;
    let finishPrompt = () => {};
    const promise = new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'laolao-metre-lock-backdrop';
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        card.stopTimer();
        backdrop.remove();
        activePrompt = null;
        resolve(ok);
      };
      finishPrompt = finish;
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      };
      const card = buildLockCard({
        initialStatus,
        cancelLabel: '取消',
        onCancel: () => finish(false),
        onUnlocked: () => finish(true),
      });
      backdrop.addEventListener('pointerdown', (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.addEventListener('keydown', onKeyDown, true);
      backdrop.append(card.dialog);
      document.body.append(backdrop);
      window.requestAnimationFrame(() => { if (!card.input.disabled) card.input.focus(); });
    });
    if (!settled) activePrompt = {promise, finish: finishPrompt};
    return promise;
  }

  function showDockCurtain(initialStatus) {
    if (dockCurtain) return;
    const curtain = document.createElement('div');
    curtain.className = 'laolao-metre-lock-curtain';
    const card = buildLockCard({
      initialStatus,
      cancelLabel: '关闭分屏',
      onCancel: () => { closeDock(); },
      onUnlocked: () => { removeDockCurtain(); },
    });
    curtain.append(card.dialog);
    document.body.append(curtain);
    dockCurtain = {curtain, stopTimer: card.stopTimer};
    window.requestAnimationFrame(() => { if (!card.input.disabled) card.input.focus(); });
  }

  function removeDockCurtain() {
    if (!dockCurtain) return;
    dockCurtain.stopTimer();
    dockCurtain.curtain.remove();
    dockCurtain = null;
  }

  async function ensureUnlocked() {
    let status;
    try {
      status = await fetchStatus(true);
    } catch (err) {
      window.__laolaoToast?.(zh(err, '还没连上后台服务，暂时打不开 Metre'));
      return false;
    }
    if (!status.required || status.unlocked) return true;
    return showPrompt(status);
  }

  async function lock() {
    const res = await rpc('pinkie.guard.metreLock', {}, 8_000);
    if (res && typeof res.locked === 'boolean') emitChange(res);
    handleLockedMetreContext(res);
    return res;
  }

  function handleLockedMetreContext(status) {
    if (!status?.locked || !isMetreContext()) return;
    if (isDocked()) showDockCurtain(status);
    else exitMetreToChat();
  }

  async function enforcePageLock() {
    try {
      const status = await fetchStatus(true);
      emitChange(status);
      if (!status.locked) {
        removeDockCurtain();
        return;
      }
      handleLockedMetreContext(status);
    } catch {}
  }

  // 页面刚启动时网关可能还在重连：连上后查一次，避免之前停在 Metre 时直接漏进去。
  let startupChecked = false;
  let startupInFlight = false;
  const checkOnceOnReady = () => {
    if (startupChecked || startupInFlight) return;
    if (typeof window.__laolaoSidebar?.gwRequest !== 'function') {
      if (isMetreContext()) window.setTimeout(checkOnceOnReady, 500);
      return;
    }
    startupInFlight = true;
    void fetchStatus(true).then((status) => {
      startupChecked = true;
      emitChange(status);
      handleLockedMetreContext(status);
    }).catch(() => {
      if (isMetreContext()) window.setTimeout(checkOnceOnReady, 800);
    }).finally(() => {
      startupInFlight = false;
    });
  };
  window.addEventListener('pinkie:sidebar-gateway-ready', checkOnceOnReady);
  window.addEventListener('pinkie:gateway-event', checkOnceOnReady);
  window.addEventListener('laolao:splash-cleared', () => {
    if (!startupChecked) checkOnceOnReady();
    else handleLockedMetreContext(cachedStatus);
  });
  window.addEventListener('laolao:modechange', (event) => {
    if (event.detail?.mode !== 'metre') return;
    if (cachedStatus) handleLockedMetreContext(cachedStatus);
    else void enforcePageLock();
  });
  window.addEventListener('popstate', () => {
    if (!isMetreContext()) return;
    if (cachedStatus) handleLockedMetreContext(cachedStatus);
    else void enforcePageLock();
  });
  window.addEventListener('focus', () => {
    if (isMetreContext()) void enforcePageLock();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkOnceOnReady, {once: true});
  else window.setTimeout(checkOnceOnReady, 200);

  window.__pinkieMetreLock = {
    status: fetchStatus,
    ensureUnlocked,
    lock,
    enforcePageLock,
    isKnownLocked: () => Boolean(cachedStatus?.locked),
    cachedStatus: () => cachedStatus,
  };
})();
