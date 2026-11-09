---
disable-model-invocation: true
name: pinkie-script-image
description: 批量出图/出片的脚本流水线：网页版 ChatGPT 或 Gemini 出图、桌面豆包出视频，再加本地加工（抠图、切贴纸、拼对比表、深度图、剪影矢量化、去水印）。先生要一次出很多张、要固定画风连出、要把生成的图加工成素材、或说「用那些脚本跑图」时用。
---

# 生图 / 出片脚本流水线

这套东西是从「慢半拍」漫画项目里提炼的：那边每周要出十几张同一画风的图、还要图生视频，
坑全都踩过一遍了。这里把它们变成了不认死目录、不依赖项目 venv 的通用工具。

**核心判断：先确定图从哪来，再决定用哪个引擎。**

| 要什么 | 用哪个 | 为什么 |
|---|---|---|
| 一张好图、要中文理解、要角色一致性 | `--via chatgpt` | 网页版 Plus 账号，出图质量和改图能力最好 |
| 完整尺寸的图、纯文字生视频、纯音频 | `--via gemini` | 出图分辨率高（约 1696×2528），但会拒人像视频 |
| 图生视频（首帧动画） | `--via doubao` | Seedance 2.0/2.5，多账号轮额度，只能图生视频 |
| 一批图要抠图/切贴纸/拼表/做深度 | 下面「本地加工」 | 纯本地运算，不花任何额度 |

## 0. 第一次用：装依赖

```bash
node <本技能目录>/scripts/install.mjs
```

它会检查 python 有没有 PIL / numpy / scipy / opencv，缺了照提示装：

```bash
python -m pip install pillow numpy scipy opencv-python-headless -i https://pypi.tuna.tsinghua.edu.cn/simple
```

深度图还要 `transformers + torch`（第一次跑会下 ~100 MB 模型）。剪影矢量化想要平滑边缘，装 potrace。

## 1. 先体检，别盲跑

```bash
node <本技能目录>/scripts/gen.mjs --doctor
```

输出每个引擎 `ok: true/false` 和**具体的失败原因**。照原因修：

| 原因 | 怎么修 |
|---|---|
| 专用 Chrome 没开 | `node scripts/ensure-chrome.mjs --url https://chatgpt.com/` |
| 没有 chatgpt.com 标签页 | 同上（会自己打开） |
| 豆包没开 / 没带调试端口 | 见下面「豆包」一节 |
| 登录过期 | **这一步只能请先生本人做**：在打开的窗口里登录，碧琪代不了 |

## 2. 出图

```bash
# 一张
node scripts/gen.mjs --via chatgpt --prompt "一只黑猫坐在窗台上，暖米色纸质纹理背景，极简扁平插画" --out 出图/猫-01.png

# 两张候选，带参考图锁角色
node scripts/gen.mjs --via chatgpt --prompt "同一只猫，换成歪头看镜头" --out 出图/猫-02.png --ref 角色定稿.png --n 2

# 指定比例
node scripts/gen.mjs --via chatgpt --prompt "..." --out 出图/竖版.png --aspect 竖
```

- `--aspect` 只认 `竖 / 横 / 方`，会翻成 9:16 / 16:9 / 1:1 写进提示词。
- `--n 2` 会出两份，文件名自动变成 `猫-02-1.png`、`猫-02-2.png`。
- 提示词里会自动补一句「画面里不要出现任何文字、水印或标志」——**中文字一定要另外用代码排**，任何生图模型写中文都会错字。

### 出图提示词怎么写（从项目里学到的）

写清五样，缺一样就容易跑偏：**主体**（谁、在干嘛）、**风格**（材质/画法）、**构图**（主体在哪、哪留白）、**色调**（两三个颜色）、**比例**。

要排字的图，明确写「上方三分之一留出干净空白，不要任何文字」。

同一角色连出多张：把第一张满意的当 `--ref` 传进去，后面每张都带它。**这是角色一致性唯一靠谱的办法。**

**生图模型的通病，交付前必查：** 手指/四肢数错、脸变形、乱码假文字、产品 logo 画歪。有问题就重出，别交有瑕疵的图。

## 3. 图生视频（豆包）

```bash
# 先把关掉豆包，让它带调试端口启动
powershell -File scripts/ensure-doubao.ps1

node scripts/gen.mjs --via doubao --prompt "耳朵轻轻动一下，眨眼一次，镜头不动" \
  --first 首帧.jpg --out 出片/镜头01.mp4 --model 2.0 --ratio 9:16 --dur 5
```

硬规矩（项目里用血换的）：

- **只用 Seedance 2.0 或 2.5**。Fast / Mini 的人物质量差到不能用，脚本会拒绝。
- 2.5 是旗舰、5 倍消耗，**只用来做 30 秒**的；其他镜头一律 2.0。
- 首帧必须是 **9:16**，脚本不自动裁——自己先裁好（用 `--first` 给裁好的）。
- 免费额度用完、豆包问要不要用付费额度时，**不要点确认**（点了它会偷偷换 Mini）。同一个号重发最多 2 次，还问就换号。
- **绝不充值、购买、开通套餐**。真用完了就换号，所有号都用完就停，改成代码动画。
- 出片通常 1–3 分钟，忙的时候十几分钟也有。脚本最多等 12 分钟后报对话 id，可以稍后用 `doubao_get.mjs <对话id> <输出.mp4>` 再取。
- 提示词里一定带「不得省略我的所有要求和提示词」——豆包爱偷偷简化。

