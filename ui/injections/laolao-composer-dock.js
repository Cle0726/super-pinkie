/* Both fixed widgets share the same reserved slot in the native composer.
 * Keep the native queue and New messages button in normal flow. Never move
 * those DOM nodes: Lit still owns their children and event bindings. */
(() => {
  'use strict';
  const GAP = 6;
  const layout = (width, run, work) => {
    const both = Boolean(run && work);
    const inline = both && !run.extra && !work.extra && (run.dot ? width >= 180 : width >= 580);
    const workWidth = work ? Math.min(340, inline ? (run.dot ? width - 34 - GAP : width * .41) : width) : 0;
    const runWidth = run ? (run.dot ? Math.min(34, width) : inline ? width - workWidth - GAP : width) : 0;
    const runHeight = run ? run.height + (run.extra ? GAP + run.extra : 0) : 0;
    const workHeight = work ? work.height + (work.extra ? GAP + work.extra : 0) : 0;
    const workOffset = both && !inline ? runHeight + GAP : 0;
    const reserve = Math.max(runHeight, workOffset + workHeight);
    return {runWidth, workWidth, workOffset, reserve: reserve ? reserve + 2 * GAP : 0};
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = {layout}; return; }
  if (window.__pinkieComposerDock) return;

  const slot = {run: null, work: null};
  const details = {run: [], work: []};
  const signature = {run: '', work: ''};
  let shell, input, frame = 0;
  const position = (el, key, value) => {
    if (el.style.getPropertyValue(key) !== value) el.style.setProperty(key, value);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  const track = (kind, el, immediate = false) => {
    if (!Object.hasOwn(slot, kind)) return;
    let changed = false;
    if (slot[kind] !== el) {
      if (slot[kind]) resize?.unobserve(slot[kind]);
      for (const content of details[kind]) resize?.unobserve(content);
      details[kind] = el ? Array.from(el.querySelectorAll('.pk-run__body,.pinkie-work__pill,.pinkie-work__card')) : [];
      for (const content of details[kind]) resize?.observe(content);
      slot[kind] = el;
      if (el) resize?.observe(el);
      changed = true;
    }
    const next = el && [el.hidden, el.dataset.layout, el.classList.contains('is-open'), el.classList.contains('is-expanded')].join(':');
    if (signature[kind] !== next) {
      signature[kind] = next;
      changed = true;
    }
    if (!changed) return;
    if (!immediate) { schedule(); return; }
    // Opening a panel reveals interactive content now. Keep it off the
    // native buttons before this paint, even when a WebView throttles rAF.
    if (frame) cancelAnimationFrame(frame);
    draw();
  };
  const clear = (el) => {
    if (!el) return;
    el.removeAttribute('data-pinkie-composer-dock');
    el.style.removeProperty('--pinkie-composer-dock-space');
  };
  const shown = (el) => el?.isConnected && !el.hidden && el.getClientRects().length > 0;
  function draw() {
    frame = 0;
    if (document.documentElement.getAttribute('data-laolao-mode') === 'metre') { clear(shell); return; }
    const next = document.querySelector('.agent-chat__input');
    if (input !== next) {
      if (input) resize?.unobserve(input);
      clear(shell);
      input = next;
      shell = next?.closest('.agent-chat__composer-shell');
      if (input) resize?.observe(input);
    }
    const run = shown(slot.run) ? slot.run : null;
    const work = shown(slot.work) ? slot.work : null;
    if (!shell || !shown(input) || !run && !work) { clear(shell); return; }
    const rect = input.getBoundingClientRect();
    const left = Math.max(GAP, rect.left);
    const width = Math.floor(Math.min(innerWidth - GAP, rect.right) - left);
    if (width < 34) { clear(shell); return; }
    if (!shell.hasAttribute('data-pinkie-composer-dock')) shell.setAttribute('data-pinkie-composer-dock','');
    const dot = run?.dataset.layout === 'dot';
    const dotBody = run?.classList.contains('is-open') && run.querySelector('.pk-run__body');
    if (run) position(run, '--pinkie-composer-dock-width', `${width}px`);
    const card = work?.querySelector('.pinkie-work__card:not([hidden])');
    const pill = work?.querySelector('.pinkie-work__pill');
    const runHeight = run?.offsetHeight || 0;
    const workHeight = pill?.offsetHeight || 0;
    // Size the work widget once before measuring its expanded card. A
    // popup gets its own row, so the two expansion panels cannot cover it.
    const plan = layout(width, run && {dot, height:runHeight, extra:dotBody ? 1 : 0},
      work && {height:workHeight, extra:card ? 1 : 0});
    if (work) {
      position(work, 'width', `${Math.floor(plan.workWidth)}px`);
      position(work, 'max-width', `${width}px`);
    }
    const sized = layout(width, run && {dot, height:runHeight, extra:dotBody?.offsetHeight || 0},
      work && {height:pill?.offsetHeight || workHeight, extra:card?.offsetHeight || 0});
    position(shell, '--pinkie-composer-dock-space', `${sized.reserve}px`);
    // The spacer is now part of the native column; measure the input after it
    // has reflowed. Its preceding native controls are above the whole slot.
    const top = input.getBoundingClientRect().top;
    const bottom = innerHeight - top + GAP;
    if (run) {
      position(run, 'left', `${left}px`);
      position(run, 'width', `${Math.floor(sized.runWidth)}px`);
      position(run, 'bottom', `${bottom}px`);
    }
    if (work) {
      position(work, 'left', `${left + width - Math.floor(sized.workWidth)}px`);
      position(work, 'top', `${top - GAP - sized.workOffset - (pill?.offsetHeight || workHeight)}px`);
    }
  }
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('pinkie:session-selected', schedule);
  window.addEventListener('laolao:modechange', schedule);
  window.__pinkieComposerDock = {track, schedule};
})();
