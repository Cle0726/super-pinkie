---
name: 可编辑PPTX生成
description: >
  生成真正可编辑的 PowerPoint / PPTX，把 AI 生成的 PNG 格式 PPT 页面重建为可编辑 slide，
  以及把 chart page / figure plate 先走 HTML→PNG 再嵌入 PPTX 的可编辑交付流程。
  当用户要求可编辑 PPT、可编辑 PPTX、PNG 转可编辑 PPT、图片 PPT 转可编辑、
  原生对象分层、分图层 PPT，或希望把主题、大纲、笔记、文章、粗略想法、PNG 幻灯片截图
  转成文字、形状、图表、表格、图标和图片都能分别选中的分层 `.pptx` 时使用。
---

# 可编辑 PPTX 生成

使用 skill 内嵌工具 `scripts/editable-pptx/` 生成高可编辑 `.pptx`。目标是 PPT 原生对象分层，不是整页图片。

## 核心原则

- 文字用 PPT 原生文本框。
- 色块、线条、卡片和装饰元素用 PPT 原生 shape。
- 表格和图表优先用 PPT 原生 table / chart。
- `SVG` 优先承载图标、流程图、结构图、简单插画和需要继续拆层的结构元素。
- `PNG` 优先承载照片、复杂合成、主视觉、截图、纹理和不可拆的视觉参考。
- 两者都可选时，优先选 `SVG` 作为结构资产，`PNG` 只作为参考图或不可拆的视觉素材。
- 图表页 / figure plate 不要默认拆成很多 shape/text；优先走 chart HTML → headless PNG → 单个 image 资产，再让标题、注释、来源保持原生可编辑。
- 图片只做复杂主视觉、插画、背景氛围图或局部素材。
- 不把标题、正文和关键版式烘焙进图片。
- 生成后必须运行验证脚本，确认不是单图 PPT。

## 审美控制层

生成新 deck 或大幅重建页面前，必须先读取 `references/aesthetic-control.md`，完成一份简短的风格规范，再写输入 JSON。不要直接套默认模板。
如果 deck 里包含 chart page / figure plate，再先读 `references/chart-asset-routing.md`。
如果任务是 PNG / 截图 / 海报转可编辑 PPT，再读 `references/image-reconstruction-manifest.md`，按单图工作目录、像素级坐标和独立裁剪素材重建。

风格规范必须先定下：

- `visualDirection`：一句话说明视觉方向，不使用“高级感、科技感、简约风”这类空泛词。
- `theme`：字体、背景、主色、强调色、线条色和弱化文字色；最终必须写入输入 JSON 的 `theme`。
- `layoutGrammar`：标题区、内容区、数据区、引用区、页脚和留白的固定规则。
- `objectPolicy`：哪些元素必须是 PPT 原生文本 / shape / chart / table，哪些复杂视觉允许作为图片。
- `densityRule`：每页信息密度、最大文本行数和最小字号。

生成 JSON 时，把风格规范落到具体对象：

- 通用页可用 `cover`、`principle`、`workflow`，但必须覆盖默认 `theme`。
- 需要明显审美差异的页面优先用 `custom`，显式写 `elements`，不要只依赖默认布局。
- 图片只承载氛围、照片、插画或复杂背景；标题、正文、数据和关键结构必须保留为可编辑对象。
- 每页都要能说明“为什么这页长这样”，不能只说“更美观”。

## Chart / Table 支持边界

当前 v1 只承诺简单 PPT 原生 chart / table；复杂图表页默认走 chart HTML→PNG 路线：

- chart：单系列 `labels + values + seriesName` 的基础 native chart 仍可用在简单趋势 / 对比页。
- table：二维 `rows`，首行 header，统一边框、基础字体和填色。
- shape：仅稳定支持 `rect`、`roundRect`、`parallelogram`、`ellipse`。
- 图表页 / figure plate：散点图、森林图、组合图、气泡图、多面板 scientific figure plate、带复杂注释的 data-viz，一律视为“图表资产页”。
  - 不要把 chart body 拆成很多 shape / text。
  - 先用 `chart-picker` 选图，再用 `echarts-chart` 产出 HTML。
  - 用 headless 浏览器把 HTML 渲染成 PNG。
  - 在 PPTX 里，chart body 用 `type: "image"`；如果是多面板 figure plate / dashboard，每个逻辑图表面板必须是一个独立 `chart-body` image，而不是整页合成一个大图层。
  - 标题 / 结论 / 注释 / 来源继续用 PPT native text / shape。
- `custom` 和 `png-rebuild` 中仍可以手写 `type: "chart"` / `type: "table"`，但只适合简单 native 对象，不要拿它们硬转复杂 figure plate。

不要承诺当前工具已经支持多系列、堆叠、双轴、瀑布、treemap、sankey、network、复杂统计图、复杂透视表或条件格式表的 native 重建。

超出边界时：

- 如果用户明确要 native chart / table，可考虑扩展生成器或改用 Presentations。
- 如果用户要的是 chart page / figure plate 的交付效果，优先保真：chart HTML→PNG，再把 PNG 作为单个图层放进 PPTX。
- 外部图表工具输出是 chart body 的正式交付资产，但它的可编辑边界在图表外圈，不在图表像素内部。

