/* 打盹和自动减负 · 省下来的都是没人在看的那部分。
 *
 * 打盹（看不出差别）：
 *   窗口切到后台 20 秒，或者 5 分钟没人碰鼠标键盘 → "away"：
 *     聊天背景氛围那块画布停在当前这一帧（不消失，只是不再重画）。
 *   away 而且碧琪手上没活（上一轮结束也过了 30 秒）→ "rest"：
 *     小碧琪停在当前姿势，一直循环的装饰动画和循环视频暂停。
 *   鼠标、键盘、滚轮、窗口回到前台、碧琪开始干活，任何一样都立刻恢复。
 *   只暂停「无限循环」的动画；出现、消失这类有头有尾的动画照常播，不会有东西卡在半透明。
 *
 * 自动减负（只在真的卡的时候）：
 *   页面在前台、有人在用时量帧间隔。连续三个 5 秒窗口都在掉帧，才往下走一级；
 *   连续 60 秒不卡，往回升一级。只动「多顺、多细」（氛围帧率、画布清晰度、粒子数量），
 *   不拿掉任何画面元素。不读显卡、内存、核心数这类硬件信息：只看实际帧间隔。
 *   只在「标准」档、且用户没有手动改过那一项时生效；进阶调节里可以关掉。
 *
 * 对外：window.__pinkieRest = {away, rest, level, wake(), inspect()}
 *   事件 "pinkie:rest-change" {away, rest}，"pinkie:ease-change" {level}。
 * 画布脚本自己看 window.__pinkieRest.away / .rest 决定画不画（laolao-companion.js、laolao-buddy-rig.js）。 */
