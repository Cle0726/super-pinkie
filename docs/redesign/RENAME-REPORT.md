# Rename report — 碧琪 and the five modes

Branch `oc/rename`, worktree `~/release-superpinkie/wt/rename`.
Scope: the new version paths only (`services/cle-studio/**` excluding vendor folders,
`services/mode-architecture/**`, `services/project-scope/**`, `services/party/**`,
`services/roundtable/**`, `services/tts/**`, `services/messaging-connect/**`,
`services/wechat-connect/**`, `patch/**`) plus the tests that assert the old text.

## 1. Character: 碧琪 → 碧琪 (male), product name → C.le.

`碧琪` keeps its Latin spelling with a space. Inside Chinese sentences it is
written with spaces around it (`给碧琪发消息`), never in front of Chinese
punctuation (`还没连上碧琪，稍等`). Where the text referred to the character with
`她`, it now says `他`.

| File | Visible occurrences changed |
|---|---|
| `services/cle-studio/openclaw.plugin.json` | 1 (manifest description) |
| `services/cle-studio/package.json` | 2 (`超級碧琪` → C.le., name → 碧琪) |
| `services/cle-studio/static/legacy/laolao-ask-user.js` | 5 |
| `services/cle-studio/static/legacy/laolao-ask-user.css` | 1 |
| `services/cle-studio/static/legacy/laolao-capabilities.js` | 15 (incl. `她` → `他`) |
| `services/cle-studio/static/legacy/laolao-companion.js` | 28 (incl. 2 pronouns) |
| `services/cle-studio/static/legacy/laolao-companion.css` | 6 (incl. 2 pronouns) |
| `services/cle-studio/static/legacy/laolao-context-compact.js` | 1 |
| `services/cle-studio/static/legacy/laolao-image-viewer.js` | 2 |
| `services/cle-studio/static/legacy/laolao-learning-library.js` | 4 |
| `services/cle-studio/static/legacy/laolao-learning-stage.js` | 12 |
| `services/cle-studio/static/legacy/laolao-live-voice.js` | 1 |
| `services/cle-studio/static/legacy/laolao-material-preview.js` | 1 |
| `services/cle-studio/static/legacy/laolao-plan.js` | 1 |
| `services/cle-studio/static/legacy/laolao-rich.css` | 1 |
| `services/cle-studio/static/legacy/laolao-rich.js` | 6 |
| `services/cle-studio/static/legacy/laolao-usage-stats.css` | 1 |
| `services/cle-studio/static/legacy/laolao-usage-stats.js` | 1 (`超級碧琪` → C.le.) |
| `services/cle-studio/static/legacy/laolao-web-gpt-collab.js` | 10 (+1 `碧琪 App` → `C.le. App`) |
| `services/cle-studio/static/legacy/laolao-workbench-code.js` | 5 |
| `services/cle-studio/static/legacy/laolao-workbench.css` | 1 |
| `services/cle-studio/static/legacy/laolao-workbench.js` | 24 |
| `services/mode-architecture/app-browser.mjs` | 4 |
| `services/mode-architecture/app-guide.mjs` | 8 (+ `超級碧琪 App` → `C.le. App`) |
| `services/mode-architecture/ask.mjs` | 2 (answer prefix) |
| `services/mode-architecture/companion.mjs` | 2 |
| `services/mode-architecture/index.mjs` | 15 (incl. watchdog/compaction task names, plugin name → `CLE Kk · C.le. 执行控制层`) |
| `services/mode-architecture/learning.mjs` | 3 |
| `services/mode-architecture/learning-pact.mjs` | 1 |
| `services/mode-architecture/reply-hygiene.mjs` | 2 (`ADDRESSED` regex) |
| `services/mode-architecture/reasoning.mjs` | 1 |
| `services/mode-architecture/rich-runtime.mjs` | 1 |
| `services/mode-architecture/setup.py` | 12 (persona templates) |
| `services/mode-architecture/web-gpt-activity.mjs` | 2 |
| `services/mode-architecture/web-gpt-connection.mjs` | 2 |
| `services/mode-architecture/workbench.mjs` | 6 |
| `services/mode-architecture/workbench-lsp.mjs` | 1 |
| `services/mode-architecture/openclaw.plugin.json` | 1 |
| `services/project-scope/index.mjs`, `openclaw.plugin.json` | 1 + 1 (plugin display name) |
| `services/party/identities.json` | 1 (pinkie display name) |
| `services/party/server.py` | 2 (+ "小马名字" → "这些名字") |
| `services/roundtable/server.py` | 2 (+ 2 × "小马" → "伙伴" in validation text) |
| `services/tts/edge_tts_server.py` | 1 |
| `services/messaging-connect/manager.mjs` | 1 (account display name) |
| `services/messaging-connect/gateway.mjs`, `openclaw.plugin.json` | 1 + 1 |
| `services/messaging-connect/apply-qq-adapter.mjs` | 1 (`超级碧琪` → `C.le.`) |
| `services/wechat-connect/gateway.mjs`, `index.mjs`, `openclaw.plugin.json` | 1 + 1 + 1 |
| `services/wechat-connect/README.md` | 1 |
| `patch/apply-chat-timeline.mjs` | 2 (process-card titles) |
| `patch/apply-chat-math.mjs` | 0 label changes (see below) |

## 2. Mode labels

