(() => {
  const motion = window.PinkieMotion;
  const splash = document.getElementById('laolao-splash');
  const fill = document.getElementById('laolao-splash-fill');
  const message = document.getElementById('laolao-splash-message');
  const percentage = document.getElementById('laolao-splash-percentage');
  const bar = splash?.querySelector('[role="progressbar"]');
  if (!splash || !fill || !message || !percentage) return;
  // The installer mounts this controller in the document head. Older bundles
  // also carried a second copy in the body fragment; make the controller
  // idempotent so a stale upgraded document can never create two timers or two
  // recovery button rows.
  if (splash.dataset.laolaoSplashController === '1') return;
  splash.dataset.laolaoSplashController = '1';
  const url = new URL(window.location.href);
  const docked = url.searchParams.get('laolao-dock') === '1';
  if (docked) {
    // The companion is opening inside an already-live native App. Do not
    // replay either entry animation over the work panel; keep only its own
    // independent mode/session route.
    url.searchParams.delete('laolao-dock');
    window.history.replaceState(window.history.state, '', url.href);
    splash.remove();
    window.dispatchEvent(new CustomEvent('laolao:splash-cleared', {
      detail: { docked: true },
    }));
    return;
  }
  const switching = url.searchParams.get('laolao-switch') === '1' || sessionStorage.getItem('laolao:skip-entry-splash') === '1';
  let handoff = null;
  try { handoff = JSON.parse(sessionStorage.getItem('laolao:mode-handoff') || 'null'); } catch {}
  sessionStorage.removeItem('laolao:skip-entry-splash');
  sessionStorage.removeItem('laolao:mode-handoff');
  if (url.searchParams.has('laolao-switch')) {
    url.searchParams.delete('laolao-switch');
    window.history.replaceState(window.history.state, '', url.href);
  }
  const ids = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];
  const session = url.searchParams.get('session') || '';
  const routed = session.startsWith('agent:main:') ? 'chat' : ids.find(id => session.startsWith(`agent:${id}:`));
  const selected = switching && ids.includes(handoff?.mode) ? handoff.mode : routed || localStorage.getItem('laolao:active-mode');
  const mode = ids.includes(selected) ? selected : 'chat';
  const details = {
    chat: { label: '唠嗑模式', address: '先生', waiting: '新聊天正在铺开彩带…', ready: '唠嗑小屋准备好啦！' },
    project: { label: '项目模式', address: '老板', waiting: '项目档案正在摊开…', ready: '项目工作台准备好啦！' },
    thinking: { label: '想法模式', address: '先生', waiting: '灵感房间正在亮灯…', ready: '想法小屋准备好啦！' },
    learning: { label: '学习模式', address: '先生', waiting: '学习小屋正在亮灯…', ready: '学习小屋准备好啦！' },
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
  let splashFx = null;
  let lastProgress = initial;
  let lastPhrase = switching ? details.waiting : '';
  let enteredThroughFx = false;
  const setProgress = (value, phrase) => {
    lastProgress = motion.progress(fill, percentage, bar, value);
    lastPhrase = phrase;
    motion.text(message, phrase);
    // 旧胶囊仍由 PinkieMotion 的 transform-only 写入；FX 只叠高光、白字
    // 和前端光点，所以未就绪、失败或关闭效果时完全回到原来路径。
    if (splashFx?.isReady) splashFx.progress(lastProgress, {message: phrase});
  };
  const clear = () => {
    splash.remove();
    window.dispatchEvent(new CustomEvent('laolao:splash-cleared', {
      detail: { mode, switching },
    }));
  };
  // 不让首帧为了 WebGL probe、下载或解码等一帧：等静态画面已画好，再进
  // 第一个空闲窗口。切换接续只有 700ms，若这时还没准备好就自然走静态离场。
  const startFxWhenIdle = () => {
    if (motion.reduced()) return;
    const launch = () => {
      if (completed || splashFx) return;
      try {
        const candidate = window.PinkieModeTransitionFx?.playSplash?.({
          host: splash,
          sceneId: switching ? mode : 'splash',
          initialProgress: lastProgress,
          onExit: () => {
            if (!enteredThroughFx) { enteredThroughFx = true; motion.enter(); }
          },
        });
        if (!candidate) return;
        splashFx = candidate;
        candidate.ready.then(() => {
          if (completed) { candidate.abort?.(); return; }
          candidate.progress(lastProgress, {message: lastPhrase});
        }).catch(() => {
          if (splashFx === candidate) splashFx = null;
        });
      } catch {}
    };
    window.requestAnimationFrame(() => {
      if (completed) return;
      // 接续画面本身只有 700ms 的最短停留：等到 idle timeout 再创建 WebGL，
      // 本地素材即使很快也可能赶不上。静态首帧已经提交后，下一轮任务马上接管；
      // 冷启动仍只在空闲窗口初始化，绝不阻塞第一帧。
      if (switching) window.setTimeout(launch, 0);
      else if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(launch, {timeout: 450});
      else window.setTimeout(launch, 70);
    });
  };
  const ready = motion.stable(() => {
    // 2026.9.x exposes the mounted surface as <openclaw-app-shell>; the old
    // `openclaw-app .shell` selector no longer matches and left the splash at
    // 94% forever even though the gateway and composer were ready.
    if (!assetsReady || !document.querySelector('openclaw-app-shell, openclaw-app .shell')) return false;
    const chatSurface = switching || /\/chat(?:\/|$)/.test(url.pathname) ||
      url.searchParams.has('session') || document.querySelector('.agent-chat__input');
    if (chatSurface) {
      // On a cold start the URL may still be `/` while the gateway restores
      // the last-used agent. Follow that mounted mode instead of pinning the
      // splash to the stale localStorage value captured before restoration.
      const mountedMode = document.documentElement.getAttribute('data-laolao-mode');
      const readyMode = !switching && ids.includes(mountedMode) ? mountedMode : mode;
      if (motion.chatReady(readyMode)) return true;
      // A long transcript, compaction checkpoint, or an upstream render
      // change can make the sidebar arrive before the composer. The page is
      // already usable in that state, so never keep the entire App hidden
      // merely because one narrow composer selector has not appeared yet.
      return Boolean(document.querySelector(
        '.sidebar-brand, .sidebar-recent-sessions, .dashboard-header, .agent-chat'
      )) && !document.querySelector('.login-gate, .chat-loading-skeleton');
    }
    // Non-chat pages may be opened directly. Wait for actual page content too.
    return Boolean(document.querySelector('.content > :not(:empty)')) && !document.querySelector('.login-gate, .chat-loading-skeleton');
  }, 300);
  const loginReady = motion.stable(() => Boolean(document.querySelector('.login-gate__form')), 1800);
  const leave = async (success = true) => {
    if (completed) return;
    completed = true;
    if (success) {
      motion.text(message, switching ? details.ready : `${details.address}，门要开啦！`);
      const finalPhrase = switching ? details.ready : `${details.address}，门要开啦！`;
      if (splashFx?.isReady) {
        const activeFx = splashFx;
        // 胶囊走满、完成光和 460ms 冲刺共用同一段约 900ms 离场时钟。
        // 先让 runner 记住完成点，但保留旧 transform-only 填充到 100%。
        activeFx.finish({keepProgress: true}).then(() => {
          if (!enteredThroughFx) { enteredThroughFx = true; motion.enter(); }
          clear();
        });
        await motion.finishProgress(fill, percentage, bar);
        activeFx.progress(100, {message: finalPhrase, done: true});
        return;
      }
      await motion.finishProgress(fill, percentage, bar);
    }
    splashFx?.abort?.();
    window.setTimeout(() => {
      if (success) motion.enter();
      splash.classList.add('is-leaving');
      window.setTimeout(() => {
        clear();
      }, motion.reduced() ? 0 : 560);
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
    // The shell is mounted but a future upstream DOM may not match one of the
    // readiness selectors above. Reveal the real page instead of leaving an
    // apparently dead loading screen over it forever.
    if (elapsed >= 6500 && document.querySelector('openclaw-app-shell, openclaw-app .shell')) return leave(false);
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
  startFxWhenIdle();
  window.requestAnimationFrame(() => {
    fill.style.removeProperty('transition');
    window.requestAnimationFrame(tick);
  });
})();
