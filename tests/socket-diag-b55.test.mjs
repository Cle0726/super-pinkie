// B55: the real-page harness logs one TCP-table snapshot when a request fails with
// net::ERR_NO_BUFFER_SPACE, so the next red Windows run says who held the sockets.
// Pure Node: the commands are faked, no browser, no real netstat.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  formatSocketReport,
  noteRequestFailure,
  parseTasklist,
  resetSocketDiagForTest,
  summarizeNetstat,
} from './visual/lib/socket-diag.mjs';

const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    127.0.0.1:5150         0.0.0.0:0              LISTENING       4100',
  '  TCP    127.0.0.1:5150         127.0.0.1:50001        TIME_WAIT       0',
  '  TCP    127.0.0.1:5150         127.0.0.1:50002        TIME_WAIT       0',
  '  TCP    127.0.0.1:50003        127.0.0.1:5150         ESTABLISHED     7200',
  '  TCP    127.0.0.1:5150         127.0.0.1:50003        ESTABLISHED     4100',
  '  UDP    0.0.0.0:5353           *:*                                    900',
].join('\r\n');

const TASKLIST = [
  '"node.exe","4100","Services","0","80,000 K"',
  '"chrome-headless-shell.exe","7200","Services","0","120,000 K"',
].join('\r\n');

function fakeExec(calls) {
  return (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'netstat') return NETSTAT;
    if (cmd === 'tasklist') return TASKLIST;
    if (cmd === 'netsh') return 'Protocol tcp Dynamic Port Range\r\n---\r\nStart Port      : 49152\r\nNumber of Ports : 16384\r\n';
    return '';
  };
}

test('netstat summary counts TCP rows by state and by PID, skips headers and UDP', () => {
  const s = summarizeNetstat(NETSTAT);
  assert.equal(s.total, 5);
  assert.deepEqual(s.byState, {LISTENING: 1, TIME_WAIT: 2, ESTABLISHED: 2});
  assert.deepEqual(s.topPids[0], {pid: '0', count: 2});
  assert.deepEqual(s.topPids.map((p) => p.pid).sort(), ['0', '4100', '7200']);
});

test('report names the processes holding sockets and the dynamic port range', () => {
  const line = formatSocketReport(summarizeNetstat(NETSTAT), parseTasklist(TASKLIST), '49152, 16384');
  assert.match(line, /^\[B55 socket-diag\] TCP total=5 \| /);
  assert.match(line, /TIME_WAIT=2/);
  assert.match(line, /node\.exe#4100=2/);
  assert.match(line, /chrome-headless-shell\.exe#7200=1/);
  assert.match(line, /dynamic ports: 49152, 16384$/);
});

test('ERR_NO_BUFFER_SPACE on Windows logs exactly one snapshot per process', () => {
  resetSocketDiagForTest();
  const calls = [];
  const logs = [];
  const opts = {platform: 'win32', exec: fakeExec(calls), log: (m) => logs.push(m)};
  assert.equal(noteRequestFailure('net::ERR_NO_BUFFER_SPACE', opts), true);
  assert.equal(noteRequestFailure('net::ERR_NO_BUFFER_SPACE', opts), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /TCP total=5/);
  assert.deepEqual(calls.map((c) => c.split(' ')[0]), ['netstat', 'tasklist', 'netsh']);
});

test('counter-example: other errors and other platforms run nothing', () => {
  for (const [errorText, platform] of [
    ['net::ERR_ABORTED', 'win32'],
    ['net::ERR_CONNECTION_REFUSED', 'win32'],
    ['failed', 'win32'],
    ['net::ERR_NO_BUFFER_SPACE', 'linux'],
    ['net::ERR_NO_BUFFER_SPACE', 'darwin'],
  ]) {
    resetSocketDiagForTest();
    const calls = [];
    const logs = [];
    assert.equal(noteRequestFailure(errorText, {platform, exec: fakeExec(calls), log: (m) => logs.push(m)}), false, `${errorText} on ${platform}`);
    assert.deepEqual(calls, []);
    assert.deepEqual(logs, []);
  }
});

test('a command that fails still yields a report instead of throwing', () => {
  resetSocketDiagForTest();
  const logs = [];
  noteRequestFailure('net::ERR_NO_BUFFER_SPACE', {platform: 'win32', exec: () => '', log: (m) => logs.push(m)});
  assert.equal(logs.length, 1);
  assert.match(logs[0], /TCP total=0/);
});

test('the real-page harness feeds every failed request through the diagnostic and keeps the assertion text', () => {
  const src = fs.readFileSync(new URL('./visual/lib/real-harness.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{noteRequestFailure\} from '\.\/socket-diag\.mjs';/);
  const handler = src.slice(src.indexOf("page.on('requestfailed'"), src.indexOf("page.on('response'"));
  assert.match(handler, /noteRequestFailure\(errorText\)/);
  assert.match(handler, /failedRequests\.push\(`\$\{req\.method\(\)\} \$\{where\}: \$\{errorText\}`\)/);
});
