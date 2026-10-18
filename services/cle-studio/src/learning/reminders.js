// Only manage the three jobs owned by this study feature. Never adopt a user's
// similarly named job or change a job belonging to another agent.
export const REMINDERS = [
  {kind: 'morning', field: 'morning', label: '早间学习计划'},
  {kind: 'evening', field: 'evening', label: '晚间学习提醒'},
  {kind: 'lastcall', field: 'lastCall', label: '睡前学习收尾'},
];

export function reminderSpec(pact, reminder, target = {}) {
  const value = pact.reminders[reminder.field];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('提醒时间需要填写完整');
  const [hour, minute] = value.split(':').map(Number);
  if (!pact.channel?.to || pact.channel.kind === 'none') throw new Error('先选一个接收提醒的聊天');
  return {
    name: `cle-study-${reminder.kind}`,
    agentId: 'learning',
    enabled: true,
    sessionTarget: 'isolated',
    wakeMode: 'now',
    schedule: {kind: 'cron', expr: `${minute} ${hour} * * *`, tz: pact.timezone, staggerMs: 0},
    payload: {kind: 'agentTurn', message: `[[CLEKK_PACT_NUDGE:${reminder.kind}]]`},
    delivery: {mode: 'announce', channel: pact.channel.kind, to: pact.channel.to,
      ...(target.accountId ? {accountId: target.accountId} : {})},
  };
}

export function ownedReminder(job, reminder) {
  return job.agentId === 'learning' && job.name === `cle-study-${reminder.kind}`
    && job.payload?.message === `[[CLEKK_PACT_NUDGE:${reminder.kind}]]`;
}

export async function syncReminders(request, pact, enabled, target = {}) {
  // Validate all specs before writing any job.
  const specs = enabled ? REMINDERS.map(reminder => reminderSpec(pact, reminder, target)) : [];
  const result = await request('cron.list', {includeDisabled: true});
  const jobs = result.jobs || [];
  for (const [index, reminder] of REMINDERS.entries()) {
    const matches = jobs.filter(job => ownedReminder(job, reminder));
    if (enabled && !matches.length) await request('cron.add', specs[index]);
    for (const [duplicate, job] of matches.entries()) {
      const patch = enabled && duplicate === 0 ? specs[index] : {enabled: false};
      await request('cron.update', {id: job.id, patch});
    }
  }
}
