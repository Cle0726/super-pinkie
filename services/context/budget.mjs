/** Shared relative policy for native OpenClaw compaction; no prompts or history. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function compactionBudget(window) {
  let policy={};
  try { policy=JSON.parse(fs.readFileSync(path.join(os.homedir(),'Library/Application Support/SuperPinkie/context-policy.json'),'utf8')); } catch {}
  // Upper bound 0.85 lets power users push compaction late (e.g. 0.8) without
  // being silently clamped back to 0.7. Lower bound 0.3 still prevents a
  // self-DOS from a misconfigured near-zero ratio.
  const ratio=Number.isFinite(policy.triggerRatio)&&policy.triggerRatio>=.3&&policy.triggerRatio<=.85?policy.triggerRatio:.8;
  const tokens=Number.isFinite(window)&&window>0?Math.floor(window):256000;
  // Default 256000 is generous on purpose: an unknown provider that did not
  // declare a contextWindow should not be compacted after a single exchange.
  const keepRatio=Number.isFinite(policy.keepRecentRatio)&&policy.keepRecentRatio>=.05&&policy.keepRecentRatio<=.5?policy.keepRecentRatio:.25;
  const threshold=Math.max(1,Math.floor(tokens*ratio));
  return {window:tokens,threshold,reserve:tokens-threshold,keepRecent:Math.max(1,Math.floor(tokens*keepRatio))};
}