雅叙 / Le Chat, 营造 / Œuvre, 堇思 / Pensée, 习作 / Étude, 挥洒 / Carte Blanche.
In Chinese copy the short form is used as the mode name (`习作模式`, `切到挥洒`).
The French halves are never shown in these paths — the only French labels live in
`services/cle-studio/src/rooms/rooms.js`, which is Claude's file and was skipped.

| File | Change |
|---|---|
| `services/cle-studio/static/legacy/laolao-capabilities.js` | `MODES` label list + fallback label |
| `services/cle-studio/static/legacy/laolao-memory.js` | `modeLabels` |
| `services/cle-studio/static/legacy/laolao-companion.js` | `MODE_NAMES` (settings dialog title) |
| `services/cle-studio/static/legacy/laolao-workbench.js` | `MODE_NAME` map + 4 comments/ASCII art |
| `services/cle-studio/static/legacy/laolao-workbench.css` | 3 comments |
| `services/mode-architecture/{index,workbench,learning,learning-library,learning-pact,rich-runtime,app-guide,setup}.mjs/.py` | error text, tool descriptions, rule headings, persona headings |
| `services/messaging-connect/{manager,gateway}.mjs`, `README.md` | 学习/项目/无限 → 习作/营造/挥洒 |
| `services/wechat-connect/{gateway,index}.mjs` | 无限模式 → 挥洒模式 (incl. the injected adapter string) |

## Deliberately left alone

- **`ui/injections/**`, `ui/assets/**`, `ui/party/**`, `ui/roundtable/**`, `installer/**`** — the old
  live app, out of scope. `ui/party/party.js` still has `pinkie:'碧琪'`; the test
  `tests/party-room-art.test.cjs` "all six frontend pony names…" therefore still fails
  (it compares `ui/party/party.js` with `services/party/identities.json`). Pre-existing, unchanged.
- **Identifiers** — `pinkie.*` RPC names, `data-pinkie-*`, `PINKIE_*`, `pinkie-*` plugin ids,
  `laolao-*` file names, `pinkie-buddy__*`/`pk-*` CSS classes, `localStorage` keys, agent ids,
  session keys, account ids (`pinkie-learning`, `pinkie-project`).
- **Filesystem paths** — `/Applications/超級碧琪.app/...` in `mode-architecture/index.mjs`,
  `setup.py`, `wechat-connect/{gateway,index}.mjs` and `patch/apply-local-unrestricted-policy.mjs`.
  These must match the installed bundle; I added a comment in the patch explaining why.
- **`services/party/setup.py`** — the `old_name='碧琪'` constant is the migration key for files
  written by the previous release. It now *also* recognises the `party_soul('碧琪', …)` template
  so an install upgraded from the current release still migrates (that is what made
  `test_address_migration_only_changes_exact_owned_party_template` pass).
- **"小马"/小马 names (紫悦, 云宝, 珍奇, 柔柔, 苹果嘉儿)** — separate characters, not the assistant.
  Only "小马名字"→"这些名字" and "三位小马"→"三位伙伴" wording changed in party/roundtable.
- **"聊天模式" in `laolao-web-gpt-collab.js`** — refers to ChatGPT's chat mode, not our 雅叙 mode.
- **"学习笔记", "学习约定", "学习资料", "互动学习"** — ordinary education vocabulary, not mode names.
- **"先生"** — the established form of address for the user, unchanged.

## Unsure / worth a second look

1. The agent persona templates in `services/mode-architecture/setup.py` still call the user
   "先生" and the character now says "自称只用碧琪". That reads fine, but if the male
   character should address the user differently this is the file to change.
2. `services/cle-studio/static/legacy/laolao-web-gpt-collab.js` says "碧琪聊天、项目、权限…",
   i.e. the mode names were already spelled out as common nouns there. I did not rewrite them
   to 雅叙 because they read as concepts, not mode labels — say the word if they should change.
3. `laolao-companion.css` still ends the menu headings `碧琪粉` (colour), a leftover of the
   pink theme name. It is a design token description, so I left it.
4. Party/roundtable still *are* a pony ensemble in the old UI; only the assistant was renamed.
   If the party cast should also be de-ponyfied, that is a separate content task.

## Verification

- `node --test tests/ask-user-ui.test.cjs tests/user-settings.test.cjs tests/learning-interaction.test.mjs tests/learning-notes-model.test.mjs tests/progress-ui.test.cjs tests/web-gpt-collab.test.cjs tests/web-gpt-connection.test.mjs tests/mode-architecture.test.mjs tests/roundtable_ui.test.cjs` → 206/206 pass.
- `node --test tests/chat-tool-timeline.test.mjs` → 20 pass / 7 fail. All 7 fail on the untouched
  tree too (`git stash`): the bundled fixture no longer matches the patcher
  (`cannot identify the native internal-message filter`). My change takes that file from 9 to 7
  failures because two title assertions now match.
- `python3 -m unittest party_service_test` 42 OK, `roundtable_service_test party_usage_test` 15 OK.
- Full JS suite `node --test 'tests/*.test.cjs' 'tests/*.test.mjs'`: **821 pass / 11 fail**, exactly
  the same 11 failures as before the change (verified by stashing). Note `node --test tests/` with a
  bare directory does not work on Node 24 (it tries to load `tests` as a module), hence the glob.
- `cd services/cle-studio && node build.mjs` → OK (`cle-studio ui 93b858daeb51 js 38.1 KB css 30.9 KB`).
  `esbuild` was missing from the empty `node_modules`; installed with `npm ci` (lockfile pin 0.28.2).
