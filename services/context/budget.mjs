/** Shared relative policy for native OpenClaw compaction. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateRoot = process.env.PINKIE_STATE_ROOT || path.join(os.homedir(), 'Library/Application Support/SuperPinkie');

export function compactionBudget(window) {
  let policy = {};
  try {
    policy = JSON.parse(fs.readFileSync(path.join(stateRoot, 'context-policy.json'), 'utf8'));
  } catch {}

  // 所有模式使用同一条触发边界：实际窗口到 85% 才允许压缩。
  const ratio = Number.isFinite(policy.triggerRatio) && policy.triggerRatio >= 0.6 && policy.triggerRatio <= 0.95
    ? policy.triggerRatio : 0.85;
  // 已知模型必须尊重它声明的真实最大窗口，不能把 128K 假装成 500K；
  // 只有完全未知时才使用本机配置的一百万 fallback。
  const fallback = Number.isFinite(policy.unknownContextWindow) && policy.unknownContextWindow > 0
    ? Math.floor(policy.unknownContextWindow) : 1000000;
  const tokens = Number.isFinite(window) && window > 0 ? Math.floor(window) : fallback;
  // 压缩目标必须明显低于触发线。否则摘要、System Prompt 与当前请求重新
  // 加回后，会立刻再次越过触发线，形成“压缩成功但永远恢复不了”的循环。
  // 完整旧内容仍由 checkpoint 保存；这里控制的是模型下一轮携带的原始尾部。
  const targetRatio = Number.isFinite(policy.targetRatio) && policy.targetRatio >= 0.35 && policy.targetRatio <= 0.75
    ? policy.targetRatio : 0.60;
  const threshold = Math.max(1, Math.floor(tokens * ratio));
  const requestedKeep = Math.max(1, Math.floor(tokens * targetRatio));
  // 即使将来把 targetRatio 配得过高，也至少为摘要、工具定义和下一次回复
  // 留出 15% 窗口；小窗口保底留 4096 tokens。
  const workingHeadroom = Math.max(4096, Math.floor(tokens * 0.15));
  const keepRecent = Math.min(requestedKeep, Math.max(1, threshold - workingHeadroom));

  return {
    window: tokens,
    threshold: threshold,
    reserve: tokens - threshold,
    keepRecent,
    targetRatio
  };
}
