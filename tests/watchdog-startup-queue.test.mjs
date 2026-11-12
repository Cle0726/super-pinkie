import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {UpstreamWatchdog as MacWatchdog} from '../services/mode-architecture/index.mjs';

// Windows first copies the shared service, then overlays its runtime snapshot.
// Recreate that layout in a temporary directory, never in the user's profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-win-watchdog-'));
const staged = path.join(temp, 'mode-architecture');
fs.cpSync(path.join(root, 'services/mode-architecture'), staged, {recursive: true});
// Plan A: the Windows engine is the shared one; overlay only what the snapshot still carries.
const overlay = path.join(root, 'desktop/windows/mac-runtime/services/mode-architecture');
if (fs.existsSync(overlay)) fs.cpSync(overlay, staged, {recursive: true});
process.on('exit', () => fs.rmSync(temp, {recursive: true, force: true}));
const {UpstreamWatchdog: WindowsWatchdog} = await import(pathToFileURL(path.join(staged, 'index.mjs')));

for (const [platform, Watchdog] of [['Mac', MacWatchdog], ['Windows', WindowsWatchdog]]) {
  test(`${platform} restores eleven pending turns without a startup process burst`, async () => {
    const jobs = Array.from({length: 11}, (_, i) => ({
      sessionKey: `agent:project:startup-${i}`, agentId: 'project',
      runId: `run-${i}`, attempt: 1, kind: 'upstream',
    }));
    const persisted = new Map(jobs.map(job => [job.sessionKey, job]));
    const store = {list: () => [...persisted.values()], delete: key => persisted.delete(key)};
    const injected = [], scheduled = [], calls = [];
    let running = 0, peak = 0;
    const runner = (_cmd, args) => new Promise((resolve, reject) => {
      const request = JSON.parse(args[args.indexOf('--params') + 1]);
      running += 1;
      peak = Math.max(peak, running);
      calls.push({key: request.sessionKey, finish: (error) => {
        running -= 1;
        if (error) reject(error); else resolve({stdout: '{"status":"started"}'});
      }});
    });
    const workflow = {
      enqueueNextTurnInjection: async value => { injected.push(value); },
      unscheduleSessionTurnsByTag: async () => ({removed: 1}),
    };
    const watchdog = new Watchdog({session: {workflow}}, () => '', runner,
      '/isolated/fake-cli', () => ({pending: 0, quietForMs: 20_000}), store);
    watchdog.scheduleImmediate = value => { scheduled.push(value); return true; };

    assert.equal(await watchdog.recoverPending(), 11);
    assert.equal(injected.length, 11);
    assert.ok(injected.every(value => value.ttlMs >= 300_000 + 11 * 32_000));
    assert.ok(scheduled.every(value => value.delayMs === 8_000));
    assert.equal(persisted.size, 11);

    const dispatches = scheduled.map(value => watchdog.dispatchImmediate(value));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(await watchdog.dispatchImmediate(scheduled[0]), false, 'duplicate is suppressed');
    await watchdog.cancel(jobs[5].sessionKey);
    const replacement = watchdog.dispatchImmediate({...scheduled[5], runId: 'new-generation'});

    // A failed request must release the queue and leave the other jobs intact.
    calls[0].finish(new Error('isolated gateway timeout'));
    for (let i = 1; i < 11; i += 1) {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls.length, i + 1);
      calls[i].finish();
    }
    const results = await Promise.all([...dispatches, replacement]);
    assert.equal(peak, 1);
    assert.equal(results[0], false);
    assert.equal(results[5], false, 'cancelled queued generation must not be sent');
    assert.equal(results.at(-1), true, 'new generation can still run');
    assert.deepEqual(calls.map(call => call.key), [
      ...jobs.filter((_, i) => i !== 5).map(job => job.sessionKey), jobs[5].sessionKey,
    ]);
    assert.equal(persisted.size, 10, 'only the explicitly cancelled job is removed');
    assert.ok(scheduled.length > 11, 'the failed request remains eligible for retry');
  });
}
