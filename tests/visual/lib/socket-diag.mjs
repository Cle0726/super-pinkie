// B55: Windows CI sometimes fails a real-page request with net::ERR_NO_BUFFER_SPACE
// (WSAENOBUFS: the machine ran out of socket buffers / ephemeral ports). It shows up
// about twice in 60 red runs, always in tests/hotspot-real-ui-regression.test.mjs, and
// by the time anyone looks the sockets are gone. This module takes one snapshot of the
// TCP table the first time a page reports the error, so the next red run carries the
// numbers needed to find the cause (which process holds the sockets, in which state).
// It only logs; it never changes what a test asserts.
import {execFileSync} from 'node:child_process';

export const NO_BUFFER_SPACE = 'ERR_NO_BUFFER_SPACE';

// Parse `netstat -ano -p tcp` (Windows) into counts by state and by owning PID.
export function summarizeNetstat(text) {
  const byState = {};
  const byPid = {};
  let total = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== 'TCP' || cols.length < 5) continue;
    const [, , , state, pid] = cols;
    total += 1;
    byState[state] = (byState[state] || 0) + 1;
    byPid[pid] = (byPid[pid] || 0) + 1;
  }
  const topPids = Object.entries(byPid)
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .slice(0, 5)
    .map(([pid, count]) => ({pid, count}));
  return {total, byState, topPids};
}

// Map PIDs to image names from `tasklist /FO CSV /NH`.
export function parseTasklist(text) {
  const names = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)"/.exec(line.trim());
    if (m) names[m[2]] = m[1];
  }
  return names;
}

export function formatSocketReport(summary, names = {}, dynamicPorts = '') {
  const states = Object.entries(summary.byState)
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => `${state}=${count}`)
    .join(' ');
  const pids = summary.topPids
    .map(({pid, count}) => `${names[pid] || '?'}#${pid}=${count}`)
    .join(' ');
  const range = dynamicPorts ? ` | dynamic ports: ${dynamicPorts}` : '';
  return `[B55 socket-diag] TCP total=${summary.total} | ${states} | top PIDs: ${pids}${range}`;
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']});
  } catch {
    return '';
  }
}

let reported = false;

// Call with a failed request's errorText. Logs one snapshot per process, Windows only.
export function noteRequestFailure(errorText, {log = console.error, platform = process.platform, exec = run} = {}) {
  if (reported || platform !== 'win32' || !String(errorText || '').includes(NO_BUFFER_SPACE)) return false;
  reported = true;
  const summary = summarizeNetstat(exec('netstat', ['-ano', '-p', 'tcp']));
  const names = parseTasklist(exec('tasklist', ['/FO', 'CSV', '/NH']));
  const dyn = exec('netsh', ['int', 'ipv4', 'show', 'dynamicport', 'tcp'])
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => /\d/.test(s)).join(', ');
  log(formatSocketReport(summary, names, dyn));
  return true;
}

export function resetSocketDiagForTest() {
  reported = false;
}
