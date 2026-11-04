// OpenSEO's AI visibility setup, end to end: a fresh project's setup form (focused, then one frame per keystroke of the
// URL), a real research run, the competitor review, then the saved tracker. Run against a local OpenSEO in no-auth mode.
// The research run spends a little usage credit; capture-topics.mjs takes the tracker page itself.
//   cd <open-seo checkout>; COLOR=dark OUT=<work>/assets/dark DEMO_BASE=http://127.0.0.1:4891 node <this file>
import { open } from '../../../scripts/capture.mjs';

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:4891';
const SITE = process.env.SITE || 'linear.app';
const NAME = process.env.NAME || 'Linear';
const OUT = process.env.OUT || 'assets/setup';
const cap = await open({ out: OUT });
const p = await cap.page({ colorScheme: process.env.COLOR || 'light' });

// A fresh project with no website, so AI visibility opens on the website setup gate.
let projectId = process.env.PROJECT_ID;
if (!projectId) {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('[data-slot="combobox-trigger"]').first().click();
  await p.getByRole('button', { name: 'New project' }).click();
  await p.getByLabel('Name').fill(NAME);
  await p.getByRole('button', { name: 'Create project' }).click();
  const before = p.url();
  await p.waitForURL((u) => /\/p\/[0-9a-f-]{36}/.test(u.href) && !before.startsWith(u.href.slice(0, 60)));
  projectId = p.url().match(/\/p\/([0-9a-f-]{36})/)[1];
}
console.log('project', projectId);
await p.goto(`${BASE}/p/${projectId}/ai-visibility`, { waitUntil: 'networkidle' });
const input = p.getByLabel('Website URL');
await input.waitFor();
await cap.box(p, 'setup.card', p.locator('[data-slot="card"]').first());
await cap.box(p, 'setup.input', input);
await cap.box(p, 'setup.submit', p.getByRole('button', { name: 'Research website' }));
await cap.shot(p, 'form-00', { wait: 600 });
await input.click();
await cap.shot(p, 'form-01');
await cap.typeFrames(p, 'form', SITE, 2);

// Research: a real run (spends a little credit), then the competitor review step.
await p.getByRole('button', { name: 'Research website' }).click();
await p.getByLabel('Research in progress').waitFor();
await cap.box(p, 'research.spinner', p.getByLabel('Research in progress'));
const t0 = Date.now();
await p.getByRole('heading', { name: 'Edit competitors' }).waitFor({ timeout: 240000 });
console.log('research took', (Date.now() - t0) / 1000);

// Competitors.
await p.waitForTimeout(1500); // favicons
await cap.box(p, 'review.card', p.locator('[data-slot="card"]').first());
await cap.box(p, 'review.table', p.locator('table').first());
const rows = p.locator('tbody tr');
const count = await rows.count();
for (let i = 0; i < count; i++) await cap.box(p, `review.row.${i}`, rows.nth(i));
await cap.box(p, 'review.continue', p.getByRole('button', { name: 'Continue' }));
await cap.shot(p, 'review', { wait: 1200 });
await cap.tall(p, 'review-tall', 1400);

// Save: the tracker page with the generated topics.
await p.getByRole('button', { name: 'Continue' }).click();
await p.waitForLoadState('networkidle');
await p.waitForTimeout(3000);
await cap.shot(p, 'topics-flat', { wait: 1200 });
console.log('final url', p.url());
await cap.close();
