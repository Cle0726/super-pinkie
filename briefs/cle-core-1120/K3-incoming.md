# K3 待搬入的碧琪补丁（incoming）

K3 把 `patch/` 里改上游的补丁搬进 `cle-core` 源码。这里登记 K3 开始以后新加、还没搬的补丁；搬完从这里划掉，记到 `PATCH-MAP.md`。

| 补丁 | 加入时间 / PR | 改什么 | 落点 | 怎么生效 | 搬进 cle-core 时 |
|---|---|---|---|---|---|
| `patch/apply-brand-text.mjs`（标记 `pinkie-brand-text:v1`） | 11-24，`feat/k4-no-openclaw`（用户 07:55：界面上不再出现 OpenClaw） | 控制台里用户看得到的「OpenClaw」换成「C.le.」：品牌位、登录页、面包屑、工具调用报错、斜杠命令说明、助手名默认值、语音提示、设置说明、21 个语言包、`sw.js` 通知标题。不动技术名字和给模型看的内部提示。 | `dist/control-ui/assets/{index,chat-page,config-page}-*.js`；21 个语言包 `{i18n,ar,de,es,fa,fr,hi,id,it,ja-JP,ko,nl,pl,pt-BR,ru,th,tr,uk,vi,zh-CN,zh-TW}-*.js`；`sw.js` 由 `tools/ui-parity/bundle.py` 的 `brand_service_worker` 改 | 已烤进 `ui/runtime`（`bundle.py install` 两个平台都装），安装器不用跑 | 在 cle-core 的控制台界面源码和语言包里直接改文字；同时把后端给用户的约 30 条报错和提示也改掉（见 `progress/K4.md`「被 #54 / #67 / #74 占着」）。之后删掉本补丁和 ui/runtime 里复制来的语言包 |
