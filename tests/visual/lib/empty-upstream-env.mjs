// Point model CLIs at empty temp dirs before any test code runs.
// ESM imports are evaluated first, so test files import this module ahead of the rest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-upstream-empty-'));
process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
process.env.CODEX_HOME = path.join(root, 'codex');
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR);
fs.mkdirSync(process.env.CODEX_HOME);
