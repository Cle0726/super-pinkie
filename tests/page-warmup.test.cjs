const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('page warmup prefetches only bounded static routes and keeps live chat demand-loaded', () => {
  const source = read('ui/injections/laolao-page-warmup.js');
  assert.match(source, /MAX_IDLE_ROUTES = 3/);
  assert.match(source, /MAX_WARMED_ROUTES = 8/);
  assert.match(source, /link\.rel = "prefetch"/);
  assert.match(source, /link\.fetchPriority = "low"/);
  assert.match(source, /url\.pathname\.startsWith\("\/chat"\)/);
  assert.match(source, /url\.searchParams\.has\("session"\)/);
  assert.match(source, /hasConstrainedConnection/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /motion\.modeAssets/);
  assert.doesNotMatch(source, /MutationObserver/);
});

test('both desktop installers ship the page warmup hook', () => {
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  for (const installer of [mac, windows]) {
    assert.match(installer, /laolao-page-warmup\.js/);
    assert.match(installer, /warmup1/);
  }
});
