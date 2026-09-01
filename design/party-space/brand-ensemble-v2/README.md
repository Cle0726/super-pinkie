# 派对空间招牌 · 三小马聚会（已采用）

用户确认采用这版侧栏招牌。已去除烘焙棋盘格并替换项目素材，同步本机 App。

- 设计生成：内置 image_gen；真实透明处理：沿用用户确认的程序化抠底流程，不重绘主体。
- 设计：碧琪、紫悦、云宝组成互动小群像，细粉色「派对空间」艺术字，气球和彩带呼应用户选定的跳舞群像背景。
- [原始预览](./party-brand-ensemble-preview.png)：2172×724 RGB PNG，保留用户确认的原图，不作为运行素材。
- [正式透明素材](./party-brand-ensemble-transparent.png)：2172×724 RGBA；1,180,628 个全透明像素，37,992 个抗锯齿边缘像素；四周、文字和人物间的空隙为真实透明。所有不透明主体像素与原图一致，三匹小马的眼白保持不透明。
- 正式路径：`../../../ui/assets/laolao-party-brand-v1.png`；服务仍使用 `/brand.png`，无需改路由、样式或重启后端。
- 旧招牌备份：`party-brand-before-ensemble.png`；新稿仍保持正常混合，不使用白底混合技巧或透明度降低来遮掩底板。
- 聊天背景已经使用用户选定的跳舞群像并同步到本机 App；透明面板、动画、其他模式及人格均未改动。

## 透明处理与验证

`matte-ensemble.py` 仅接受原始预览的 SHA-256 `486c4796bf9baeb0b97287f3578f82c57a8bf4600a8107fafa851ca8f221adee`。按外围连通底色和人工核对的内部空隙抠底，保留封闭的眼白和高光；局部去除灰白底的边缘预混。另移除了紫悦独角上方一处孤立生成杂点。禁止将此蒙版直接用于其他图。

```sh
python matte-ensemble.py party-brand-ensemble-preview.png party-brand-ensemble-transparent.png /tmp/pinkie-ensemble-alpha-qa
```

依赖 Pillow、numpy。已检查深色、粉色、蓝色背景和 240×80 侧栏预览；自动回归覆盖透明外围、内部空隙、眼白和无卡片容器。随后检查页面实际 217×72 显示尺寸，确认使用原尺寸图片、正常混合与透明外层。

## 透明生成尝试（未采用）

内置工具再次请求透明背景后仍返回 RGB 棋盘格，因此没有拿它覆盖用户批准的原稿。此次请求如下，后续改为上述可复现抠底：

```text
Use case: background-extraction. Input image 1 is the exact approved logo to edit, NOT a loose style reference. Remove ONLY the baked gray-and-white checkerboard backdrop and replace it with genuine alpha transparency (RGBA PNG, alpha=0 outside the artwork and in negative-space holes). Keep the three ponies, Pinkie's delicate crown, their faces, poses, eye whites and highlights, the balloons, thin strings, ribbon and the exact Chinese calligraphy "派对空间" unchanged. Preserve the original 3:1 composition, scale, canvas padding, sharp edges, illustration colors, and text. No redraw or reinterpretation. No new objects or text. IMPORTANT: return an actually transparent cutout, NOT a rendered representation of transparency. Do NOT draw a checkerboard, white background, colored canvas, panel, border or drop shadow. Keep all opaque white foreground details inside eyes and highlights. High-resolution clean antialiased edges for a translucent application sidebar.
```

## 完整生成提示词

```text
Use case: logo-brand.
Asset type: a NEW illustrated Chinese wordmark/header asset for a pony group-chat desktop app. One wide 3:1 image, target 3072x1024 or highest available detail. This is the artwork ONLY, not a screenshot of an app.
Input image 1 is the CURRENT HEADER DESIGN reference: use its exact Chinese name, compact horizontal proportions and delicate pink lettering as continuity, but redesign the artwork.
Input image 2 is the user's SELECTED PARTY ROOM BACKGROUND and character/style reference: a lively gathering of many G4 My Little Pony friends, pink and lavender streamers, balloons, soft golden lantern light. The new logo must belong to that ensemble-party world.
Primary request: create a fresh, refined "friends gathering for a party" header. Left approximately 38%: one cohesive miniature celebration vignette of three recognizable pony friends gathered naturally together, NOT circular avatars or detached portrait stickers. Princess Pinkie Pie in front with pink coat, hot-pink curly mane, blue eyes, one slender horn and a SMALL delicate gold tiara; Twilight Sparkle peeking and smiling beside her, lavender coat, indigo mane with pink stripe; Rainbow Dash leaning in from the other side, cyan coat and rainbow mane. Heads plus naturally connected upper shoulders, little gestures and eye contact make it a shared moment. Slightly layered silhouettes with clear facial features, no long necks, no full bodies, no necklace, no big crown. A restrained small pair of pastel balloons and ONE flowing ribbon tie the group into the lettering, not an ornate frame.
Right approximately 62%: exact four simplified Chinese characters "派对空间", once only, beautifully drawn fine pink calligraphy, graceful light strokes, clearly readable character structure, delicately varied stroke width, elegant airy spacing, a single subtle calligraphic ribbon flourish underneath, no overlapping ornaments across the characters. Make the wordmark legible at small sidebar size. No heavy bubble font, no bold black outline, no excessive curls or glitter, no English, no subtitle. The secondary tagline is supplied by the app separately and MUST NOT be baked into the image.
Style: clean polished G4 2D cel-shaded illustration, precise colored outlines, refined but cheerful; harmonious rose-pink, lilac and small sky-blue accents matching input image 2. No 3D, no plastic shine, no photorealism, no chibi redesign, no sparkly royal crest.
Background requirement: genuinely transparent RGBA PNG, alpha 0 outside the artwork and inside negative-space gaps. Keep eye whites and highlights opaque. No white or pink rectangular canvas, no card, no panel, no border, no drop-shadow plaque, NO printed checkerboard. Isolated artwork with crisp antialiased edges, 5% outer padding. One single logo proposal, not multiple versions, not a sheet of options.
```
