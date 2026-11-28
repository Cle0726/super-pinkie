# 待办池（常备）

规矩：谁空了就自己拿下一件，认领一行就开工，不用问、不用等派。等 CI 和截图的时候也照样拿。
认领格式：在 #96 发 `[lane] 认领：<编号> <标题>`，分支 `linux/<slug>`，一题一 PR，CI 全绿后在 PR 写 `[linux1] 可合 @<完整SHA>`。
拿之前先核对：目标文件有没有被开着的 PR 动（公开接口查），别撞车。

## 正在做

- #199 CI 红修复（最终正文被吞）：portable / windows / ratchet 三项红，根因是 tests/mode-architecture.test.mjs 行数 3294 → 3311；win-coord 口径：新文件登记 +N，已有文件变长先省行。认领：linux1（进行中）
- #207 windows-checks 红：其余绿，原因待查日志。认领：linux1（待查）

## 排队

- 任务 2-5：install() 换目录不是原子的（fs.rmSync 再 rename，中间失败丢旧版本；应用运行时 Windows 删目录可能删一半）
- 任务 2-6：remove() 先删记录再删目录（删目录失败留孤儿目录）
- 任务 2-3：Windows 原生端没有任何导航拦截（app/windows_app_window.py run() 不拦导航；macOS 有 decidePolicyFor）——需 Windows 真机，Linux 测不了
- 交叉审 linux2 的 PR（win-coord 派，见 #96 7187698736）
- #150「⋯」躲麦克风 measure() 纯逻辑测试：measure()/covered() 锁在 ui/injections/laolao-metre-perm.js 的 DOM IIFE 闭包里，需改 ui/ 抽逻辑，暂搁置
- 任务 1 续：22 小时窗口其余 40 个 CI 失败 run 未逐个开日志（已做 11 个），按同一脚本扩表

## 已完成（留档）

- 任务 0：最终正文被吞 → #199（CI 红修中）
- 任务 1：偶发测试表（11 个 run）→ 贴 #96，无可修目标
- 任务 2-1：head 前脚本抢跑 → #201（已全绿，可合已报）
- 任务 2-2：showPicker → 已在 #189 修好
- 任务 2-4：safeAppName 保留字 → #209（基本全绿）
- 任务 3：Metre 单元测试 #127/#94 → #207（windows-checks 红）
- 任务 4：K3 复核 → 5 条疑点贴 #80
