// Plan B screenshots: walks the run-status bar through every state on the fake
// gateway. Load it in the harness page, then call __runStatusShot(i) for
// i = 0 … STATES.length - 1, one state every ~3 seconds (run-status-shots.sh).
// Events go through the same pinkie:gateway-event feed the real page uses; the
// times on the bar are the real elapsed times of this replay.
(() => {
  const SK = () => new URL(location.href).searchParams.get('session');
  const fire = (event, payload) => window.dispatchEvent(new CustomEvent('pinkie:gateway-event',
    {detail: {event, payload: {sessionKey: SK(), runId: window.__shotRun || 'shot-1', ...payload}}}));
  const status = (over) => { window.__fakeRunStatus = {active: true, phase: 'running', missing: [], continuations: {tier: 0, integrity: 0}, review: {phase: 'idle'}, ...over}; };
  const refresh = () => window.__pinkieRunStatus.refresh();
  const openDot = () => setTimeout(() => {
    const bar = document.querySelector('.pk-run');
    if (bar?.dataset.layout === 'dot' && !bar.classList.contains('is-open')) bar.querySelector('.pk-run__dot')?.click();
  }, 400);
  const STATES = [
    ['thinking', () => { window.__shotRun = 'shot-1'; fire('agent', {stream: 'lifecycle', data: {phase: 'start'}}); }],
    ['steps', () => {
      window.__fakePlan = {title: '做一个记账网页', updatedAt: Date.now(), items: [
        {id: 'a', text: '列出要记的字段', status: 'completed'}, {id: 'b', text: '写页面和样式', status: 'completed'},
        {id: 'c', text: '截图核对手机宽度', status: 'in_progress'}, {id: 'd', text: '补上导出按钮', status: 'pending'},
        {id: 'e', text: '自己试用一遍', status: 'pending'}, {id: 'f', text: '写使用说明', status: 'pending'}]};
      fire('agent', {stream: 'tool', data: {phase: 'start', name: 'exec', toolCallId: 't1'}});
      return refresh();
    }],
    ['background', () => {
      window.__fakePlan = null;
      fire('agent', {stream: 'tool', data: {phase: 'result', name: 'exec', toolCallId: 't1', result: 'Command still running (session s1, pid 4242)'}});
      return refresh();
    }],
    ['second-version', () => {
      fire('agent', {stream: 'tool', data: {phase: 'result', name: 'process', toolCallId: 't2', result: 'Process exited with code 0'}});
      status({phase: 'working', missing: ['独立起草 0/1']});
      return refresh();
    }],
    ['reviewer', () => { status({review: {phase: 'reviewing', requestId: 'r1'}}); return refresh(); }],
    ['make-up', () => { status({phase: 'coordinating', missing: ['还没看过手机宽度的截图'], continuations: {tier: 1, integrity: 0}}); return refresh(); }],
    ['asking', () => {
      status({});
      fire('agent', {stream: 'tool', data: {phase: 'start', name: 'ask_user', toolCallId: 'q1', args: {question: '旧版本的页面也一起删掉吗？'}}});
      return refresh();
    }],
    ['slower-than-usual', () => {
      fire('agent', {stream: 'tool', data: {phase: 'result', name: 'ask_user', toolCallId: 'q1', result: '先留着'}});
      status({review: {phase: 'reviewing', requestId: 'r2'}});
      const d = window.__pinkieRunStatus.state.durations; d.review = [200, 200, 200];
      return refresh();
    }],
    ['done', () => {
      window.__fakeRunStatus = null;
      fire('chat', {state: 'final', message: {role: 'assistant', content: [{type: 'text', text: '记账网页做好了。'}]}});
      return refresh();
    }],
    ['stopped', () => {
      window.__shotRun = 'shot-2';
      fire('agent', {stream: 'lifecycle', data: {phase: 'start'}});
      setTimeout(() => fire('chat', {state: 'aborted'}), 300);
    }],
    // Last, so a slow reconnect never shifts the other shots.
    ['reconnecting', () => {
      window.__shotRun = 'shot-3';
      fire('agent', {stream: 'lifecycle', data: {phase: 'start'}});
      // Under laolao-resume's 6 s grace: a longer outage reloads the page (covered by
      // the sessionStorage carry-over, checked separately) and the WebKit host hangs on it.
      setTimeout(() => window.__fake.dropConnection({holdMs: 4000}), 300);
    }],
  ];
  // Start from an empty local history of phase lengths (earlier replays persist in WebKit storage).
  try { const d = window.__pinkieRunStatus.state.durations; for (const k of Object.keys(d)) delete d[k]; localStorage.removeItem('pinkie:run-status:durations:v1'); } catch {}
  // Open the chat itself (not the start screen) with a real running conversation behind the bar.
  try { window.__laolaoSidebar?.navigateSession?.(SK()); } catch {}
  setTimeout(() => { try { window.__fake.scenario('running-refresh', {tools: 6, gap: 60}); } catch {} }, 200);
  window.__runStatusStates = STATES.map(([name]) => name);
  window.__runStatusShot = async (index) => {
    const [name, run] = STATES[index];
    await run();
    openDot();
    return name;
  };
  // Self-paced replay: records when each state really started (page clock), so the
  // shell script can pick frames by real time instead of by scheduled time.
  const covered = () => [...document.querySelectorAll('[class*="laolao-mode-transition"], [class*="splash"]')]
    .some((node) => { const r = node.getBoundingClientRect(); return r.width > 200 && r.height > 200 && getComputedStyle(node).visibility !== 'hidden' && Number(getComputedStyle(node).opacity) > 0.05; });
  window.__runStatusAuto = async (step = 3000) => {
    // Wait until the page has settled: chat on screen, no splash or mode-switch scene, for 1.5 s.
    for (let calm = 0, waited = 0; calm < 1500 && waited < 60_000; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      calm = document.querySelector('.chat-thread') && !covered() ? calm + 250 : 0;
    }
    window.__shotTimes = [];
    for (let i = 0; i < STATES.length; i += 1) {
      const start = Date.now();
      window.__shotTimes.push(start);
      void window.__runStatusShot(i);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, start + step - Date.now())));
    }
    window.__shotTimes.push(Date.now());
  };
  // Session list marks: four marked sessions next to an unmarked one.
  window.__runStatusListShot = () => {
    const now = Date.now();
    const keys = ['a1', 'b2', 'c3', 'd4'].map((id) => `agent:unrestricted:dashboard:${id}`);
    window.__fakeExtraSessions = [
      {key: keys[0], label: '整理三个月销售数据', updatedAt: now - 1000},
      {key: keys[1], label: '做一个记账网页', updatedAt: now - 2000},
      {key: keys[2], label: '把旧照片按年份分好', updatedAt: now - 3000},
      {key: keys[3], label: '周报改成表格', updatedAt: now - 4000},
    ];
    window.dispatchEvent(new Event('laolao:sessions-changed'));
    const ev = (key, event, payload) => window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event, payload: {sessionKey: key, runId: 'l-' + key, ...payload}}}));
    setTimeout(() => {
      ev(keys[0], 'agent', {stream: 'lifecycle', data: {phase: 'start'}});
      ev(keys[1], 'agent', {stream: 'lifecycle', data: {phase: 'start'}});
      ev(keys[1], 'chat', {state: 'final', message: {role: 'assistant', content: '做好了。'}});
      ev(keys[2], 'agent', {stream: 'lifecycle', data: {phase: 'start'}});
      ev(keys[2], 'chat', {state: 'error', errorMessage: 'x'});
      ev(keys[3], 'agent', {stream: 'lifecycle', data: {phase: 'start'}});
      ev(keys[3], 'agent', {stream: 'tool', data: {phase: 'start', name: 'ask_user', args: {question: '要不要加合计行？'}}});
    }, 1500);
    return 'list';
  };
})();
