# 极致思考四档动效视频提示词

四张 `*-source.png` 是 1254×1254 透明原图，最适合做图生视频。界面使用的 384×384 版本在 `ui/assets/laolao-deep-think-*.png`。

建议输出：正方形、4～5 秒、24fps、首尾完全一致、固定镜头、无文字。优先导出带 Alpha 的 WebM（VP9）或 MOV（ProRes 4444）。如果平台不支持透明视频，就用纯黑背景，后期以 Screen/Add 混合去底。不要用绿幕，以免粉色和珍珠边缘染绿。

## Ⅰ 基础档

参考图：`source/tier-1-base-source.png`

```text
Use the reference image as the exact visual identity and composition. Create a 4-second perfectly seamless loop for a tiny premium magical desktop UI control. Locked camera, transparent background if supported. Keep the crystal compass shape, proportions, materials and all four pearl nodes unchanged. The central rose crystal breathes very gently from 100% to 103% brightness and back. A soft champagne highlight travels once clockwise around the outer compass ring. The four pearl nodes illuminate one after another in an orderly clockwise sequence, then return exactly to the first frame. Extremely restrained particles, no camera movement, no zoom, no morphing, no new objects, no text, no letters, no logo, no watermark, no background, no white rectangle. Preserve crisp alpha edges and readability at 32 pixels.
```

## Ⅱ 加强档

参考图：`source/tier-2-boost-source.png`

```text
Use the reference image as the exact visual identity and composition. Create a 4-second perfectly seamless loop for a compact magical desktop UI control. Locked camera, transparent background if supported. Keep the central rose crystal fixed and structurally unchanged. The gold ribbon and pink ribbon circulate smoothly in opposite visual rhythms around the crystal without changing their silhouette. The two satellite lights complete one balanced orbit and exchange a soft pulse exactly twice, suggesting two coordinated upgrades. Add only a few tiny warm sparks that appear and dissolve in place. End on the exact first frame. No camera movement, no zoom, no shape melting, no extra rings, no new objects, no text, no letters, no logo, no watermark, no background, no opaque card. Preserve crisp alpha edges and readability at 32 pixels.
```

## Ⅲ 全开档

参考图：`source/tier-3-full-source.png`

```text
Use the reference image as the exact visual identity and composition. Create a 5-second perfectly seamless loop for a high-power magical desktop UI control. Locked camera, transparent background if supported. Preserve exactly six major violet crystal petals and exactly six outer spark nodes; never add or remove petals. The inner halo rotates slowly clockwise while the fine outer orbit rotates slowly counter-clockwise. The six nodes illuminate one by one, then all six synchronize in one refined magenta pulse through the central core. Crystal facets shimmer locally but the emblem silhouette stays perfectly stable. Return to the exact first frame. No camera movement, no zoom, no morphing, no flower opening, no extra petals, no text, no letters, no logo, no watermark, no background, no opaque square. Restrained bloom, crisp alpha edges, readable at 32 pixels.
```

## Ⅳ 长跑档

参考图：`source/tier-4-marathon-source.png`

```text
Use the reference image as the exact visual identity and composition. Create a 5-second perfectly seamless infinite loop for a persistent overnight-work magical desktop UI control. Locked camera, transparent background if supported. Preserve the blue-violet infinity ribbon, protected pink crystal lantern core, checkpoint star and outer halo exactly. A silky light current travels continuously through both loops of the infinity ribbon, crossing the center without changing the ribbon shape. The lantern heart performs one slow reassuring breath. The checkpoint star emits one small pulse that travels around the outer halo and returns to it at the final frame. The motion must feel tireless, safe and calm, not frantic. No camera movement, no zoom, no morphing, no liquid deformation, no clock numbers, no new objects, no text, no letters, no logo, no watermark, no background, no opaque card. Preserve crisp alpha edges and readability at 32 pixels.
```

## 交回 App 时的文件名

- `laolao-deep-think-base.webm`
- `laolao-deep-think-boost.webm`
- `laolao-deep-think-full.webm`
- `laolao-deep-think-marathon.webm`

四段视频都应静音、自动循环、无交互。拿到文件后再接入 UI；PNG 会保留为视频解码失败时的兜底图。

## 已接收并接入的成片

原始生成视频保存在 `source-video/`，映射如下：

- `tier-1-base.mp4`：玫瑰水晶罗盘
- `tier-2-boost.mp4`：粉金双轨水晶
- `tier-3-full.mp4`：紫晶六瓣阵列
- `tier-4-marathon.mp4`：蓝紫无限环

运行 `scripts/render-deep-think-videos.sh` 会生成界面使用的 WebM 和同帧 PNG 封面，不会重新合成或改写视频内容。
