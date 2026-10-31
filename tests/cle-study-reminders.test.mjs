import test from 'node:test';
import assert from 'node:assert/strict';
import {REMINDERS, reminderSpec, syncReminders} from '../services/cle-studio/src/learning/reminders.js';

const pact = {
  timezone: 'Asia/Shanghai', reminders: {morning: '08:30', evening: '21:00', lastCall: '22:30'},
  channel: {kind: 'feishu', to: 'ou_test'},
};

test('reminders use the learning agent, selected timezone and recipient, with no stale progress', () => {
  const spec = reminderSpec(pact, REMINDERS[0], {accountId: 'study'});
  assert.deepEqual(spec.schedule, {kind: 'cron', expr: '30 8 * * *', tz: 'Asia/Shanghai', staggerMs: 0});
  assert.deepEqual(spec.delivery, {mode: 'announce', channel: 'feishu', to: 'ou_test', accountId: 'study'});
  assert.equal(spec.agentId, 'learning');
  assert.equal(spec.payload.message, '[[CLEKK_PACT_NUDGE:morning]]');
  assert.throws(() => reminderSpec({...pact, channel: {kind: 'none'}}, REMINDERS[0]), /接收提醒/);
});

test('saving twice updates only feature-owned jobs, without touching similarly named user jobs', async () => {
  const unrelated = {id: 'user-job', agentId: 'main', name: 'cle-study-morning', payload: {message: 'my work'}, enabled: true};
  const jobs = [unrelated]; let adds = 0;
  const request = async (method, params) => {
    if (method === 'cron.list') return {jobs: jobs.map(job => ({...job}))};
    if (method === 'cron.add') { jobs.push({id: `new-${++adds}`, ...params}); return {}; }
    if (method === 'cron.update') { Object.assign(jobs.find(job => job.id === params.id), params.patch); return {}; }
    throw new Error(method);
  };
  await syncReminders(request, pact, true);
  await syncReminders(request, {...pact, reminders: {...pact.reminders, morning: '09:15'}}, true);
  assert.equal(adds, 3);
  assert.equal(jobs.length, 4);
  assert.equal(jobs.find(job => job.id === 'new-1').schedule.expr, '15 9 * * *');
  assert.deepEqual(unrelated, {id: 'user-job', agentId: 'main', name: 'cle-study-morning', payload: {message: 'my work'}, enabled: true});
  await syncReminders(request, pact, false);
  assert.ok(jobs.slice(1).every(job => !job.enabled));
  assert.equal(unrelated.enabled, true);
});

test('invalid reminder configuration performs no writes, and duplicate owned jobs are disabled', async () => {
  const writes = [];
  const job = {id: 'a', ...reminderSpec(pact, REMINDERS[0])};
  const request = async (method, params) => {
    if (method === 'cron.list') return {jobs: [job, {...job, id: 'duplicate'}]};
    writes.push({method, params}); return {};
  };
  await assert.rejects(syncReminders(request, {...pact, reminders: {...pact.reminders, lastCall: '99:00'}}, true));
  assert.equal(writes.length, 0);
  await syncReminders(request, pact, true);
  assert.deepEqual(writes.find(item => item.params.id === 'duplicate').params.patch, {enabled: false});
});
