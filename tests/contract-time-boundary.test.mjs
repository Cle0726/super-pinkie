import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {contractTimeBoundary, stableContractFile} from '../services/mode-architecture/evidence-rules.mjs';

// File timestamps advance in filesystem ticks: ~100 ns on NTFS, ~4 ms on
// Linux ext4, whole seconds on some network/FAT mounts.  These tests replace
// the clock that fs.statSync reports with a coarse one, so the boundary is
// exercised against a known tick size instead of whatever the CI disk uses.
const TIME_FIELDS = ['atime', 'mtime', 'ctime', 'birthtime'];

function withStatClock(t, shape) {
  const original = fs.statSync;
  fs.statSync = function patchedStatSync(file, options) {
    const stat = original.call(fs, file, options);
    if (!stat || typeof stat !== 'object') return stat;
    const copy = Object.assign(Object.create(Object.getPrototypeOf(stat)), stat);
    for (const field of TIME_FIELDS) {
      if (options?.bigint) {
        const ns = stat[`${field}Ns`];
        if (typeof ns !== 'bigint' || ns <= 0n) continue;
        const shaped = shape(ns);
        copy[`${field}Ns`] = shaped;
        copy[`${field}Ms`] = shaped / 1_000_000n;
      } else {
        const ms = stat[`${field}Ms`];
        if (!(ms > 0)) continue;
        copy[`${field}Ms`] = Number(shape(BigInt(Math.floor(ms * 1e6))) / 1_000_000n);
      }
    }
    return copy;
  };
  t.after(() => { fs.statSync = original; });
}

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-kk-boundary-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('a file written right after the boundary is never treated as pre-existing on a coarse 20 ms clock', t => {
  // A fixed 1 ms wait (the old boundary) leaves the marker and the next write
  // on the same 20 ms tick ~95% of the time, so ten rounds catch it reliably.
  const tick = 20_000_000n;
  withStatClock(t, ns => ns - (ns % tick));
  const root = tempRoot(t);
  for (let round = 0; round < 10; round += 1) {
    const installed = path.join(root, `installed-${round}.py`);
    fs.writeFileSync(installed, 'print("installed before the turn")\n');
    const state = contractTimeBoundary();
    const written = path.join(root, `written-${round}.py`);
    fs.writeFileSync(written, 'print("written during the turn")\n');
    assert.equal(stableContractFile(written, state), null, `round ${round}: a file written after begin() must not be a contract`);
    assert.ok(stableContractFile(installed, state), `round ${round}: a contract installed just before begin() stays usable`);
  }
});

test('a filesystem clock that never ticks past the marker fails closed', t => {
  // Second-level (or frozen) timestamps: no probe can prove a later tick, so
  // the marker's own tick must already count as this turn.
  const frozen = 1_700_000_000_000_000_000n;
  withStatClock(t, () => frozen);
  const root = tempRoot(t);
  const state = contractTimeBoundary();
  const written = path.join(root, 'written.py');
  fs.writeFileSync(written, 'print("written during the turn")\n');
  assert.equal(stableContractFile(written, state), null);
  assert.ok(BigInt(state.contractCutoffNs) < frozen);
});

