/** Shared model-window-aware policy for native OpenClaw compaction. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateRoot = process.env.PINKIE_STATE_ROOT || path.join(os.homedir(), 'Library/Application Support/SuperPinkie');
const defaults = [
  {maxContextTokens:128000, triggerRatio:0.60, targetRatio:0.35, keepRecentRatio:0.35},
  {maxContextTokens:200000, triggerRatio:0.65, targetRatio:0.40, keepRecentRatio:0.40},
  {maxContextTokens:272000, triggerRatio:0.70, targetRatio:0.45, keepRecentRatio:0.45},
  {maxContextTokens:500000, triggerRatio:0.78, targetRatio:0.50, keepRecentRatio:0.50},
  {maxContextTokens:1000000, triggerRatio:0.85, targetRatio:0.60, keepRecentRatio:0.60},
];
const validRatio = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function compactionBudget(window) {
  let policy = {};
  try {
    policy = JSON.parse(fs.readFileSync(path.join(stateRoot, 'context-policy.json'), 'utf8'));
  } catch {}
  const fallback = Number.isFinite(policy.unknownContextWindow) && policy.unknownContextWindow > 0
    ? Math.floor(policy.unknownContextWindow) : 1000000;
  const tokens = Number.isFinite(window) && window > 0 ? Math.floor(window) : fallback;
  const configured = Array.isArray(policy.adaptiveTiers) ? policy.adaptiveTiers : defaults;
  const tiers = configured.filter((item) => Number.isFinite(item?.maxContextTokens) && item.maxContextTokens > 0)
    .sort((a,b) => a.maxContextTokens - b.maxContextTokens);
  const tier = tiers.find((item) => tokens <= item.maxContextTokens) || tiers.at(-1) || defaults.at(-1);
  const triggerRatio = validRatio(tier.triggerRatio, 0.5, 0.9) ? tier.triggerRatio : 0.65;
  const targetRatio = validRatio(tier.targetRatio, 0.30, 0.75) ? tier.targetRatio : 0.45;
  const keepRatio = validRatio(tier.keepRecentRatio, 0.05, 0.75) ? tier.keepRecentRatio : targetRatio;
  const threshold = Math.max(1, Math.floor(tokens * triggerRatio));
  const requestedKeep = Math.max(1, Math.floor(tokens * keepRatio));
  const workingHeadroom = Math.max(4096, Math.floor(tokens * (tokens >= 500000 ? 0.10 : 0.15)));
  const keepRecent = Math.min(requestedKeep, Math.max(1, threshold - workingHeadroom));
  return {window:tokens, threshold, reserve:tokens-threshold, keepRecent, triggerRatio, targetRatio};
}