多账号：`node vendor/doubao_ui.mjs accounts` 看有哪些号，`switch` 切下一个没用完的。

## 4. 本地加工（不花额度，最有价值的一段）

### 抠图（透明底 + 纸贴纸版）

```bash
python scripts/tool.py cutout 图1.png 图2.jpg --out 加工/抠图
```

输出 `<名>.png`（透明）和 `<名>-贴纸.png`（不规则白边+投影）。
原理是「和四边框同色、且和图像边缘连通的区域算背景」，所以主体手里的白板、浅色道具不会被误抠。

**交付前必查**：抠好的图放深色和浅色两种底上各看一次——白边、缺块、头发被吃掉。

### 贴纸表切图

```bash
python scripts/tool.py sticker 贴纸表.png 猫脸 --out 加工/贴纸
```

从「2×2 网格、纯白底、粗描边」的贴纸表里切出一张张透明 PNG，自动加白描边。
出贴纸表的提示词模板：`2×2 grid, separate figures with large white gaps, plain pure white background, bold outlines, no text`。

### 拼对比表（挑图必用）

```bash
python scripts/tool.py sheet 临时/生成/猫 --out 加工/对比表.jpg --cols 3
```

一张图看完所有候选，左上角带文件名。**先生挑图时给他这张，不要一张张发。**

### 深度图（让静图能动 / 2.5D 视差）

```bash
python scripts/tool.py depth 场景.jpg --out 加工/深度
```

出灰度深度图，越亮越近。配合任意前端做视差推拉，静态图立刻就「活」了。

### 剪影矢量化

```bash
python scripts/tool.py silhouette 输出.json 猫=剪影.png --width 900
```

纯黑剪影 → SVG path，能无损放大、能改颜色、能做描边动画。

### 去视频水印

```bash
python scripts/tool.py dewatermark 带水印.mp4 干净.mp4 --ref 首帧.png
```

机位固定的视频，用水印那块的首帧原图补回去，每帧跟光。没首帧就 `--box x,y,w,h` 手动指。

## 5. 一次跑一批（脚本生成的核心用法）

先生要十几张图时，**不要一张条命令地跑**。写一个 bash 循环放后台，跑完再统一看：

```bash
cd 出图工作目录
for name in 假装加班 开会汇报 死亡凝视 疯笑; do
  node <技能>/scripts/gen.mjs --via chatgpt \
    --prompt "$(cat 提示词/$name.txt)" --out "出图/$name.png" --ref 角色定稿.png
done
```

- 放后台跑（`background: true`），别干等；跑完再拼对比表给先生挑。
- 一次别开太多并发：网页版同时只处理一个对话，并发会互相踩。

## 6. 排错表

| 现象 | 真正的原因 | 怎么办 |
|---|---|---|
| 页面一直转圈、发送按钮永远灰的 | **HTTP/2 长连接被代理掐断**（`ERR_HTTP2_PING_FAILED`） | Chrome 必须带 `--disable-http2`，`ensure-chrome.mjs` 已经带了 |
| 提示「找不到输入框」 | 新版界面输入框从 `contenteditable` 变成了 `textarea#pending-home-input`，或者反过来 | 脚本已同时支持两种；还不行就 `snapshot` 看页面真实结构 |
| 发了但没出图 | 被内容策略拒了，或账号额度到顶 | 脚本会把助手的拒绝理由打出来，照着改提示词或换引擎 |
| 豆包说「额度用完」 | 这个号的免费额度光了 | `doubao_ui.mjs switch` 换号；**不要点充值** |
| 豆包模型被换成 Mini | 豆包自己的 bug | 脚本会核对按钮上的模型名，不对就整批作废重提 |
| `cv2` 找不到 | 没装 opencv | `python -m pip install opencv-python-headless` |

## 7. 交付前

- 图：**用 `read` 打开原尺寸亲眼看**，再缩到 300 像素宽看一眼小图里认不认得出主角。
- 一批图：拼对比表，先生一眼挑。
- 视频：抽几帧看（`ffmpeg -i 片.mp4 -vf fps=1 frames/%03d.png`），查有没有黑屏、卡住、人物变形。
- 说清哪张是生成的、哪张是素材；商用的图提醒一句字体和肖像授权。

## 附：目录结构

```
pinkie-script-image/
├── SKILL.md
├── scripts/
│   ├── gen.mjs            统一入口（--via chatgpt|gemini|doubao，--doctor 体检）
│   ├── ensure-chrome.mjs  起专用 Chrome（关键：--disable-http2）
│   ├── ensure-doubao.ps1  起豆包（带 CDP 9225）
│   ├── tool.py              转调 vendor/ 里的 python 脚本
│   └── install.mjs        装依赖、同步 vendor
└── vendor/                从项目复制并改造过的脚本
```
