# 例外增量（每个 PR 一个文件）

界面 PR 常常要给 `tools/health/exceptions.json` 里同一条加数（比如头片段 `laolao-head.fragment.html`、`regions.json` 的行数，新注入文件只能在那里登记）。
以前每个 PR 都改同一条的 `value` 和 `reason`，同时开着的 PR 一合一个就互相冲突。现在改成：

- **不要改 exceptions.json 里已有条目的数字。** 在这个目录新建一个文件，文件名用分支名，比如 `feat-desktop-app-install.json`：

```json
[
  {"file": "ui/injections/laolao-head.fragment.html", "metric": "lines", "add": 2, "reason": "laolao-desktop-apps.css / .js 只能在这里登记加载（?v=@hash），功能全在新文件里。"},
  {"file": "ui/injections/regions.json", "metric": "lines", "add": 2, "reason": "两个新文件各登记一行，没有新区域、新根选择器或跨区域放行。"}
]
```

- 生效值 = exceptions.json 里的 `value` + 这个目录里所有 `add` 之和。ratchet、`measure.mjs --write-baseline` 和 CI 的目标分支对比都按生效值算，所以：
  - 仍然只放行**准确计数**（多一行、少一行都会红）；
  - 加数仍然算「抬高例外」，CI 的 health 检查照样要协调者逐条认可；
  - 别的 PR 先合进 main 后，你的分支合 main 不会冲突，生效值自动变成两边之和，正好等于合并后的实测。
- `add` 只能是正整数，只能加在 exceptions.json **已有**的同一条 file + metric 上。全新的例外照旧写进 exceptions.json。
- 只读 `.json` 文件；这个 README 不算。
