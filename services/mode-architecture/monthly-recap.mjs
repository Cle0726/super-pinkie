// 月度回顾（任务书 任务-官方新功能五项-1125.md 第 2 项，ui2 11-25）：学习书桌这一个月的数。
// 只读本机已有的学习账本（pact/days/<日期>.json）、词汇本和连续天数，不写任何文件、不调模型、不往外发。
// 会话条数和常用模式在界面那边用 sessions.list 数（laolao-recap.js）。长期记忆按模式各自独立，不跨模式汇总，这里不数。

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

// 某个时区里的「YYYY-MM-DD」。en-CA 的日期格式正好是这个样子。
export function dayIn(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(instant));
}

export function previousMonth(today) {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function daysOfMonth(month) {
  const [, y, m] = MONTH.exec(month).map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({length: total}, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const count = value => Math.max(0, Math.round(Number(value) || 0));

// month 不给就是上个月（按学习约定里的时区）；给了必须是 YYYY-MM 且不晚于这个月。
export function monthlyRecap(pact, {month = '', now = pact.now()} = {}) {
  const timeZone = pact.get().timezone || 'Asia/Shanghai';
  const today = dayIn(now, timeZone);
  const target = month ? String(month) : previousMonth(today);
  if (!MONTH.test(target)) throw new Error('月份要写成 YYYY-MM');
  if (target > today.slice(0, 7)) throw new Error('还没到这个月');
  const study = {activeDays: 0, minutes: 0, answered: 0, correct: 0, wrong: 0, reviews: 0, notes: 0, lessons: 0};
  for (const date of daysOfMonth(target)) {
    if (date > today) break;
    const day = pact.readDay(date);
    const answered = count(day.questions?.answered), correct = Math.min(answered, count(day.questions?.correct));
    const minutes = count(day.minutes), reviews = count(day.reviews?.done), notes = count(day.notes?.added), lessons = count(day.lessons);
    if (minutes || answered || reviews || notes || lessons || count(day.drillFinished)) study.activeDays++;
    study.minutes += minutes; study.answered += answered; study.correct += correct; study.wrong += answered - correct;
    study.reviews += reviews; study.notes += notes; study.lessons += lessons;
  }
  const vocab = {added: 0, reviewed: 0};
  let words = [];
  try { words = pact.store?.vocab?.read?.().words || []; } catch {}
  for (const word of words) {
    if (Number(word?.createdAt) > 0 && dayIn(Number(word.createdAt), timeZone).startsWith(target)) vocab.added++;
    if (Number(word?.lastReviewedAt) > 0 && dayIn(Number(word.lastReviewedAt), timeZone).startsWith(target)) vocab.reviewed++;
  }
  let streak = {current: 0, best: 0};
  try { const s = pact.streak({now}); streak = {current: count(s.current), best: count(s.best)}; } catch {}
  return {month: target, timeZone, today, study, vocab, streak};
}
