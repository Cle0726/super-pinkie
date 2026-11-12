# 11-12 Windows 审计 · 交接说明（给 Mac 端）

分支 **`audit/pinkie-1112`**。还没合 main、没打 tag、没发版、没装进任何 App。
这份说明随改动一起更新，最下面的「进度」是做到哪了。Mac 端先读这一份，再看提交。

## 这条分支的底座

`origin/feat/claude-parity-1111`（e3d66bc，最新界面）+ `origin/feat/project-coding-1111`（f4bc174，项目模式写代码、子会话时机提醒）合并而成，合并提交 `8f06238`。两条线原来都从 2.5.48 的 main 分出去，各自往前走，谁也不包含谁。

合并时 3 处冲突，都是两边各加了一批文件名的清单，取并集：

- `installer/macos/apply-theme.sh` 的服务文件清单
- `services/mode-architecture/setup.py` 的服务文件清单
- `desktop/windows/mac-runtime/SHA256SUMS` 里 `services/mode-architecture/index.mjs` 那一行，按合并后的文件重算

**没有并进来的：** `dev/study-game`（学习台游戏，按 `docs/study-game/WINDOWS-DEV.md` 的规矩，验收前不合 main，所以也不合进这条）、`feat/biqi-toolbox-1110`、`feat/biqi-tier-contract-1109`、`feat/run-status-ui`（都还落后 main 22 个提交，是 Mac 端在做的）、`fix/context-meter-live`、`feat/biqi-update-notes`（各一个提交，和这条分支都能干净合并）。

Mac 端如果自己已经把 parity 和 project-coding 合过，再合这条分支时只会在上面 3 个文件上再遇到同样的清单冲突，仍然取并集。

## 改了什么

### 1. 子会话：碧琪自己分工（`services/mode-architecture/session-lineage.mjs`）

原来的三种发起方式里，只有用户明说「另开会话」才会立刻开始，其余都是一张等用户点的卡片。用户大多不点，所以并行实际上很少发生。

新增第四种发起方式 **`in_scope`**：用户这条消息本身要的活里，互不依赖的一块直接开子会话并行做，不出卡片、不用点。

- 只在用户亲自发来的那一轮可用。内部续跑、汇报唤醒、心跳、记忆整理的轮次一律拒绝（报错文字会告诉模型改用 `own_initiative` 卡片）。
- 每轮最多 3 个，同时在跑的上限还是 4 个。
- 汇报回来会自动唤醒父会话去核对、合并（和 `user_asked` 一样，两次用户发言之间最多 3 次）。
- 范围外的后续（顺手发现的 bug、该补的说明）仍然只能是 `own_initiative` 卡片。**用户要了的活怎么分是做法，用户没要的活做不做由用户定**，这条线没有动。
- 构造参数 `autoSplit: key => boolean` 可以整体关掉（默认开）。目前没有接设置界面的开关。

### 2. 汇报不再只给父会话 400 字

原来父会话拿到的是子会话最后一条回复的前 400 个字形，结论经常被截在开场白里。现在：

- 卡片上还是显示 400 字。
- 父会话下一轮读到的是完整的那份，最多 6000 字（`card.full`）。读过之后 `full` 从 `session-cards.json` 里删掉，文件不会越积越大。
- 代理写的简报末尾自动加一句「你最后一条回复就是交回去的汇报：先写结论和成品在哪，再写验证过什么、还差什么」。用户亲自开的子会话原来就有类似的话，措辞改成和新行为一致。
- 卡片上「看完整简报」和实际发出去的简报现在是同一个函数生成的（`briefFor`）。

### 3. 跨模式：子会话可以开到别的模式里，也可以当场去问

