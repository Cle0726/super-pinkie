# 开屏与模式切换

保留原有缩放、扫光、头像和面板入场，不叠加新的全屏闪光转场。

- `ui/injections/laolao-motion.js` 共用图片解码、连续稳定检查和单调进度函数。
- 大图加载后等待 `Image.decode()`；四模式空闲预热按顺序进行，不同时抢首屏资源。失败素材有超时兜底，不会无限挡住页面。
- 四模式切换继续优先使用当前路由，目标模式、输入区、头像加载及聊天骨架状态连续稳定 300ms 后，才进入收尾。图片解码也必须先结束。
- 进度使用 `transform: scaleX`，只在整数百分比变化时更新文字和 ARIA，避免每帧重复写 DOM。收尾用 300ms 平滑到 100%，然后再淡出。
- 页面自身的头像、面板和背景动画在遮罩开始淡出时启动；大背景不再逐帧改变滤镜，扫光不再逐帧改变 `left`。
- 首次启动保留约 2.6 秒基础节奏；模式过场约 2.4 秒后等待目标页面。慢连接延长等待，不假装已经就绪。
- 真实登录界面持续出现时让出操作；30 秒仍未就绪则提供「重新连接」「查看当前页面」，不强制报 100%。
- 派对首屏只等待必需图片，其他成员素材后台预热。进度平滑推进，输入区域在淡出结束后解除 `inert`。
- 系统开启「减少动态效果」时缩短入场等待并关闭装饰动画；就绪检查仍保留。

## 模式转场

五个模式切换优先使用 `laolao-mode-transition-fx.js`：唠嗑是气球爆开，项目是蓝图格子翻开，想法是云朵展开，学习是笔尖画星星，无限制是彩虹斜切。揭幕盖住旧页面以后才换路由，目的地稳定后才走完进度条和退场。

想临时关掉新版转场，在页面控制台执行：

```js
localStorage['laolao:mode-transition-fx'] = 'off'
```

删掉这个键或改成其他值即可恢复。系统开启「减少动态效果」、浏览器没有可用 WebGL、素材加载/解码失败时，都会自动回到原来的模式转场，不会挡住切换。

转场图仍以 `ui/assets/laolao-mode-transition-<mode>.png` 为原图；重新做人物遮罩和补图层的步骤见 `scripts/mode-transition-assets/README.md`。生成的 `mask / plate / plate-soft / char-soft` 四类文件每个模式各一套，由安装器一并复制。

## 开屏与接续

冷启动仍先画原来的 `laolao-splash.png` CSS 背景，所以 WebGL、素材或解码都不会拖慢第一帧。引擎空闲时准备好后，画布会在约 300ms 内对齐原图淡入；它复用模式转场的景深、慢推镜头、鬃毛和尾巴飘动、彩纸、气球，以及糖果胶囊进度条的完成效果。碧琪以落地的前蹄为锚轻轻蓄力，假胡子和扬尘只在各自的小区域活动；就绪时仍先满足最短展示时间，再冲刺、放彩纸并淡出。

整页刷新接续模式切换时，`is-mode-progress` 不再从头揭幕：它直接从当前模式已对焦的待机画面开始，沿用带过来的百分比。`laolao-handoff-bootstrap.js` 仍在标记后的同步首帧先把进度画好，随后才由开屏控制器接手。

开启“减少动态效果”、没有 WebGL、派生素材加载或解码失败，或执行 `localStorage['laolao:mode-transition-fx'] = 'off'` 时，开屏和模式切换都会继续使用原有静态流程；最短时长、6.5 秒让出页面、登录页处理和 30 秒恢复按钮不变。

### 重生成开屏派生素材

开屏和五个模式共用 `scripts/mode-transition-assets`。先用 Vision 为原图生成一张前景遮罩：

```bash
swift scripts/mode-transition-assets/mask.swift ui/assets/laolao-splash.png /tmp/pinkie-transition-masks/splash-mask.png
```

把它和五个模式的 `*-mask.png` 放在同一个 `--masks` 目录，运行 `python3 scripts/mode-transition-assets/serve.py --masks /tmp/pinkie-transition-masks`，再打开 `http://127.0.0.1:18841/build.html?scene=splash`。这个地址只会写回 `laolao-splash-{mask,plate,plate-soft,char-soft}`；原图不会被改动。生成后先检查碧琪的鬃毛、尾巴和轮廓；这张图的扬尘和火花留在背景层，优先保证角色边缘干净。

## 验证

`node --test tests/motion.test.cjs tests/party-selection.test.cjs` 覆盖单调进度、连续稳定、解码去重/失败/超时、跨页进度衔接、透明 PNG 的像素和白色细节。

`tests/fixtures/motion.html` 是不调用模型、不触碰真实聊天的浏览器验收页。支持 `scenario=handoff|login|blocked`、`delay=5500`；页面下方输出进度轨迹、提前完成和倒退检测。已检查四模式切换、慢加载、错误出口、真实登录和切换后输入。真实派对页检查招牌融合与退场。

这里验证的是实现和浏览器行为，不宣称所有硬件上都能达到固定帧率；原生 WebKit 的最终观感仍需重新打开 App 确认。

# 动效规范

`ui/injections/laolao-motion-system.css` 统一日常控件的节奏：平时克制顺滑，按下即时，松开和弹层带一点回弹。它必须在 `laolao-theme.css` 之后加载，安装脚本按这个顺序插入。

| 变量 | 值 | 用途 |
|---|---|---|
| `--motion-instant` | 90ms | 按下反馈 |
| `--motion-fast` | 160ms | 悬停、颜色、开关 |
| `--motion-base` | 220ms | 弹层、提示、列表项 |
| `--motion-slow` | 420ms | 页面切换 |
| `--ease-out` | `cubic-bezier(.2, .78, .28, 1)` | 进入 |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | 离开 |
| `--ease-standard` | `cubic-bezier(.4, 0, .2, 1)` | 颜色、透明度 |
| `--ease-spring` | `cubic-bezier(.34, 1.32, .64, 1)` | 松开、弹层，轻微回弹 |

规则：

- 新写的过渡和动画一律用这些变量，不再写死毫秒数和曲线。
- 只动画 `transform`、`translate`、`scale`、`opacity` 和颜色类属性，不动画 `width`、`height`、`top`、`left`。
- 入场动画用独立的 `translate` / `scale` 属性，不覆盖元素自己用于定位的 `transform`。
- 进入比离开慢；离开不回弹；同一区域同一时刻只有一个主要动画。
- 页面入场不从全透明开始：WebKit 会把分屏里没聚焦的那一半标成 hidden 并停住动画时钟，从透明开始会让页面一直看不见。分屏和停靠窗口不做页面入场。
- 只用 CSS，不为动效新增 MutationObserver 或改写 Lit 管理的 DOM。
- 「减少动态效果」打开时，变量全部归零，去掉按下位移和入场动画。

这一版覆盖：统一控件过渡与按下效果（原来有两条互相覆盖的按下规则）、侧边栏会话行、弹层节奏、补上侧边栏「更多工具」菜单和上下文容量弹层的入场、非聊天页面的入场。聊天消息区、设置页、学习笔记和工具时间线不在这一版。
