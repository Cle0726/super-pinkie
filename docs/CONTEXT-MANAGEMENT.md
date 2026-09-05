# 会话自动整理（全局）

这里压缩的是发给模型的会话上下文，不是图片，也不是删除聊天记录。

## 怎么工作

- 唠嗑、项目、想法、无限制四模式：使用 CLE Kk 自带的摘要器。发出下一轮请求前检查上下文；较长工具执行过程也使用同一套容量预留规则。
- 派对：发出请求前，按当前群、当前模型和本机策略读取摘要与近期记录；到达对应模型的整理阈值时，分段整理较早记录，保留近期内容，再发送本轮请求。原始消息、工具记录不删除，也不串到其他群。
- 紫悦执行项目任务时，额外向本次 Codex CLI 传入当前模型容量、按策略换算的自动整理阈值和 `total` 计数范围；不改用户全局 Codex 配置。
- 不修改任何四模式人格文件。摘要失败、被取消或没有产生有效摘要时，不推进摘要检查点。最新消息太长、单靠压缩历史无法解决时，提示分段发送或换模型，不截断最新输入。

触发比例、整理后目标比例和近期原文比例来自本机 `context-policy.json`，并按当前模型容量分别换算。不会把某个模型的固定 token 数套给所有接口。旧的固定 60,000 tokens 预留不再作为全模型通用值；保留近期内容的上限也随模型缩放。

整理不再追求“越短越好”：四个主模式使用 safeguard 分段整理，至少保留最近 8 轮原文，并用内核的严格标识保留和质量复查保护路径、ID 与待办；派对空间的交接记录会明确保留用户硬约束、项目根目录、文件变更、命令与工具结果、错误原文、验证结果和下一步。工作流水线持续维护各工作区的 `memory/context/active.md`，内核在压缩前另做静默记忆刷新。原始聊天记录仍在，整理只改变下一轮送给模型的上下文。

自动整理会调用模型，因此会增加少量等待和 API 用量。它不能修复服务商宕机、鉴权失败或网络断开，也不能保证摘要没有信息损失。原始聊天仍可查看复制。

## 模型容量从哪里来

1. 本机 `context-policy.json` 为“服务商/模型”明确设置的上限。
2. CLE Kk 中该服务商模型的 `contextTokens` / `contextWindow`；另有 Agent 总容量上限时取更小值，但不把这个上限反写成模型原始容量。
3. 本机 Codex CLI 专用：其模型缓存中的上下文容量及有效容量比例。不会把这些数据套到同名第三方 API 上。
4. 接口没有提供容量时，使用 `unknownContextWindow` 的本机设置。这只是回退预算，不代表自动发现了上游真实上限；若实际接口更小，应在 `modelLimits` 中明确填写。

四模式优先利用 CLE Kk 的实际 token 使用量及请求估算；派对组装上下文时采用包含中文和工具输出的保守估算，因此不是所有服务商都能精确到同一个 token。不会声称能从任意 API 自动发现未公开的限制。

本机文件：

- `~/Library/Application Support/SuperPinkie/context-policy.json`：策略和按模型覆盖值。
- `~/Library/Application Support/SuperPinkie/context-limits.json`：安装时各接口采用的容量及来源，不含密钥。
- `~/Library/Application Support/SuperPinkie/backups/context-*`：变更前的配置和运行模块备份。

例如下面是格式示例，模型标识须换成实际已配置的标识，上限须使用该接口真实支持的值：

```json
{
  "triggerRatio": 0.8,
  "targetRatio": 0.7,
  "keepRecentRatio": 0.5,
  "unknownContextWindow": 256000,
  "modelLimits": {
    "服务商ID/模型ID": 64000,
    "codex-cli/本机模型ID": 128000
  }
}
```

修改上限后重新执行 `python3 services/context/setup.py`，并在没有运行任务时重新加载 CLE Kk。派对在每次任务开始时重新读取策略；不同模型的摘要检查点互相独立。切换为较小模型会重新判断容量，而不是继续沿用大模型阈值。

## 安装与验证

`patch/apply-context-budget.mjs` 会先检查当前 OpenClaw 的两处模块结构，全部匹配才备份写入；重复运行不叠加。上游升级改变结构时明确报错，不猜测替换。App 包含补丁和共享策略文件；安装器及皮肤恢复脚本会重新校验应用。已启动进程需要重新加载才能使用新模块。

```sh
node --test tests/context-budget.test.mjs tests/party-members.test.cjs
python3 -m unittest discover -s tests -p '*_test.py' -v
```

测试覆盖容量差异、策略阈值边界、中文长历史、工具输出、摘要失败保留记录、模型和群隔离、安装幂等与备份。离线测试用确定性摘要回调，不冒充真实上游请求成功。

机制依据：[OpenClaw 会话与压缩](https://docs.openclaw.ai/reference/session-management-compaction)、[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。