// B67: a virtual clock drives the file timestamps, performance.now() and the 1 ms
// Atomics.wait inside contractTimeBoundary(), so before / same-tick / after the
// boundary and a slow write are exercised deterministically instead of by luck.
// A file's timestamp is the virtual time its write STARTED (that is when the OS
// stamps it); `slowWriteMs(n)` lets the n-th probe write return later, the way
// Defender scanning a file on close stalls a Windows CI runner.
function withVirtualClock(t, {tickMs = 20, startMs = 1_000_000, sleepMs = 1, slowWriteMs = () => 0, frozen = false} = {}) {
  let now = startMs;
  let probes = 0;
  let waits = 0;
  const stamped = new Map();
  const tick = BigInt(tickMs) * 1_000_000n;
  const write = fs.writeFileSync;
  const stat = fs.statSync;
  t.mock.method(fs, 'writeFileSync', function virtualWrite(file, ...rest) {
    const at = now;
    const result = write.call(fs, file, ...rest);
    for (const key of [path.resolve(String(file)), fs.realpathSync(String(file)), fs.realpathSync.native(String(file))]) stamped.set(key, at);
    if (path.basename(String(file)).startsWith('probe-')) now += slowWriteMs(probes++);
    return result;
  });
  t.mock.method(fs, 'statSync', function virtualStat(file, options) {
    const real = stat.call(fs, file, options);
    const at = stamped.get(path.resolve(String(file)));
    if (at === undefined || !options?.bigint || !real) return real;
    const ns = BigInt(Math.round(at * 1e6));
    const shaped = frozen ? 1_700_000_000_000_000_000n : ns - (ns % tick);
    const copy = Object.assign(Object.create(Object.getPrototypeOf(real)), real);
    for (const field of TIME_FIELDS) { copy[`${field}Ns`] = shaped; copy[`${field}Ms`] = shaped / 1_000_000n; }
    return copy;
  });
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Atomics, 'wait', () => { waits += 1; now += sleepMs; return 'timed-out'; });
  return {advance(ms) { now += ms; }, get waits() { return waits; }};
}

test('B67: contracts before the boundary or on its tick stay usable, writes after it never do (virtual 20 ms clock)', t => {
  const clock = withVirtualClock(t, {tickMs: 20, startMs: 1_000_000});
  const root = tempRoot(t);
  const earlier = path.join(root, 'earlier.py');
  fs.writeFileSync(earlier, 'print("installed a tick before")\n');
  clock.advance(25);
  const sameTick = path.join(root, 'same-tick.py');
  fs.writeFileSync(sameTick, 'print("installed on the boundary tick")\n');
  clock.advance(5);
  const state = contractTimeBoundary();
  const after = path.join(root, 'after.py');
  fs.writeFileSync(after, 'print("written during the turn")\n');
  assert.ok(stableContractFile(earlier, state), 'a contract from an earlier tick stays usable');
  assert.ok(stableContractFile(sameTick, state), 'a contract installed on the boundary tick stays usable');
  assert.equal(stableContractFile(after, state), null, 'a file written after begin() is never a contract');
});

for (const [name, options] of [
  ['a slow probe write (Defender-style stall) after the tick has really passed', {sleepMs: 1, slowWriteMs: n => (n === 0 ? 60 : 0)}],
  ['a Windows ~16 ms timer plus a slow second probe write', {sleepMs: 16, slowWriteMs: n => (n === 1 ? 45 : 0)}],
]) {
  test(`B67: ${name} does not fail closed on a clock that did tick`, t => {
    withVirtualClock(t, {tickMs: 20, startMs: 1_000_000, ...options});
    const root = tempRoot(t);
    const installed = path.join(root, 'installed.py');
    fs.writeFileSync(installed, 'print("installed just before the turn")\n');
    const state = contractTimeBoundary();
    const written = path.join(root, 'written.py');
    fs.writeFileSync(written, 'print("written during the turn")\n');
    assert.ok(stableContractFile(installed, state), 'the boundary gave up although the filesystem clock had passed the marker');
    assert.equal(stableContractFile(written, state), null);
  });
}

test('B67: a frozen clock still fails closed and the wait stays bounded', t => {
  const clock = withVirtualClock(t, {frozen: true, sleepMs: 1});
  const root = tempRoot(t);
  const installed = path.join(root, 'installed.py');
  fs.writeFileSync(installed, 'print("installed on the frozen tick")\n');
  const state = contractTimeBoundary();
  const written = path.join(root, 'written.py');
  fs.writeFileSync(written, 'print("written during the turn")\n');
  assert.equal(stableContractFile(written, state), null);
  assert.equal(stableContractFile(installed, state), null, 'on a frozen clock the marker tick counts as this turn');
  assert.ok(clock.waits <= 60, `the wait must stay near the 50 ms limit (${clock.waits} waits)`);
});
