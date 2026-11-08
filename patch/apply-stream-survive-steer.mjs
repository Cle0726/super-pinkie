/** Keep the visible streaming text alive when a follow-up message is sent
 * while a run is still streaming.
 *
 * Symptom: the assistant's half-written answer vanishes the moment the user
 * appends another message, then the same text reappears a second later as a
 * finished bubble. Nothing is lost from the transcript; only the live view
 * blanks out.
 *
 * Cause: in the Control UI's send acknowledgement handler, a fresh run id
 * arrives for a session that already has an in-flight run. The handler
 * unconditionally reassigns chatRunId and, when the run id changed, blanks
 * chatStream to an empty string. The renderer then has nothing to draw until
 * the next delta for the new run arrives, so the bubble empties out.
 *
 * Fix: when the incoming acknowledgement carries a *different* run id while a
 * previous run is still streaming, keep the existing stream text (and its
 * start timestamp) in place. The new run's first delta replaces it through the
 * normal delta path, so nothing stale is left behind and no text is invented.
 */
import fs from 'node:fs';
import path from 'node:path';

const marker = '/* pinkie-stream-survive-steer:v1 */';

const target = 'dist/control-ui/assets/chat-page-DrPkxqJK.js';

// Exact slice of the shipped bundle.
const before = 'if(cd(e,t,l),m())if(Vh(e,o,c?s:void 0,d,r.runId),r.status===`ok`)';
const after = 'if(cd(e,t,l),m())if(Vh(e,o,c?s:void 0,d,r.runId),r.status===`ok`)';

// The idempotent part: the stream-preserving branch.
const beforeAssign = 'let t=e.chatRunId===r.runId&&typeof e.chatStream==`string`;e.chatRunId=r.runId,t||(e.chatStream=``,e.chatStreamStartedAt=d)';
const afterAssign = `${marker}let t=e.chatRunId===r.runId&&typeof e.chatStream==\`string\`;`
  + 'let keepPreviousStream=!t&&typeof e.chatStream==`string`&&e.chatStream.trim().length>0&&e.chatRunId!==null;'
  + 'e.chatRunId=r.runId,keepPreviousStream||t||(e.chatStream=``,e.chatStreamStartedAt=d)';

export function apply({root}) {
  const file = path.join(root, target);
  if (!fs.existsSync(file)) throw new Error(`missing target: ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) return {changed: false, reason: 'already patched'};
  if (!source.includes(beforeAssign)) {
    throw new Error('target anchor not found; the Control UI bundle changed shape');
  }
  const count = source.split(beforeAssign).length - 1;
  if (count !== 1) throw new Error(`expected exactly one anchor, found ${count}`);
  fs.writeFileSync(file, source.replace(beforeAssign, afterAssign), 'utf8');
  return {changed: true, file: target};
}

const isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (isMain) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('set OPENCLAW_ROOT to the package root to patch');
  const result = apply({root});
  console.log(result.changed ? `patched ${result.file}` : `skipped: ${result.reason}`);
}
