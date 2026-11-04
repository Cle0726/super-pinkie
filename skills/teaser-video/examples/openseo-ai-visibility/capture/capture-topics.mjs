// The generated tracker (3 topics x 5 prompts) as a 2400 px tall capture for the camera to pan over, with the boxes the
// scenes cut rows from: each topic header, each prompt, and the tracking button.
//   cd <open-seo checkout>; COLOR=dark OUT=<work>/assets/dark PROJECT_ID=<project from capture-setup> node <this file>
import { open } from '../../../scripts/capture.mjs';

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:4891';
const cap = await open({ out: process.env.OUT || 'assets/setup' });
const p = await cap.page({ colorScheme: process.env.COLOR || 'light' });
await p.setViewportSize({ width: 1440, height: 2400 });
await p.goto(`${BASE}/p/${process.env.PROJECT_ID}/ai-visibility`, { waitUntil: 'networkidle' });
await p.getByText('5 prompts', { exact: true }).first().waitFor();
const buttons = await p.getByRole('button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()).filter(Boolean));
console.log('buttons:', buttons.slice(0, 20).join(' | '));
for (let i = 0; i < 3; i++) await cap.box(p, `topics.topic.${i}`, p.getByText('5 prompts', { exact: true }).nth(i).locator('..'));
const prompts = p.locator('a.whitespace-pre-wrap');
for (let i = 0; i < 15; i++) await cap.box(p, `topics.prompt.${i}`, prompts.nth(i));
const start = p.getByRole('button', { name: process.env.START || 'Schedule tracking' }).first();
await cap.box(p, 'topics.enable', start);
await cap.box(p, 'topics.table', p.locator('a.whitespace-pre-wrap').first().locator('xpath=ancestor::div[contains(@class,"rounded") and contains(@class,"border")][1]'));
await cap.shot(p, 'topics-tall', { wait: 1500 });
await cap.close();
