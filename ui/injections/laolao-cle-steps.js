/* cle-steps:v1 —— 状态行的步骤队列：看得见，也追得上
 *
 * Gemini 这类模型会在几十毫秒里把一串工具和结果一起吐出来：
 *   - 只有一步时至少停 HOLD，动画才来得及被看见；后面还排着时只停 RUSH；
 *   - 同一类、已经做完的步骤合并成最后一个；积压时只留最近的几个，状态行不会落后十几秒；
 *   - 还在跑的、失败的永远不丢；失败先亮出来，再往下走；
 *   - 并行、等审批时被顶下去的那一步，只要还没跑完，前面的播完就回到它，不谎称「思考中」。
 */
export const HOLD = 1400;      // 很快跑完的工具（几十毫秒）也要在状态行上停留一下，不然根本看不到
export const RUSH = 650;       // 后面还有步骤在等
export const RESULT = 1150;    // 成功 / 失败收势：变过去 0.45 秒，再让人看清
export const INSTANT = 300;    // 这么快就做完的：不绕回签名，多留点时间给它自己的形状
export const BACKLOG = 2;      // 做完但还没播的，最多留几个
export const GRACE = 800;      // 两个工具之间常空出零点几秒：先别切回「思考」，等等下一步
// 只有结果要紧的步骤才演「成功」，读文件、搜索这些不演
const CELEBRATE = new Set(['test', 'build', 'install', 'git']);

// 一眼就是在跑测试的命令（共享的 tool-kind 表不猜这一类：它管文案，这里只管演哪个动画）
const TEST_COMMAND = /^(?:(?:cd|set-location|pushd)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)?(?:\w+=\S+\s+)*(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+test(?::[\w:-]+)?|(?:npx\s+)?(?:jest|vitest|mocha|pytest|ctest)|npx\s+playwright\s+test|python3?\s+-m\s+(?:pytest|unittest)|node\s+--test|(?:cargo|go|dotnet|swift)\s+test)(?=\s|$)/i;
const SHELL_TOOL = /exec|bash|shell|command|terminal|powershell|process|^run|code_check/i;

/** 运行时这一步演哪一类：测试命令 → 测试；不认识、也不像命令行的工具 → 其他工具（不谎称在执行命令）。 */
export function liveKind(kind, name, args) {
  if (kind !== 'exec') return kind;
  const command = String(args?.command || args?.cmd || '').trim();
  if (TEST_COMMAND.test(command)) return 'test';
  return command || SHELL_TOOL.test(String(name || '')) ? kind : 'tool';
}

export function createSteps(show, {now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id)} = {}) {
  let queue = [], cur = null, bg = 'think', timer = 0;
  const seen = new Map();

  function compact() {
    // 失败和还在跑的不丢
    const droppable = (s) => s.done && !s.failed;
    queue = queue.filter((s, k) => !(droppable(s) && queue[k + 1]?.kind === s.kind && droppable(queue[k + 1])));
    let spare = queue.filter(droppable).length - BACKLOG;
    if (spare > 0) queue = queue.filter((s) => !droppable(s) || spare-- <= 0);
  }

  function pump() {
    cancel(timer);
    compact();
    const t = now();
    if (cur) {
      const pose = cur.pose;
      const until = cur.at + (pose ? (queue.length && pose === 'ok' ? RUSH : RESULT) : queue.length ? RUSH : HOLD);
      // 失败立刻亮出来；成功等这一步露过脸，而且只在没有别的步骤排队时演
      if (!pose && cur.done) {
        if (cur.failed) return take(cur, 'fail');
        if (cur.ok && !queue.length && CELEBRATE.has(cur.kind)) {
          if (t - cur.at >= RUSH) return take(cur, 'ok');
          timer = later(pump, cur.at + RUSH - t);
          return;
        }
      }
      if (t < until) { timer = later(pump, until - t); return; }
    }
    if (queue.length) {
      const step = queue.shift();
      return take(step, step.done && step.failed ? 'fail' : '');
    }
    if (cur && !cur.done) return;                       // 工具还在跑，等它的结果
    if (cur) {
      let running = null;
      for (const s of seen.values()) if (!s.done) running = s;
      if (running) return take(running, '');
    }
    if (cur && !cur.graced) { cur.graced = true; timer = later(pump, GRACE); return; }
    cur = null;
    show({kind: bg, text: '', mono: false, quick: false});
  }

  function take(step, pose) {
    cur = step;
    cur.pose = pose;
    cur.at = now();
    show({kind: pose || step.kind, text: step.text, mono: step.mono, quick: queue.length > 0 || step.done});
    timer = later(pump, pose ? RESULT : queue.length ? RUSH : HOLD);
  }

  return {
    start(step) {
      if (step.id && seen.has(step.id) && !seen.get(step.id).done) return;   // 同一次调用从两路事件各来一遍
      const s = {id: step.id, kind: step.kind, text: step.text || '', mono: !!step.mono, done: false, failed: false, ok: false, pose: '', at: 0};
      if (s.id) seen.set(s.id, s);
      queue.push(s);
      pump();
    },
    finish(id, {failed = false, ok = false} = {}) {
      const s = seen.get(id);
      if (s && !s.done) {
        Object.assign(s, {done: true, failed, ok});
        if (s === cur && !s.pose && !failed && now() - s.at < INSTANT) show({kind: s.kind, text: s.text, mono: s.mono, quick: true});
        // 并行时已经让位给后一步了：失败仍要补演一次
        if (failed && s !== cur && !queue.includes(s)) queue.unshift(s);
      }
      pump();
    },
    refine(id, kind) {
      const s = seen.get(id);
      if (!s) return;
      s.kind = kind;
      if (s === cur && !s.pose) show({kind, text: s.text, mono: s.mono, quick: true});
    },
    background(kind) { bg = kind; pump(); },
    reset() {
      cancel(timer);
      queue = []; cur = null; bg = 'think';
      seen.clear();
    },
    get current() { return cur; },
    get waiting() { return queue.length; },
  };
}
