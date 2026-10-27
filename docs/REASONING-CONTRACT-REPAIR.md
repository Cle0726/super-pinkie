# 九档发送接口与安装版增强引擎修复

用户看到“增强推演未完成：增强档位请求无效”，包括只发送 `hi` 也失败。

## 原因与范围

当前安装版和实际插件里的 reasoning.mjs 仍是旧的两档接口，只读取 `tier`；界面已经发送九档的 `level`。工作区虽有完整九档引擎，却未进入安装版。此前显示层验收只保护了安装版旧文件，遗漏了这个版本分裂。

已用安装前的实际模块复现：仅传 `level: ultra` 得到完全相同的错误，补上传统 `tier` 字段即获接受。

- 发送端同时传值相同的 `level` 和 `tier`，兼容窗口与网关不同时重载的情况。
- 安装版及实际插件同步为工作区已有的完整九档 reasoning.mjs；没有重新编写或降低 recipeFor 的设计。
- 原生档位直接路由；往下缺少档位时走直接作答提示，往上不足按既定流程补充。Adaptive 按消息难度选 Low / XHigh。Max 保留两份独立解答、批评及最多两轮修正；Ultra 保留三种做法的独立解答、批评仲裁及最多三轮修正。
- 独立解答继续使用用户当前模型，只有明确配置 criticModels 才改变批评模型。保持取消、跨会话隔离、幂等、任务完成后验收以及旧 tier 调用兼容。
- 输入栏九档、字体材质、动画及紧凑布局不变。没有复制或修改安装版共享 index.mjs。

## 验收

| 检查 | 结果 |
|---|---|
| 增强、发送、路由及相关回归 | 51 项通过 |
| 实际发送包装器接实际增强引擎 | 四类原生能力 × 五种模式 × 九档及 Adaptive 难题分支，200 组通过 |
| 安装副本中的文件重新跑同一连通测试 | 通过；不是只测仓库源码 |
| 安装后 App 文件及实际插件各跑同一连通测试 | 两处均通过 |
| 当前配置目录 | 116 个模型 × 9 档，1044 个路由落在模型支持的参数内；21 个含斜杠的模型 ID 保持完整 |
| Gemini 3.8 实际模型 | 九档全部完成一次隔离发送；Max 两份独立解答和一次批评，Ultra 三份和一次批评，状态均 passed |

真实模型测试以生产发送器和增强引擎接入隔离的 RPC/会话宿主，再由模型适配器调用已配置的 Gemini 3.8 接口；没有重启或借用用户生产会话。它验证发送、档位选择、独立解答数量和批评回传，不代表所有复杂问题的回答质量。共 16 次真实模型调用，上游返回 total_tokens 合计 64,624。

可复验：

```sh
node --test tests/reasoning-contract.test.mjs tests/reasoning-enhance.test.mjs tests/reasoning-send.test.cjs
PINKIE_TEST_REASONING='/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/services/mode-architecture/reasoning.mjs' PINKIE_TEST_SIDEBAR='/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui/laolao-sidebar.js' node --test tests/reasoning-contract.test.mjs
```

## 安装与并发交接

仍从当时的当前安装版创建新副本，完整目录并发校验、签名后增量写入；只变更 sidebar 脚本、引擎、缓存引用与签名。安装脚本原先为 sidebar34、页面为 sidebar35，已将实际入口统一为 sidebar36。head fragment 本来没有此脚本，保持原有加载顺序。

实际插件仅同步 reasoning.mjs。保护了共享 index.mjs、学习资源、九档样式、Claude 浏览器记忆及原生指针、上下文收束动画。原生代码段逐字一致。

两个并发学习台会话的 A/B 文件归属已检查；它们仍未部署。此次没有从工作区整体复制学习台 head、安装脚本或服务入口，也没有部署其未完成模块。仓库已有缓存版本只做单项同步。

**没有退出、刷新或重启用户 App。需要用户完全退出再打开，才能让网关加载完整九档引擎；只刷新聊天页不能重载服务端模块。**

报告、当前安装基线、回归、真实调用记录及备份索引：`/Users/Admin/Documents/Codex/2026-10-23/users-admin-release-superpinkie-repo/work/reasoning-contract-round11`。后续安装须继续以当前安装版为基线，不能从旧副本恢复 reasoning.mjs。
