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
