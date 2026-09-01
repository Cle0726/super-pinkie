# 派对招牌背景融合

## 当前版本：三小马群像透明招牌

用户已选定新的三小马聚会设计。正式素材及抠底说明见 [brand-ensemble-v2/README.md](brand-ensemble-v2/README.md)。下述单人版已备份到 `brand-ensemble-v2/party-brand-before-ensemble.png`；旧脚本仅适用于旧白底源图，不可用于当前群像。

## 上一版本：单人招牌透明 PNG

用户确认继续做程序化抠底后，采用 `matte-brand.py` 对白底高清稿精确处理，没有重新绘制头像或艺术字。

- 输入备份：`laolao-party-brand-white-source.png`，2172×724 RGB。
- 输出：`../../ui/assets/laolao-party-brand-v1.png`，2172×724 RGBA，真实 Alpha 透明。
- 外围白底及确认过的鬃毛、文字空隙被移除；眼白、皇冠珍珠和内部高光保留。边缘做去白色预混处理。
- 页面采用正常混合，不再依赖 `multiply`；招牌外层没有背景、边框或阴影。
- 在深色、粉色、蓝色背景上复核，并验证四周像素 Alpha 全为 0。
- 复现需要 Pillow、numpy：`python matte-brand.py laolao-party-brand-white-source.png ../../ui/assets/laolao-party-brand-v1.png`。

## 前一次生成式尝试（已替换）

- 工具：内置 image_gen 图像编辑，不使用 CLI 或额外 API 密钥。
- 编辑前原图：`laolao-party-brand-before-blend.png`（保留备份）。
- 页面素材：`../../ui/assets/laolao-party-brand-v1.png`，2172×724 RGB PNG。
- 此素材不是 Alpha 透明 PNG。首次透明背景请求生成了假棋盘格，未采用。
- 最终采用干净白底编辑稿，页面移除卡片底，并用 `mix-blend-mode: multiply` 让白色不遮住底下的玻璃背景；不对整张招牌降低透明度。
- 保持原有公主头像、细艺术字和布局；生成式编辑不保证像素级一致。

## 前一次提示词（留档）

Use case: precise-object-edit / background cleanup for an existing UI logo. Image 1 is the edit target. Change ONLY its pale pink background to perfectly flat pure white RGB #FFFFFF, edge to edge, including every negative-space gap between curls, letters and swashes. Absolutely NO checkerboard or gray checks, NO gradient, NO pink tint in the background, NO shadows, NO border, NO surrounding card. Keep all existing colored foreground intact: left Pinkie princess portrait with magenta curls, small crown, single horn, blue eyes and white eye whites; right exact delicate pink Chinese calligraphy '派对空间', same fine thin strokes, swashes and star accents. Preserve expression, proportions, color palette, placement and crisp anti-aliased edges. Do not crop or restyle. This asset will be blended against a UI background in code, so the background must be completely uniform pure white with no texture. Keep the wide 3:1 size, high resolution 2172x724 or higher, no subtitles or extra text.