验证脚本通过后仍需人工检查 `manifest.json`、预览图和 chart / table 可读性；当前 XML 验证不等于 chart / table 语义验证。

## 图表页 / figure plate 工作流

当用户给的是图表页、论文 figure plate、咨询图板、散点图 + 注释页、森林图、组合图或任何“主信息由数据可视化承载”的页面时：

1. 先判断它是不是 chart page，而不是普通海报截图。
2. 如果图表类型不明确，先用 `chart-picker` 选出唯一推荐图形；如果需要代码，再用 `echarts-chart` 生成 ECharts / HTML。
3. 把图表逻辑写成独立 HTML 文件，再用 headless Chromium 渲染成 PNG。
4. 在 PPTX 中，按逻辑面板插入 chart body：
   - 单图表页：1 个 `image`。
   - 多面板 figure plate / dashboard：每个面板 1 个独立 `image`，例如 12 城市小图必须是 12 个 `chart-body-*`。
5. 标题、结论、来源、脚注和页码继续用 native text / shape。
6. 保留 `html`、`png`、`data`、`chart-manifest` 和必要的 `panelManifests`，让每个 chart body 可追溯、可复渲染、可替换。
7. 不要把这些 chart body 再交给 `png-rebuild` 做细碎拆层。

## 使用流程

1. 读用户需求，提取：主题、受众、页数、核心内容、风格偏好。
2. 读取 `references/aesthetic-control.md`，先写 5-8 行风格规范；如果用户给了参考图 / 截图 / 小红书笔记，先把参考拆成可复用的版式规则，而不是照抄图片。若页面里有图表页 / figure plate，再读 `references/chart-asset-routing.md`。
3. 如果用户没给页数，默认生成 3 页：封面、观点页、流程 / 数据页。
4. 基于 `scripts/editable-pptx/examples/editable-demo.json` 或 `scripts/editable-pptx/examples/aesthetic-demo.json` 的结构，创建一个输入 JSON：
   - 默认放在 `outputs/pptx/<project-name>/input.json`
   - `projectName` 使用英文或拼音短名，避免空格和特殊符号
   - `slides[].kind` 优先使用当前工具支持的 `cover`、`principle`、`workflow`、`custom`、`png-rebuild`
5. 调用生成脚本输出 `deck.pptx`、`assets/`、`manifest.json` 和预览图。
6. 调用验证脚本解析 `.pptx` 内部 XML。
7. 抽看生成的 `preview-slide-*.png`。如果明显错位、重叠、文字溢出或审美方向失控，修正输入或工具后重跑。
8. 最终只告诉用户关键路径、验证结果和剩余限制。

## 非图表 PNG → 可编辑 slide 工作流

这个流程只用于普通截图、海报、混合页面和其它不适合做 chart HTML→PNG 的 PNG。

当用户给一张 AI 生成的 PNG / 截图，并要求“变成可编辑 PPT”时：

1. 明确告诉自己：PNG 不能恢复原始图层，只能重建为近似可编辑版。
2. 读取 `references/image-reconstruction-manifest.md`，把这张源图当作一个独立重建单元处理。
3. 读取 / 查看 PNG，识别：背景色、标题、正文、卡片、色块、图标、表格 / 图表、复杂插画。
4. 记录源图原始像素尺寸；手工重建对象优先使用 `unit: "px"` 和 `bbox` / `bbox_xyxy`，不要优先凭百分比粗估。
5. 每张源图输出一个子目录：`assets/png-rebuild-sNN-<source-stem>/`，其中保存 `reconstruction-manifest.json` 和 `crops/`。
6. 照片、logo、复杂 icon、人物、纹理和难以稳定重画的区域裁成独立图片对象；标题、正文、数字、色块、卡片和线条必须写成 PPT 原生对象。
7. 如果这页明显是 chart page / figure plate，停止进入这个流程，改走上面的图表页工作流。
8. 创建 `png-rebuild` 输入 JSON：
   - `sourcePng` 使用图片绝对路径
   - 能看清的文字写进 `reconstruction.objects` 的 `text` 对象
   - 明确色块 / 卡片写成 `shape` 对象
   - 复杂插画、人物、照片和难以拆解的区域交给工具自动裁成独立图片对象
   - 坐标优先用 `unit: "px"` + `bbox`，只有原图尺寸不明确或快速初稿时才用 `unit: "percent"`
   - 如果同时有 `SVG` 和 `PNG`，优先把 `SVG` 当结构来源，把 `PNG` 当视觉校准；不要把 `PNG` 当结构真源
9. 运行 `generate-editable-pptx.mjs`，不要只运行粗重建包装命令，除非用户只要快速初版。
10. 运行验证脚本；检查总 `manifest.json`、单图 `reconstruction-manifest.json`、`crops/` 和预览图。如果对象太少、文字未重建、布局明显偏差，修改 JSON 后重跑。

快速粗重建可用：

