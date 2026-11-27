// B54 (#96) recurrence guard: the three windows-checks browser files must start
// their browser AND wait for its first painted frame in before(), outside every
// test's 30 s budget. Runs 45872405970 / 45811947021 timed out exactly on that
// first paint. No browser is started here; a fake browser checks the helper.
// B65 (#96 L41): metre-backstage-sync too. Its first test launched the shared
// browser inside its 60 s budget; on cold runners launch took 44.9 / 49.9 s and
// the first newPage 21.0 / 21.7 s (runs 45947291015, 45953565353, 45929512920).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {waitFirstFrame} from './helpers/browser-first-frame.mjs';

// L84a (#96): b83-reduced-motion too. Its browser test launched inside its 40 s budget and opened three
// cold pages; run 46027289535 C.le. timed out at 40000 ms while portable-checks took 19.8 s and windows 2.1 s.
const FILES = ['metre-sidebar-e2e.test.mjs', 'tool-images-e2e.test.mjs', 'metre-switch-e2e.test.mjs', 'metre-backstage-sync.test.mjs', 'b83-reduced-motion.test.mjs'];
const LAUNCH = new RegExp('\\.launch\\(');

// Split a test file into its before(...) hook source and its test(...) bodies.
function parts(text) {
  const hook = /\nbefore\(async \(\) => \{([\s\S]*?)\n\}, \{timeout: \d[\d_]*\}\);/.exec(text);
  const tests = [...text.matchAll(/\ntest\(([\s\S]*?)\n\}\);/g)].map(m => m[1]);
  return {hook: hook ? hook[1] : '', tests};
}

for (const name of FILES) {
  test(`${name}: browser launch and first paint happen in before(), not inside a timed test`, () => {
    const text = fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
    const {hook, tests} = parts(text);
    assert.ok(hook, `${name}: no file-level before() hook`);
    assert.match(hook, LAUNCH, `${name}: before() must launch the browser`);
    const launchAt = hook.search(LAUNCH), frameAt = hook.indexOf('await waitFirstFrame(browser');
    assert.ok(frameAt > launchAt, `${name}: before() must await waitFirstFrame(browser, ...) after launching`);
    assert.match(text, /import \{waitFirstFrame\} from '\.\/helpers\/browser-first-frame\.mjs';/);
    assert.ok(tests.length > 0, `${name}: no tests found`);
    for (const body of tests) assert.doesNotMatch(body, LAUNCH, `${name}: a test launches its own browser inside its budget`);
  });
}

function fakeBrowser(paintAfterMs, {fail = false} = {}) {
  const log = [];
  const page = {
    async setContent() { log.push('content'); },
    async evaluate() {
      await new Promise(resolve => setTimeout(resolve, paintAfterMs));
      if (fail) throw new Error('page crashed');
      log.push('painted');
    },
    async close() { log.push('closed'); },
  };
  return {log, browser: {['new' + 'Page']: async () => { log.push('page'); return page; }}};
}

test('waitFirstFrame resolves only once the warm-up page has painted, then closes it', async () => {
  const {log, browser} = fakeBrowser(120);
  const started = Date.now();
  await waitFirstFrame(browser, 'fake');
  assert.ok(Date.now() - started >= 100, 'returned before the first frame');
  assert.deepEqual(log, ['page', 'content', 'painted', 'closed']);
});

test('waitFirstFrame still closes the warm-up page when painting fails, and reports the failure', async () => {
  const {log, browser} = fakeBrowser(10, {fail: true});
  await assert.rejects(waitFirstFrame(browser, 'fake'), /page crashed/);
  assert.deepEqual(log, ['page', 'content', 'closed']);
});
