(() => {
  const motion = window.PinkieMotion;
  const splash = document.getElementById('laolao-splash');
  const fill = document.getElementById('laolao-splash-fill');
  const message = document.getElementById('laolao-splash-message');
  const percentage = document.getElementById('laolao-splash-percentage');
  const bar = splash?.querySelector('[role="progressbar"]');
  if (!splash || !fill || !message || !percentage) return;
  const url = new URL(window.location.href);
  const switching = url.searchParams.get('laolao-switch') === '1' || sessionStorage.getItem('laolao:skip-entry-splash') === '1';
  let handoff = null;
  try { handoff = JSON.parse(sessionStorage.getItem('laolao:mode-handoff') || 'null'); } catch {}
  sessionStorage.removeItem('laolao:skip-entry-splash');
  sessionStorage.removeItem('laolao:mode-handoff');
  if (url.searchParams.has('laolao-switch')) {
    url.searchParams.delete('laolao-switch');
    window.history.replaceState(window.history.state, '', url.href);
  }
  const ids = ['chat', 'project', 'thinking', 'unrestricted'];
  const session = url.searchParams.get('session') || '';
  const routed = session.startsWith('agent:main:') ? 'chat' : ids.find(id => session.startsWith(`agent:${id}:`));
  const selected = switching && ids.includes(handoff?.mode) ? handoff.mode : routed || localStorage.getItem('laolao:active-mode');
  const mode = ids.includes(selected) ? selected : 'chat';
  const details = {
    chat: { label: '唠嗑模式', address: '先生', waiting: '新聊天正在铺开彩带…', ready: '唠嗑小屋准备好啦！' },
    project: { label: '项目模式', address: '老板', waiting: '项目档案正在摊开…', ready: '项目工作台准备好啦！' },
    thinking: { label: '想法模式', address: '先生', waiting: '灵感房间正在亮灯…', ready: '想法小屋准备好啦！' },
    unrestricted: { label: '无限制模式', address: '先生', waiting: '彩虹力量正在接管房间…', ready: '彩虹力量准备好啦！' },
  }[mode];
  const initial = switching ? Math.max(68, Math.min(96, Number(handoff?.progress) || 68)) : 8;
  if (switching) {
    splash.classList.add('is-mode-progress', `is-mode-progress--${mode}`);
    splash.style.setProperty('--laolao-mode-progress-image', `url("/laolao-mode-transition-${mode}.png?v=transition2")`);
    motion.text(splash.querySelector('.laolao-splash__eyebrow'), '碧琪的模式切换');
    motion.text(splash.querySelector('.laolao-splash__title'), details.label);
  }
  // Decode both scene and destination wallpaper. Missing decorative files
  // settle too, so a failed image can never hold the user behind this screen.
  let assetsReady = false;
  Promise.all([motion.modeAssets(mode), motion.preload(switching
    ? `/laolao-mode-transition-${mode}.png?v=transition2` : '/laolao-splash.png')])
    .then(() => { assetsReady = true; splash.classList.add('is-art-ready'); });
  const started = performance.now();
  const minimum = motion.reduced() ? 400 : switching ? 700 : 2600;
  let completed = false;
  const setProgress = (value, phrase) => {
    motion.progress(fill, percentage, bar, value);
    motion.text(message, phrase);
  };
  const ready = motion.stable(() => {
    if (!assetsReady || !document.querySelector('openclaw-app .shell')) return false;
    if (switching || document.querySelector('.agent-chat__input')) return motion.chatReady(mode);
    // Non-chat pages may be opened directly. Wait for actual page content too.
    return Boolean(document.querySelector('.content > :not(:empty)')) && !document.querySelector('.login-gate, .chat-loading-skeleton');
  }, 300);
  const loginReady = motion.stable(() => Boolean(document.querySelector('.login-gate__form')), 1800);
  const leave = async (success = true) => {
    if (completed) return;
    completed = true;
    if (success) {
      motion.text(message, switching ? details.ready : `${details.address}，门要开啦！`);
      await motion.finishProgress(fill, percentage, bar);
    }
    window.setTimeout(() => {
      if (success) motion.enter();
      splash.classList.add('is-leaving');
      window.setTimeout(() => splash.remove(), motion.reduced() ? 0 : 560);
    }, success && !motion.reduced() ? 160 : 0);
  };
  const phrases = [
    `${details.address}稍等，碧琪在给气球打气…`, '卷胡子扶正中，千万别让它跑掉！',
    '纸屑正在排队进场，乖一点点！', '派对大炮预热中，别眨眼！', '最后检查：惊喜有没有藏好？',
  ];
  const tick = () => {
    if (completed) return;
    const now = performance.now(), elapsed = now - started;
    const phrase = elapsed > 8000 ? `${details.address}，连接比平时慢，碧琪还在等…`
      : switching ? details.waiting : phrases[Math.min(phrases.length - 1, Math.floor(elapsed / 560))];
    setProgress(Math.min(switching ? 96 : 94, initial + elapsed / (switching ? 92 : 28)), phrase);
    if (ready(now) && elapsed >= minimum) return leave();
    // Real login/errors stay usable, but transient login mounts during a
    // handoff should never flash between the two scenes.
    if ((loginReady(now) && elapsed >= 5000) || document.querySelector('#openclaw-mount-fallback:not([hidden])')) return leave(false);
    window.requestAnimationFrame(tick);
  };
  window.setTimeout(() => {
    if (completed) return;
    const actions = document.createElement('div');
    actions.className = 'laolao-splash__recovery';
    for (const [label, action] of [['重新连接', () => window.location.reload()], ['查看当前页面', () => leave(false)]]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.onclick = action; actions.append(button);
    }
    splash.querySelector('.laolao-splash__content').append(actions);
  }, 30000);
  setProgress(initial, switching ? details.waiting : phrases[0]);
  window.requestAnimationFrame(() => {
    fill.style.removeProperty('transition');
    window.requestAnimationFrame(tick);
  });
})();
