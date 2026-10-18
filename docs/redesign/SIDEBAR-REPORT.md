# 侧边栏迁移报告（原 App → C.le. 插件）

分支 `oc/sidebar`，网关 profile `cle-shell`（端口 19989），模块 id `sidebar`。
原文件：`ui/injections/laolao-sidebar.js`、`laolao-session-list.js`、`laolao-sidebar.css`、
`laolao-sidebar-surface.css`、`laolao-sidebar-autohide.js`；移植件在 `services/cle-studio/static/legacy/`（同名）。
角色：Li An（他）；模式：雅叙 chat / 营造 project / 堇思 thinking / 习作 learning / 挥洒 unrestricted；
只使用 `--cle-gaze`（蓝宝石）与 `--cle-gold`（金）两个强调色。

一句话结论：**原生 `.sidebar-brand` 保留，其下挂载了原版侧栏的全部入口**（概览/更多、新会话、
搜索、归档·全部删除、项目文件夹＋打开文件夹、置顶/项目/最近分组、会话菜单、一键清理、项目绑定）；
所有删除/归档/重命名都走原生接口并带 `expectedSessionId`，每次变更后重新拉取列表，原生 UI 不会继续显示已删除会话。

---

## 交付物

| 文件 | 说明 |
|---|---|
| `static/legacy/laolao-session-list.js` | 会话列表本体（分组、搜索、菜单、增删改、项目、清理）。只在自己的容器 `#cle-sidebar` 里渲染，不移动 Lit 节点。 |
| `static/legacy/laolao-sidebar.js` | 入口/句柄：`window.__cleSidebar`、`__laolaoSidebar`（`gwRequest`、`currentSessionKey`）、“更多 ›”用的原生页面清单、清除/恢复侧栏。 |
| `static/legacy/laolao-sidebar-autohide.js` | 收起态边缘把手 + 正文位移；旧的玻璃/滑光层删除。 |
| `static/legacy/laolao-sidebar.css` | 令牌版样式（行 13.5px、分组标题 11px `--cle-ink-3`、选中 `--cle-gaze-soft`、悬停 5% 墨、发丝线 `--cle-line`）。 |
| `static/legacy/laolao-sidebar-surface.css` | 原“雾面侧栏”只留下必须的兜底（防止原生列表闪出、折叠态隐藏）。 |
| `src/legacy/modules.js` | 新增 `{id:'sidebar', css:[…], js:['laolao-sidebar-autohide.js','laolao-session-list.js','laolao-sidebar.js']}`（只改了这一个 `src/` 文件）。 |
| `tests/cle-sidebar.test.cjs` | 8 个离线测试（vm + 宿主桩），覆盖 expectedSessionId、过滤删除、模式映射、菜单模式隔离、原生节点不被删、项目视图。 |

探针证据都在 `docs/redesign/evidence/*.json`（每段都是 `{"result":…,"errors":[]}`）。

---

## 原版功能逐项状态