以下命令中的 `SKILL_DIR` 是当前 `SKILL.md` 所在目录。作为独立仓库使用时，先在仓库根目录运行 `npm install`。

```bash
SKILL_DIR="/absolute/path/to/可编辑PPTX生成"
node "$SKILL_DIR"/scripts/editable-pptx/reconstruct-png-slide.mjs /absolute/path/to/source.png \
  --project <project-name> \
  --title "PNG 重建页"
```

这个命令只适合非图表 PNG。图表页 / figure plate 不要拿它做默认入口。

## 命令模板

作为独立仓库使用时，先在仓库根目录运行 `npm install`。运行命令前，把 `SKILL_DIR` 设为当前 `SKILL.md` 所在目录；如果是通过 bridge 触发，则使用 bridge 指向的 true source 目录。

```bash
SKILL_DIR="/absolute/path/to/可编辑PPTX生成"
node "$SKILL_DIR"/scripts/editable-pptx/generate-editable-pptx.mjs outputs/pptx/<project-name>/input.json
```

验证：

```bash
SKILL_DIR="/absolute/path/to/可编辑PPTX生成"
node "$SKILL_DIR"/scripts/editable-pptx/validate-editable-pptx.mjs \
outputs/pptx/<project-name>/deck.pptx \
outputs/pptx/<project-name>/manifest.json
```

## 输入 JSON 最小结构

```json
{
  "projectName": "my-editable-deck",
  "title": "PPT 标题",
  "subtitle": "副标题",
  "audience": "目标观众",
  "slides": [
    {
      "kind": "cover",
      "title": "封面标题",
      "subtitle": "封面副标题",
      "visualPrompt": "abstract background, no text"
    },
    {
      "kind": "principle",
      "title": "观点页标题",
      "claim": "这一页的核心判断。",
      "items": [
        { "label": "第一点", "body": "说明文字。" },
        { "label": "第二点", "body": "说明文字。" },
        { "label": "第三点", "body": "说明文字。" }
      ]
    },
    {
      "kind": "workflow",
      "title": "流程页标题",
      "claim": "这一页的核心判断。",
      "steps": ["步骤一", "步骤二", "步骤三", "步骤四", "步骤五"],
      "chart": {
        "labels": ["方案 A", "方案 B", "方案 C"],
        "values": [20, 60, 90]
      }
    }
  ]
}
```

## PNG 重建输入结构

```json
{
  "projectName": "png-rebuild-demo",
  "title": "PNG 重建可编辑 Slide",
  "slides": [
    {
      "kind": "png-rebuild",
      "title": "重建页标题",
      "sourcePng": "/absolute/path/to/source.png",
      "reconstruction": {
        "objects": [
          {
            "type": "text",
            "unit": "px",
            "bbox": [115, 81, 648, 97],
            "content": "从 PNG 看出的标题",
            "style": { "fontSize": 30, "bold": true, "color": "#17211B" }
          },
          {
            "type": "shape",
            "unit": "px",
            "bbox": [115, 259, 432, 178],
            "shape": "roundRect",
            "style": { "fill": "#FFFFFF", "line": "#D7DED8" }
          }
        ]
      }
    }
  ]
}
```

## 图表页 custom 示例

```json
{
  "projectName": "chart-page-demo",
  "title": "Chart Page Demo",
  "slides": [
    {
      "kind": "custom",
      "title": "Therapeutic response across molecular subgroups",
      "minObjects": 6,
      "elements": [
        { "type": "shape", "unit": "percent", "x": 4, "y": 4, "w": 92, "h": 92, "shape": "rect", "style": { "fill": "#FFFFFF", "line": "#FFFFFF" } },
        { "type": "text", "unit": "percent", "x": 7, "y": 7, "w": 76, "h": 6, "content": "Therapeutic response across molecular subgroups", "style": { "fontSize": 22, "bold": true, "color": "#111827" } },
        { "type": "image", "unit": "percent", "x": 7, "y": 14, "w": 86, "h": 62, "path": "charts/therapeutic-response.png", "role": "chart-image" },
        { "type": "text", "unit": "percent", "x": 7, "y": 79, "w": 42, "h": 4, "content": "Source: chart HTML rendered by headless Chromium", "style": { "fontSize": 8, "color": "#6B7280" } }
      ]
    }
  ]
}
```

## 当前限制

- 当前工具是 v1，本地支持 `cover`、`principle`、`workflow`、`custom`、`png-rebuild` 页面。
- 图表和表格能力只覆盖基础 PPT 原生对象；复杂 chart page / figure plate 默认走 HTML→PNG 再入 PPTX，不再强行拆成很多小对象。
- PNG 重建不是“恢复原始图层”；它是视觉临摹。文本和语义对象需要 Codex 视觉判断后写入 JSON。
- AI 生图还没有接真实 API，复杂图片先用本地占位素材；如果用户要求真实主视觉，需要先扩展 `scripts/editable-pptx/generate-editable-pptx.mjs` 的 `createAssets()`。
- 预览图是工具生成的 layout 预览，不等同于 PowerPoint / Keynote 的真实渲染；最终仍以 `.pptx` XML 验证和人工预览为准。
