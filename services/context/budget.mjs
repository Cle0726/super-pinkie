/** Shared relative policy for native OpenClaw compaction; ultra-long retention mode. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateRoot = process.env.PINKIE_STATE_ROOT || path.join(os.homedir(), 'Library/Application Support/SuperPinkie');

export function compactionBudget(window) {
  let policy = {};
  try {
    policy = JSON.parse(fs.readFileSync(path.join(stateRoot, 'context-policy.json'), 'utf8'));
  } catch {}

  // 使用持久化的模型感知边界，默认 65%；较早触发为压缩摘要和下一轮回复
  // 留出余量，避免 200K/272K fallback 在 85% 才开始时已经溢出。
  const ratio = Number.isFinite(policy.triggerRatio) && policy.triggerRatio >= 0.5 && policy.triggerRatio <= 0.9
    ? policy.triggerRatio : 0.65;
  // 已知模型必须尊重它声明的真实最大窗口，不能把 128K 假装成 500K；
  // 只有完全未知时才使用本机配置的一百万 fallback。
  const fallback = Number.isFinite(policy.unknownContextWindow) && policy.unknownContextWindow > 0
    ? Math.floor(policy.unknownContextWindow) : 1000000;
  const tokens = Number.isFinite(window) && window > 0 ? Math.floor(window) : fallback;
  const targetRatio = Number.isFinite(policy.targetRatio) && policy.targetRatio >= 0.35 && policy.targetRatio <= 0.75
    ? policy.targetRatio : 0.45;
  const keepRatio = Number.isFinite(policy.keepRecentRatio) && policy.keepRecentRatio >= 0.05 && policy.keepRecentRatio <= 0.75 ? policy.keepRecentRatio : 0.45;
  const threshold = Math.max(1, Math.floor(tokens * ratio));
  const requestedKeep = Math.max(1, Math.floor(tokens * keepRatio));
  // 压缩结果必须比触发线至少低 15%，为摘要、工具定义和下一次回复留空间。
  const workingHeadroom = Math.max(4096, Math.floor(tokens * 0.15));
  const keepRecent = Math.min(requestedKeep, Math.max(1, threshold - workingHeadroom));

  return {
    window: tokens,
    threshold,
    reserve: tokens - threshold,
    keepRecent,
    targetRatio: Number.isFinite(policy.targetRatio) && policy.targetRatio >= 0.35 && policy.targetRatio <= 0.75
      ? policy.targetRatio : 0.45
  };
}