| 原版功能 | 状态 | 新实现 | 证据 |
|---|---|---|---|
| 布局：概览/更多 ›、＋新会话、搜索、归档·全部删除、项目文件夹、分组列表、会话菜单、一键清理，自上而下 | works | `#cle-sidebar` 里按原顺序：搜索 → 归档/项目/全部删除 → ＋新会话 → 分组列表 → 更多 › | `01-layout.json`（`blockBelowBrand:true`，`topToBottom` 高度 28/22/30/453/31，`groups:["项目文件夹","最近"]`） |
| 原生入口隐藏：`.sidebar-nav`、`.sidebar-online`、`.sidebar-sessions` | works | CSS `display:none`（`data-cle-sidebar` 且未 `data-cle-sidebar-off` 时），节点本身保留不删 | `01-layout.json` `native:{nav:"none",online:"none",sessions:"none"}`；`tests/cle-sidebar.test.cjs` 断言原生节点不被移除 |
| 更多 ›：原生页面按中文名可达（首页/智能体/仪表盘/系统/自动化/插件/Logbook/工作看板 + 设置/用量/设备） | works | 打开时实时读 `.sidebar-nav a[href]`（跳过会话链接），用原生链接导航 | `02-menus-views.json` `more:[…]`；浏览 `/agents`、`/dashboards` 时 `legacy.sidebar="ok"` 且块仍挂载 |
| ＋新会话（标签唯一，必要时加时间戳；自动打开） | works | `sessions.create({agentId,label})` → `host.sessions.open`；同名先查再重试 | `04-mutations.json` `open:{sel:…,activeRow:["oc-test-evi-a"]}`；真模型会话自动命名见下 |
| 新会话自动用第一句话命名（原 autoTitle） | works | 创建/本轮打开的无标题会话读 `chat.history` 首条用户消息后 `sessions.patch` | 真模型：新会话 `新会话 484` → 发送后 2 秒变成 `用一句话介绍你自己`（行与服务器一致，toast「会话列表已更新」） |
| 搜索当前模式的会话（含归档） | works | 按标题过滤（当前列表/归档页） | `02-menus-views.json` `search:{query:"oc-test-ui",rows:["oc-test-ui-renamed"]}` |
| 归档 · 全部删除 | works（按钮都在；「全部删除」见下） | 归档切换只读视图；全部删除带确认框 | `02-menus-views.json` `archiveView:{groups:["已归档"],bar:["返回","项目","全部删除"]}` |
| 归档 / 恢复（保留记录） | works | `sessions.patch({archived:true|false, expectedSessionId})`；删掉当前会话后自动建新会话 | `04-mutations.json` `archive:{inArchivedList:true,stillLive:false}`；`05-archive-restore.json` 归档页菜单 `["恢复会话","永久删除…"]` → 恢复成功 |
| 会话菜单：重命名 / 置顶 / 归档 / 删除会话和记录… | works | 同原版顺序；重命名先用输入框 | `02-menus-views.json` `sessionMenu:[…]`；重命名实测 toast「会话名称已保存」，服务器同步 |
| 置顶 | works | `sessions.patch({pinned, expectedSessionId})` + 本地 `state.pins` 驱动「置顶」分组 | `03-pins-projects.json` `pins:["…212ab17a"]`、`serverPinned:true`、菜单项变成「取消置顶」 |
| 永久删除（归档页） | works | 同 `sessions.delete`（带 `expectedSessionId`、`deleteTranscript:true`） | `05-archive-restore.json` |
| 删除后与原生状态同步（列表 + 原生会话） | works | 原版 WebSocket：每次删除/归档后 `invalidate()` 重新 `sessions.list`；`sessions.changed` 220ms 合并；20s 轮询发现别处删除并清掉置顶/分组 | `04-mutations.json` `afterDeleteSelected:{deleted:true,selChanged:true,selAlive:true,sidebarRow:false,nativeRow:false,pins:0}`；另测在别处删除当前会话后侧栏与原生列表都不再显示，选中切到存活会话 |
| 项目文件夹 ＋ 打开文件夹（`pinkie.project.validate`） | works | 有原生选择器走 `laolaoProjectFolder`，浏览器里退回路径对话框；先 validate 再建项目 | `06-project-methods.json` `validate` 返回规范路径；`validateBad` 返回“不能把整台电脑…当项目”；项目头「＋ 打开文件夹」见 `02-menus-views.json` |
| 项目绑定（`pinkie.project.bind` / 归入项目 / 移出） | works | 归入前先以 `path:null` 读现有绑定；组内新建会话即绑定；「分组但无文件夹」拒绝新建并提示 | `06-project-methods.json` `bindReadOnly:{binding:null}`、`bindMissingSession:"只支持四模式的有效会话"`；组内新建 + 绑定路径（binding `{root:"…/docs/redesign",name:"oc-test-proj2"}`） |
| 项目菜单：Finder 显示 / 复制路径 / 重选文件夹 / 重命名 / 移除 | works | 同原版；「移除项目（保留会话）」 | `03-pins-projects.json` `settings:[…]`、`settingsPath:"/Users/…/docs/redesign"` |
| 删除项目（连会话） | works | 新增「删除项目与记录…」：删组内全部会话（含归档），保留磁盘文件夹，删除当前会话时自动换新会话 | `08-project-delete.json` 确认文案「…2 个会话…」→ `sessionsGone:true, projectGone:true, groupGone:true, folderStillExists:true` |
| 一键清理 | works（仅用 `deleteFilter` 只匹配 `oc-test-` 跑了代码路径） | 清理当前列表里未整理会话；当前、置顶、项目内保留；过滤只缩小范围 | `07-cleanup-delete-all.json` `result:{testDeleted:true,realKept:true}` |
| 全部删除 | works（同上，只用 `deleteFilter` 跑代码路径；**没有对真实数据执行过**） | 删当前模式普通会话（含归档），不删主会话，文件夹不动 | `09-delete-all-filtered.json` `targetGone:true`，其余会话保留 |
| 归档 ↔ 恢复 ↔ 删除与列表一致（批量） | works | 同上 | `07`、`09` |
| 模式隔离：雅叙/营造/堇思/习作/挥洒 → main/project/thinking/learning/unrestricted；`data-cle-room` 变化重绘 | works | 读 `dataset.cleRoom`，每模式独立 pins/projects/folders/collapsed；`sessions.list` 带对应 `agentId` | `05` 之前实测：切到 thinking 后 `搜索堇思的会话`、`mode:"thinking"`，回到聊天恢复；`tests` 内 `every mode maps to its agent` |
| 侧栏收起 / 展开（旧 autohide） | partly | 原玻璃/滑光/卡片移除；保留边缘把手（仅在原生 `shell--nav-collapsed` 时出现，点击展开）与正文位移 | `10-collapse-edge.json` `collapsed:{nav:true,block:"none",edge:"block"}` → 点把手后恢复 |
| 清除侧栏回到原生 / 恢复 | works | 更多 › 清除/恢复，另支持 `?cle-sidebar=0` | `02-menus-views.json` 菜单项；清除后 `native nav:"block"`、`#cle-sidebar:"none"`，点小把手恢复 |
| 真模型会话在侧栏中 | works | 打开 `agent:main:oc-test-model` 后行高亮、与原生选中一致 | `11-real-model-session.json`（行 228×28，`rowActive:true`，`rowName` 为第一条用户消息，页面 2 个气泡） |
| 深/浅色与令牌 | works（只验证了取值，无法目测） | 行/选中/标题/菜单/弹窗全部取令牌 | `13-dark-light-tokens.json`：深色行 `rgb(163,157,144)`=`--cle-ink-2`、选中 `rgba(56,174,255,.10)`=`--cle-gaze-soft`；浅色 `rgb(92,90,87)`、`rgba(42,99,232,.08)` |

