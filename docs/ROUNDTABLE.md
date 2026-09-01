# 灵感圆桌

灵感圆桌是四模式聊天右侧的独立入口，和派对空间平级，不属于第五模式。

- 服务地址：`http://127.0.0.1:18891/`
- 独立记录：`~/Library/Application Support/SuperPinkie/roundtable/roundtable.sqlite3`
- 只列出已经配置且可用的中转/API 模型；排除本地 CLI、图片、语音和嵌入模型。
- 每个席位单独选模型。开始讨论前，至少需要三位成员、三个不同模型。
- 默认分三轮：交换主意、交叉检验、收拢共识。前一轮公开发言会传给后一轮。
- 七位成员只注入名字和席位职责，不注入口癖、固定文风或能力限制；称呼用户为“铲屎官”。
- 每次调用都使用临时工作区、唯一会话和无工具配置快照；不改写 `~/.openclaw/openclaw.json`，不读取项目文件、其他模式、派对空间或私人聊天。
- 页面只展示公开回复、阶段和场景动作，不展示隐藏思维链。
- 背景按本机时间自动切换：05:00–15:00 清晨，15:00–20:00 黄昏，20:00–05:00 夜晚；图片预加载后慢速交叉淡化。

验证：

```bash
python3 -m unittest tests.roundtable_service_test
node --test tests/roundtable_ui.test.cjs
python3 services/roundtable/server.py --port 18891
```