- `pinkie_session_start` 多了可选参数 `mode`（`chat` / `project` / `ideas` / `learning`）。子会话建在那个模式的 agent 下，带着父会话的项目文件夹绑定，简报开头会说明是从哪个模式转来的。只能 `fresh`。
- 新工具 **`pinkie_mode_ask`**（`mode`、`question`、可选 `background`）：在那个模式里开一个只回答问题的会话，默认等 120 秒，把答案作为工具结果当场带回；父会话留一张已读的汇报卡片；那个会话答完就归档，不留在另一个模式的侧栏里。等不到就返回 `pending`，答案之后走普通汇报并唤醒父会话。每轮最多 3 次。
- 无限模式两头都不参与：不能从它发起，也不能转到它。
- 网关的父子关系只在同一个 agent 内成立，所以跨模式创建时**不传 `parentSessionKey`**，血缘只记在 `session-lineage.json`（多了 `mode`、`fromMode` 两个字段）。运行数上限、归档父会话时停止子会话、发消息、列表都改成把别的 agent 里的子会话一起算（`familyRows`）。
- `openclaw.plugin.json` 的工具清单、只聊天权限预设（`laolao-settings-user.js` 的 `CHILD_SESSION_TOOLS`）、老配置的启动迁移（`MINIMAL_CHILD_TOOLS`）都加上了 `pinkie_mode_ask`。

### 4. 模式推荐和时机提醒（`services/mode-architecture/session-hints.mjs`）

- 一条消息里列了几件互不依赖的大活、或者用户说了「同时」：提醒改成用 `in_scope` 直接并行，不再是提卡片。
- 新增【别的模式更拿手】：这条消息明显是另一个模式的专长、而当前模式自己的专长对不上时（项目模式里问配色审美、唠嗑模式里要写程序、任何模式里要系统地学），提醒碧琪用 `pinkie_mode_ask` 去问或把大活开到那个模式。同一个去处隔 6 轮才再提，「以后这类事可以直接去某某模式」只让它说一次。要系统地学、练、备考时会建议用户直接切到学习模式，因为学习台只在那边有。
- 判断用的是关键词，只在单方面命中时才提（「帮我做个好看的网页」在项目模式里不会被指到想法模式）。宁可漏，不乱指。

### 5. 四个模式的手册（`personas/{chat,learning,project,thinking}/AGENTS.md`）

「子会话」一节改成四种发起方式；后面新加一节「别的模式更拿手的事：替用户去问，不让用户跑」。四份手册这两节的文字相同。

## 界面上还没接的

后端的返回已经带了这些字段，前端还没用：

- `pinkie.session.lineage` 返回的 `children[key].cross / fromMode`（别的模式转来的子会话）和 `away`（父会话在别的模式里开的子会话）。
- 卡片的 `mode`、`modeName`。
- 跨模式子会话在侧栏里会按顶层会话显示（后端给的是 `detached: true`），「来自」链接点过去要切模式，这一步没有验证过。

## 没有验证的

- **没有跑任何真实模型。** 上面全部是单元测试（假网关）验证的。`in_scope` 和 `pinkie_mode_ask` 在便宜的小模型上会不会被用对、会不会滥用，要 Mac 端用真实额度看。
- **跨 agent 的 `sessions.create` 不带 `parentSessionKey` 是否被网关接受，没有在真网关上试过。** 这是整个跨模式功能最需要先确认的一点。
- `pinkie_mode_ask` 会让一次工具调用最多等 120 秒。网关对单次工具调用有没有更短的超时，没有确认；如果有，把 `askTimeoutMs` 调小即可，超时后的兜底路径是测过的。

## 测试

Windows、Node 24：

```
node --test tests/session-lineage.test.mjs tests/session-hints.test.mjs tests/mode-architecture.test.mjs tests/user-settings.test.cjs tests/work-cards.test.mjs
```

226 项里 223 过。失败的 3 项（`computer tool discovers the complete driver surface…`、`marathon keeps going while the checkpoint…`、`ticking the on-screen plan or the checkpoint…`）在改动前的同一分支上就失败，和这次改动无关。

全量 `node --test tests/*.test.cjs tests/*.test.mjs` 在这台 Windows 上改动前是 1656 项、69 项失败（多数是依赖 Mac、WebKit 或已安装 App 的测试）。

## 进度

- [x] 整合底座分支
- [x] 子会话：`in_scope`、汇报全文、跨模式子会话、`pinkie_mode_ask`、时机提醒、手册、测试、文档
- [ ] 界面：把跨模式的字段接到侧栏和卡片上
- [ ] 性能：后台休眠、按实测卡顿自动减负
- [ ] 界面和 IP 感的审计与修改
- [ ] 前后端重复、用不到的入口清理