样式审计：侧栏脚本与样式里 **0 个**硬编码颜色、`gradient:false`、行上 `box-shadow` 0 处（探针 `cssText/jsColors:[]`）。

---

## 未执行 / 需要说明的项

1. **真实数据上的“全部删除”“一键清理”“项目 unbind/删除项目”没有执行。**
   只通过调试钩子 `window.__cleSidebarUI.deleteFilter = s => s.label.startsWith('oc-test-')` 让这两个动作只作用于
   `oc-test-` 前缀的会话，验证了代码路径（`07`、`09`）。过滤只会缩小范围，不会扩大。
2. **通过原生选择器选文件夹没有实测**（探针环境没有 `webkit.messageHandlers`），走的是
   `chooseFolderDialog()` 路径：提交后调用 `pinkie.project.validate` 再建项目。App 内桥接代码照原版保留。
3. **`pinkie.project.*` 的“解绑”接口不存在**：`bind({path:null})` 只读、不能删除绑定。原版同样如此，
   所以「移除项目」「删除项目」只移除分组（文件与已有会话绑定保持不变），UI 文案已写明。
4. **原生 `.sidebar-brand` 没动**：收起按钮、命令面板、房间选择器仍在原来的位置；`.sidebar-nav` 等只由 CSS 隐藏，
   没有删除节点（“更多”依赖它们）。
5. **页面头标题不跟随自定义会话**：`agent:main:dashboard:*` 会话的 `.chat-pane__session-title-text` 仍显示
   “Main Session”（原生行为，不属于侧栏）；侧栏高亮与 URL 正确。
6. **判断“列表与原生解析器是否同步”在探针里只能间接看**：删除后 `sidebar-recent-session[data-session-key]`
   不再出现、`host.sessions.selectedKey` 已换到存活会话；原生侧栏列表已被 CSS 隐藏，无法肉眼比对。
7. **`sessions.list` 的 `archived:false` 不返回 `archivedAt`**（`includeDerivedTitles` 可用），归档行由
   `archived:true` 那次查询补标；`fields/archive` 参数不被接受（`unexpected property 'includeArchived'` 已验证）。
8. **排序**：原版按应用返回顺序；新版按 `updatedAt` 倒序（`03`、`05` 可见）。
9. 视觉（霜面、间距、深色对比）**没有目测**，只给了计算样式；留给 Claude 润色。

## 网关接口情况（原代码用到的）

| 方法 | 现状 |
|---|---|
| `sessions.list({agentId, archived, limit, includeDerivedTitles})` | 可用。**`archived` 可为布尔**；多次调用会触发 `sessions.changed`（自激）→ 已加 220ms 合并与“变才提示”。 |
| `sessions.create({agentId,label})` | 可用；同名返回 `label already in use: …`。 |
| `sessions.patch({key,agentId,label,pinned})` | 可用。 |
| `sessions.patch({... archived / snoozedUntil})` | **必须带 `expectedSessionId`**，否则 `expectedSessionId required for session lifecycle patch`（原版没带，新版已补）。 |
| `sessions.delete({key,agentId,deleteTranscript})` | 可用；主会话返回 `Cannot delete the main session`；删除归档会话可带 `archivedOnly`。 |
| `pinkie.project.validate({path})` / `pinkie.project.bind({key,path,name})` | 可用（扩展 `pinkie-project-scope`）；`path:null` 只读；非四模式 key 报“只支持四模式的有效会话”。**没有 unbind。** |
| `chat.history({sessionKey,agentId,limit,offset,maxChars})` | 可用（自动命名）。 |
| `chat.send` | 需要 `idempotencyKey`（探针用真实模型出回答时的发现，与侧栏无关）。 |

## 测试安全与清理

- 只创建/重命名/归档/删除标签以 `oc-test-` 开头的会话；测试后已删除全部 `oc-test-` 会话，清空该 profile 的
  `laolao.sidebar.v2.chat` 测试置顶/项目，并删除写进
  `~/Library/Application Support/SuperPinkie/dev/cle-stage/state/project-scope/bindings.json` 的 `oc-test*` 绑定。
- 没有删除任何磁盘文件夹；没有对真实项目执行 unbind/删除项目。
- 主会话标签曾被测试改名，已还原为 `Main Session`。
