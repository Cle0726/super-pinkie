// OpenSEO's Agent setup page for the launch video: the setup tab, the copied state, and the Skills tab, with the click
// targets the pointer visits (Copy, the agent names, the Skills tab, the skills it points at).
//   cd <open-seo checkout>; OUT=<work>/assets/cv DEMO_BASE=http://localhost:3103 DEMO_PROJECT_ID=<id> node <this file>
// Runs against a local OpenSEO in hosted auth mode: the first run opens a browser to sign in. The page footer shows the
// local MCP URL, so the composition frames the camera above it.
import { open } from '../../../scripts/capture.mjs';

const BASE = process.env.DEMO_BASE || 'http://localhost:3103';
const cap = await open({ out: process.env.OUT || 'assets/cv', login: { url: BASE, done: /\/p\// }, permissions: ['clipboard-read', 'clipboard-write'],
                         hide: [/We hope you.re enjoying OpenSEO|running low on credits|used all your credits/] });
const p = await cap.page();
await p.goto(`${BASE}/p/${process.env.DEMO_PROJECT_ID}`, { waitUntil: 'networkidle', timeout: 60000 });   // the project first, so the sidebar shows it
await p.getByRole('link', { name: 'Agent setup' }).first().click();
await p.waitForURL(/\/ai/); await p.waitForLoadState('networkidle');
const copy = p.getByRole('button', { name: 'Copy setup prompt' });
await copy.waitFor();
await cap.box(p, 'aip.copy', copy);
await cap.box(p, 'aip.tab.skills', p.getByRole('tab', { name: 'Skills' }));
for (const a of ['Claude Code', 'ChatGPT', 'Grok Bot', 'Hermes', 'OpenClaw']) await cap.box(p, 'aip.agent.' + a, p.getByText(a, { exact: true }));
await cap.shot(p, 'aip-0', { wait: 800 });
await copy.click();
await cap.shot(p, 'aip-1', { wait: 250 });            // "Copied": shown on the word "copy"
await p.waitForTimeout(2600);
await p.getByRole('tab', { name: 'Skills' }).click();
await p.getByText('/keyword-research', { exact: true }).waitFor();
for (const s of ['keyword-research', 'seo-audit', 'seo-coach', 'seo-report']) await cap.box(p, 'aip.skill.' + s, p.getByText('/' + s, { exact: true }));
await cap.shot(p, 'aip-skills', { wait: 600 });
await cap.close();
