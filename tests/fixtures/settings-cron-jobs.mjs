// 设置页「定时任务」卡的示例数据：三条任务（开 · 上次做完了 / 开 · 上次没做成 / 停用）。
// 写法照 #98 的 tools/pr-shots/98-a3-cron.mjs：fake-gateway.js 赋 window.WebSocket 时接住它，cron.* 请求在页面里直接答，其余照旧交给假网关。
// 时间在请求时才取（那时 Date 已被 harness 冻住），所以每次一样。
export const settingsCronInit = () => {
  const jobsAt = (t0) => [
    {id: 'j1', name: 'weather', displayName: '早上的天气', enabled: true, agentId: 'main', schedule: {kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai'},
      payload: {kind: 'agentTurn', message: '查一下今天的天气，告诉我要不要带伞、穿什么。'}, delivery: {mode: 'announce', channel: 'feishu', to: 'ou_123456'},
      state: {nextRunAtMs: t0 + 20 * 3600e3, lastRunAtMs: t0 - 4 * 3600e3, lastStatus: 'ok'}},
    {id: 'j2', name: 'ci', displayName: '每隔 30 分钟看一眼 CI 有没有红', enabled: true, agentId: 'metre', schedule: {kind: 'every', everyMs: 30 * 60000},
      payload: {kind: 'agentTurn', message: '打开仓库最近一次 CI，如果有红的就把失败的测试名和第一行报错发给我。'}, delivery: {mode: 'announce', channel: 'last'},
      state: {nextRunAtMs: t0 + 12 * 60000, lastRunAtMs: t0 - 18 * 60000, lastStatus: 'error'}},
    {id: 'j3', name: 'weekly', displayName: '周一的待办', enabled: false, agentId: 'project', schedule: {kind: 'cron', expr: '0 9 * * 1,3,5', tz: 'Asia/Shanghai'},
      payload: {kind: 'agentTurn', message: '整理上周没做完的事和这周要注意的安排，列成清单。'}, delivery: {mode: 'announce', channel: 'last'},
      state: {lastRunAtMs: t0 - 51 * 3600e3, lastStatus: 'ok'}},
  ];
  const answers = {
    'cron.list': () => { const jobs = jobsAt(Date.now()); return {jobs, total: jobs.length, offset: 0, limit: 100, hasMore: false, nextOffset: null}; },
    'cron.status': () => ({enabled: true, jobs: 3, nextWakeAtMs: Date.now() + 12 * 60000}),
    'pinkie.cron.targets': () => ({targets: []}),
    'cron.runs': () => ({entries: [], total: 0, offset: 0, limit: 50, hasMore: false, nextOffset: null}),
  };
  const patch = (Cls) => {
    if (!Cls?.prototype || Cls.prototype.__cronFixture) return;
    const orig = Cls.prototype.send;
    Cls.prototype.send = function cronFixtureSend(data) {
      let f = null; try { f = JSON.parse(data); } catch {}
      if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
        Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
        return;
      }
      return orig.call(this, data);
    };
    Cls.prototype.__cronFixture = true;
  };
  let cur = window.WebSocket;
  Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});
};

export const SETTINGS_LINK = 'a.sidebar-footer-icon[aria-label="设置"], .sidebar-shell__footer a[href^="/settings"]';

export async function openSettingsSchedules(page) {
  await page.waitForSelector(SETTINGS_LINK, {state: 'attached', timeout: 10_000});
  await page.evaluate((sel) => document.querySelector(sel)?.click(), SETTINGS_LINK);
  await page.waitForFunction(() => document.querySelectorAll('#pinkie-schedules .pk-job').length >= 3, null, {timeout: 15_000});
  await page.evaluate(() => document.querySelector('#pinkie-schedules')?.scrollIntoView({block: 'start'}));
}
