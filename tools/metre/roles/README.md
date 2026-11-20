# Metre 角色验收工具

这些命令不会发起外部模型调用：

```sh
node tools/metre/roles/lint-cards.mjs --all-33 --samples
node tools/metre/roles/compose.mjs reviewer path/to/brief.txt
node tools/metre/roles/compose.mjs --matrix PROVIDER/MODEL > pilot-plan.json
python -B -X utf8 tools/metre/roles/smoke-isolated.py --runtime-root PATH_TO_EXISTING_METRE_ISO --out NEW_EVIDENCE_FOLDER
```

- `compose` 为同一份简报生成 A/B/C 三组数据。`--matrix` 将 8 道题展开成 48 条待跑记录，每题三组简报哈希相同、模型 ID 相同。`prepared-not-run` 不是实验结果。夹具、检查项和预埋问题独立存放，检查项与预埋问题不能发给执行模型。
- 实跑时每条记录使用同样内容的全新隔离项目。A/B 用项目模式 (`tools/metre/iso/ask.py` 可明确固定模型)；C 必须走正式角色派发路径产生血缘和卡快照，不能把 `messagePreview` 直接发给裸 `roles` 会话。手工贴卡只用于 B。保存实际会话 JSONL、模型/厂家、usage、工作目录和验证输出；不要把公式的分母改为只有成功的记录。
- `smoke-isolated.py` 只复用隔离副本中的运行时文件，创建**全新**配置、回环网关端口和本地模拟模型。不会读正式会话或转发到模型服务。保存起草、采用、丢弃、派活、汇报和请求原文的可复查证据。请求体不入库；报告只写采样数量、是否命中和 SHA-256。这个烟测不证明模型质量、真实 token 数、外部模型厂家或真机安装通过。
- 复核真实样题，必须先确认实际执行模型和判分模型是不同厂家。厂家未知、只有路由名、会话文件缺失、额度限制而没跑全，一律按 `ACCEPTANCE.md` 记没测或没过，不能用脚本/模拟结果补分。
