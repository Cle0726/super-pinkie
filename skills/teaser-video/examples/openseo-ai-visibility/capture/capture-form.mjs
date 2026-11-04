// The website setup form only (focused, then one frame per keystroke of the URL), for re-capturing the first scene
// from another branch (the delivered video's first scene came from a branch with a newer setup screen). No research is run.
//   cd <worktree>; COLOR=dark OUT=<dir> DEMO_BASE=http://127.0.0.1:<port> node <this file>
import { open } from '../../../scripts/capture.mjs';

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:4891';
const cap = await open({ out: process.env.OUT || 'assets/form' });
const p = await cap.page({ colorScheme: process.env.COLOR || 'light' });
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
const before = p.url();
await p.locator('[data-slot="combobox-trigger"]').first().click();
await p.getByRole('button', { name: 'New project' }).click();
await p.getByLabel('Name').fill(process.env.NAME || 'Linear');
await p.getByRole('button', { name: 'Create project' }).click();
await p.waitForURL((u) => /\/p\/[0-9a-f-]{36}/.test(u.href) && u.href.slice(0, 60) !== before.slice(0, 60));
const id = p.url().match(/\/p\/([0-9a-f-]{36})/)[1];
await p.goto(`${BASE}/p/${id}/ai-visibility`, { waitUntil: 'networkidle' });
const input = p.getByLabel('Website URL');
await input.waitFor();
await cap.box(p, 'setup.card', p.locator('[data-slot="card"]').first());
await cap.box(p, 'setup.input', input);
await cap.box(p, 'setup.submit', p.locator('button[type="submit"]').first());
await cap.shot(p, 'form-00', { wait: 600 });
await input.click();
await cap.shot(p, 'form-01');
await cap.typeFrames(p, 'form', process.env.SITE || 'linear.app', 2);
await cap.close();