(() => {
  "use strict";
  if (window.__pinkieRest) return;
  const root = document.documentElement;
  const AWAY_BLUR_MS = 20000, AWAY_IDLE_MS = 300000, RUN_GRACE_MS = 30000, TICK_MS = 2000;
  const clock = () => performance.now();

  // ── 打盹 ────────────────────────────────────────────────────────────────
  let lastInput = clock();
  let blurredAt = document.hasFocus() ? 0 : clock();
  let wasRunning = false, runEndedAt = clock();
  let away = false, rest = false;
  const pausedAnimations = new Set(), pausedVideos = new Set();

  const running = () => root.hasAttribute("data-pinkie-running");
  const emit = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, {detail})); } catch {} };

  const loops = () => {
    if (typeof document.getAnimations !== "function") return [];
    return document.getAnimations().filter((animation) => {
      try { return animation.playState === "running" && animation.effect?.getComputedTiming?.().iterations === Infinity; }
      catch { return false; }
    });
  };
  const pauseLoops = () => {
    for (const animation of loops()) { try { animation.pause(); pausedAnimations.add(animation); } catch {} }
    for (const video of document.querySelectorAll("video")) {
      if (!video.loop || video.paused || video.ended) continue;
      try { video.pause(); pausedVideos.add(video); } catch {}
    }
  };
  const resumeLoops = () => {
    for (const animation of pausedAnimations) { try { if (animation.playState === "paused") animation.play(); } catch {} }
    pausedAnimations.clear();
    for (const video of pausedVideos) { try { if (video.isConnected && video.paused) video.play()?.catch?.(() => {}); } catch {} }
    pausedVideos.clear();
  };

  const apply = (nextAway, nextRest) => {
    if (nextAway === away && nextRest === rest) return;
    const restChanged = nextRest !== rest;
    away = nextAway; rest = nextRest;
    root.toggleAttribute("data-pinkie-away", away);
    root.toggleAttribute("data-pinkie-rest", rest);
    if (restChanged) { if (rest) pauseLoops(); else resumeLoops(); }
    emit("pinkie:rest-change", {away, rest});
  };
  const evaluate = () => {
    const t = clock(), run = running();
    if (wasRunning && !run) runEndedAt = t;
    wasRunning = run;
    const reduced = Boolean(window.__pinkieMotion?.reduce);
    const blurred = blurredAt && t - blurredAt >= AWAY_BLUR_MS;
    const idle = t - lastInput >= AWAY_IDLE_MS;
    // 启动动画和切换模式的转场是完整的一段演出，中途不打盹（App 在后台启动也要把它演完）。
    const staging = Boolean(document.getElementById("laolao-splash")) || root.hasAttribute("data-laolao-mode-pending");
    if (staging) runEndedAt = t;
    const nextAway = !document.hidden && !reduced && !staging && Boolean(blurred || idle);
    const nextRest = nextAway && !run && t - runEndedAt >= RUN_GRACE_MS;
    apply(nextAway, nextRest);
    // 打盹期间新出现的循环动画（比如晚到的一张卡片）也一起停下。
    if (rest) pauseLoops();
  };
  const wake = () => {
    lastInput = clock();
    if (document.hasFocus()) blurredAt = 0;
    if (away || rest) apply(false, false);
  };

  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(type, wake, {passive: true, capture: true});
  }
  window.addEventListener("focus", () => { blurredAt = 0; wake(); });
  window.addEventListener("blur", () => { blurredAt = clock(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); else apply(false, false); });
  // 碧琪开始干活：小碧琪和状态动画要动起来，哪怕窗口还在后台。
  new MutationObserver(evaluate).observe(root, {attributes: true, attributeFilter: ["data-pinkie-running"]});
  setInterval(evaluate, TICK_MS);

  // ── 自动减负 ────────────────────────────────────────────────────────────
  // 每一级只比上一级多省一点；都是进阶调节里本来就有的选项，所以和手动选「省着用」是同一套画面。
  const LADDER = [
    {},
    {"effects.ambientFps": 20, "render.pixelRatio": "low"},
    {"effects.ambientFps": 20, "render.pixelRatio": "low", "effects.particles": 0.5},
  ];
  const WINDOW_MS = 5000, BAD_WINDOWS = 3, CALM_MS = 60000;
  let level = 0, badStreak = 0, calmSince = clock(), told = false;
  let windowStart = 0, frames = 0, slow = 0, lastFrame = 0, probe = 0, refresh = 16.7;

  const tuning = () => window.PinkieTuning;
  const allowed = () => { const t = tuning(); return Boolean(t && t.auto && t.level === "standard"); };
  const setLevel = (next) => {
    next = Math.max(0, Math.min(LADDER.length - 1, next));
    if (next === level) return;
    const rising = next > level;
    level = next;
    tuning()?.setEase?.(LADDER[level]);
    root.toggleAttribute("data-pinkie-easing", level > 0);
    emit("pinkie:ease-change", {level});
    if (rising && !told) {
      told = true;
      try { window.__pinkieBuddy?.say?.("电脑有点吃力，碧琪先省一点力气，缓过来就恢复～ 不想让碧琪自己调，可以在「进阶调节」里关掉。"); } catch {}
    }
  };
  // 一个窗口算「卡」：超过一半的时间花在慢帧上（慢帧 = 比这块屏幕的正常帧间隔慢三倍以上，且超过 50 毫秒）。
  const closeWindow = (t) => {
    const span = t - windowStart;
    const bad = frames >= 5 && slow / span > 0.5;
    windowStart = t; frames = 0; slow = 0;
    if (!allowed()) { if (level) setLevel(0); badStreak = 0; calmSince = t; return; }
    if (bad) {
      calmSince = t;
      if (++badStreak >= BAD_WINDOWS) { badStreak = 0; setLevel(level + 1); }
    } else {
      badStreak = 0;
      if (level && t - calmSince >= CALM_MS) { calmSince = t; setLevel(level - 1); }
    }
  };
  const measuring = () => !document.hidden && !away && document.hasFocus();
  const frame = (t) => {
    probe = 0;
    if (!measuring()) { lastFrame = 0; return; }
    if (lastFrame) {
      const gap = t - lastFrame;
      // 屏幕本身的帧间隔：取见过的较小值，慢慢放宽，换了显示器也能跟上。
      refresh = Math.max(4, gap < refresh ? gap : Math.min(34, refresh * 1.0005));
      frames += 1;
      if (gap > 50 && gap > refresh * 3) slow += gap;
      if (t - windowStart >= WINDOW_MS) closeWindow(t);
    } else { windowStart = t; frames = 0; slow = 0; }
    lastFrame = t;
    probe = requestAnimationFrame(frame);
  };
  const kick = () => { if (!probe && measuring()) probe = requestAnimationFrame(frame); };
  window.addEventListener("pinkie:rest-change", kick);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", kick);
  window.addEventListener("pinkie:tuning-change", () => { if (!allowed() && level) setLevel(0); });
  kick();

  window.__pinkieRest = Object.freeze({
    get away() { return away; },
    get rest() { return rest; },
    get level() { return level; },
    wake,
    inspect: () => ({away, rest, level, running: running(), pausedLoops: pausedAnimations.size, pausedVideos: pausedVideos.size,
      refreshMs: Math.round(refresh * 10) / 10, auto: allowed()}),
    // 测试和排查用：跳过等待直接算一次，或者直接给一个减负级别。
    _evaluate: evaluate,
    _setLevel: setLevel,
    _clock: {set idleFor(ms) { lastInput = clock() - ms; }, set blurredFor(ms) { blurredAt = clock() - ms; }, set runEndedFor(ms) { runEndedAt = clock() - ms; }},
  });
})();
