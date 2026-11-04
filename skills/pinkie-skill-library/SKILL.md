---
name: pinkie-skill-library
description: 碧琪自带的 125 个现成技能的目录（视频短片、动效、海报封面、小红书、logo 品牌、PPT、信息图、网页界面、GIF、排错、写计划……）。要做出一件成品、而系统这条消息没有给你配好技能时，先读这份目录挑最合适的一个。
---

# 碧琪自带的现成技能

前 4 个是碧琪自己的薄技能（底下是开源工具），其余来自社区开源项目（来源和许可证见每个文件夹里的 SOURCE.md、LICENSE，总表在 `../THIRD_PARTY_SKILLS.md`）。
它们不在系统技能清单里，免得把清单挤满；系统通常会在消息里直接写好「这件活先用这些现成的技能」和路径。没写、而活儿像下面某一种时：

1. 在表里挑最贴近的 1–2 个（视频类先看 hyperframes，再看按片子类型分的那些）。
2. 路径相对于本文件所在的文件夹，换成绝对路径后完整读它的 SKILL.md，照它的做法和素材做。
3. 技能和碧琪的打法冲突时以打法为准：先做出来、不问一串问题、交付前亲眼验证；技能要的依赖自己装好，记进下载账本。

| 技能 | 干什么 | SKILL.md |
|---|---|---|
| pinkie-id-photo | 证件照：换白 / 蓝 / 红底、一寸二寸等标准尺寸、六寸排版冲印（底层 HivisionIDPhotos，Apache-2.0，本地跑） | `../pinkie-id-photo/SKILL.md` |
| pinkie-remove-background | 抠图去背景、换纯色底或背景图、批量处理（底层 rembg，MIT，本地跑） | `../pinkie-remove-background/SKILL.md` |
| pinkie-kids-worksheets | 字帖（田字格 / 米字格 / 回宫格、拼音、描红）和口算题卡（带答案页），A4 PDF | `../pinkie-kids-worksheets/SKILL.md` |
| pinkie-resume | 简历：填一份 YAML 出排版好的 PDF，多套主题，中英文（底层 RenderCV，MIT） | `../pinkie-resume/SKILL.md` |
| ui-ux-pro-max | 做网页、App 界面前先查：按行业挑风格、配色、字体、UX 规则（带可搜索的数据表） | `../ui-ux-pro-max/SKILL.md` |
| design-system | 搭一整套设计系统：颜色、字号、间距、组件规范 | `../design-system/SKILL.md` |
| design | 通用视觉设计方法：版式、层级、留白、配色 | `../design/SKILL.md` |
| brand | logo 和品牌：配色、字体、用法规范一整套 | `../brand/SKILL.md` |
| banner-design | 横幅、头图、封面、广告图、电商主图的版式和尺寸 | `../banner-design/SKILL.md` |
| slides | 做 PPT / 演示稿：结构、每页怎么排 | `../slides/SKILL.md` |
| ui-styling | Tailwind / shadcn 的界面样式做法 | `../ui-styling/SKILL.md` |
| frontend-design | 做出有设计感、不俗气的前端页面 | `../frontend-design/SKILL.md` |
| canvas-design | 海报、印刷品、艺术感单张视觉（带一批可用字体） | `../canvas-design/SKILL.md` |
| theme-factory | 给 PPT、文档、网页套一整套主题配色（10 套现成主题） | `../theme-factory/SKILL.md` |
| algorithmic-art | 用代码做生成艺术、图案、粒子、纹理 | `../algorithmic-art/SKILL.md` |
| web-artifacts-builder | 复杂单页应用（React + 组件），打成一个 HTML | `../web-artifacts-builder/SKILL.md` |
| webapp-testing | 用浏览器自动点一遍网页、截图验证 | `../webapp-testing/SKILL.md` |
| slack-gif-creator | 做 GIF 动图、表情包（尺寸、帧数、体积都控好） | `../slack-gif-creator/SKILL.md` |
| infographic-creator | AntV 信息图：约 200 种现成版式（流程、时间轴、对比、层级……），写几行就出图 | `../infographic-creator/SKILL.md` |
| infographic-syntax-creator | AntV 信息图的语法写法（infographic-creator 的细节） | `../infographic-syntax-creator/SKILL.md` |
| infographic-structure-creator | 自己设计新的信息图结构（现成版式不够时） | `../infographic-structure-creator/SKILL.md` |
| infographic-item-creator | 自己设计新的信息图条目样式（现成版式不够时） | `../infographic-item-creator/SKILL.md` |
| hyperframes | 视频 / 动画总入口：用 HTML 做视频、渲染成 MP4 | `../hyperframes/SKILL.md` |
| hyperframes-cli | HyperFrames 命令行：预览、检查、渲染 | `../hyperframes-cli/SKILL.md` |
| hyperframes-registry | 约 400 件现成动效积木：转场、故障风、胶片、图表动画、地图 | `../hyperframes-registry/SKILL.md` |
| media-use | 配乐、音效、配音、字幕、抠图、调色素材一条龙 | `../media-use/SKILL.md` |
| slideshow | 照片 / PPT 做成视频、电子相册、卡点 | `../slideshow/SKILL.md` |
| style-sampling | 从参考图、网页里取风格 | `../style-sampling/SKILL.md` |
| reverse-any-video | 照着一个现成视频拆解、复刻 | `../reverse-any-video/SKILL.md` |
| lemo-opuscar | 66 种用代码做的片子风格（水墨、油画、浮世绘、像素、纪录片……），首次使用自动下载风格库 | `../lemo-opuscar/SKILL.md` |
| narrated-video | 带旁白配音的讲述视频 | `../narrated-video/SKILL.md` |
| teaser-video | 预告片、悬念片 | `../teaser-video/SKILL.md` |
| brand-film | 品牌片：宣言、品牌故事、logo 收尾 | `../brand-film/SKILL.md` |
| data-story | 数据会动的讲述视频、年度报告 | `../data-story/SKILL.md` |
| event-promo | 活动宣传、开业、促销、倒计时视频 | `../event-promo/SKILL.md` |
| explainer-video | 讲解 / 科普视频 | `../explainer-video/SKILL.md` |
| feature-update | 新功能、版本更新视频 | `../feature-update/SKILL.md` |
| launch-film | 新品发布片 | `../launch-film/SKILL.md` |
| motion-film | 动效短片、片头片尾、动态海报 | `../motion-film/SKILL.md` |
| product-walkthrough | 产品演示、功能演示视频 | `../product-walkthrough/SKILL.md` |
| social-ad | 竖屏短视频广告（抖音、视频号、Reels） | `../social-ad/SKILL.md` |
| testimonial-video | 口碑、好评、客户证言视频 | `../testimonial-video/SKILL.md` |
| tutorial-video | 教程、手把手教学视频 | `../tutorial-video/SKILL.md` |
| systematic-debugging | 排错：先复现、找根因、再修 | `../systematic-debugging/SKILL.md` |
| test-driven-development | 写代码先写会失败的测试 | `../test-driven-development/SKILL.md` |
| verification-before-completion | 说做完之前先拿到真凭据 | `../verification-before-completion/SKILL.md` |
| writing-plans | 大活先写计划，拆成能验证的小步 | `../writing-plans/SKILL.md` |
| executing-plans | 按写好的计划一步步做、每步验证 | `../executing-plans/SKILL.md` |
| xhs-cover-templates | 16 套小红书封面现成模板（亮 / 暗两版） | `../xhs-cover-templates/SKILL.md` |
| officecli | Word / Excel / PPT 总入口（officecli 单文件命令行，不用装 Office）：新建、修改、检查、加图表，交付前质检 | `../officecli/SKILL.md` |
| officecli-docx | Word 文档：目录、页码、多级编号、表格、报告和公文排版 | `../officecli-docx/SKILL.md` |
| officecli-xlsx | Excel 表格：公式、条件格式、冻结窗格、图表、打印设置 | `../officecli-xlsx/SKILL.md` |
| officecli-pptx | 真 .pptx 演示稿：版式、图表、流程图、设计规范 | `../officecli-pptx/SKILL.md` |
| officecli-pitch-deck | 路演 / 融资 / 招商 deck | `../officecli-pitch-deck/SKILL.md` |
| officecli-academic-paper | 论文和学术文档的 Word 排版 | `../officecli-academic-paper/SKILL.md` |
| officecli-data-dashboard | Excel 数据看板 | `../officecli-data-dashboard/SKILL.md` |
| officecli-financial-model | 财务模型（Excel：预算、预测、三张报表） | `../officecli-financial-model/SKILL.md` |
| officecli-word-form | Word 表单：申请表、登记表、可填写的表格 | `../officecli-word-form/SKILL.md` |
| morph-ppt | 50 多种现成 PPT 风格（每种都有 .pptx 成品和生成脚本），带平滑切换动画 | `../morph-ppt/SKILL.md` |
| morph-ppt-3d | PPT 里的 3D 模型和平滑切换 | `../morph-ppt-3d/SKILL.md` |
| design-taste-frontend | 网页审美总监：从 247 个获奖网站总结的方向库，定方向再做页面、截图自查，让网页不像 AI 模板 | `../design-taste-frontend/SKILL.md` |
| archify | 架构图、流程图、时序图、ER 图、状态图、时间线等图解：可交互的单页 HTML，能导出图片 | `../archify/SKILL.md` |
| ppt-master | 可编辑 PPT（.pptx）全流程：课件、汇报、路演，品牌模板、上万个图标、音效和动画（第一次用时下载） | `../ppt-master/SKILL.md` |
| frontend-slides | 网页版幻灯片：动画丰富的 HTML 演示，也能把 PPT 转成网页 | `../frontend-slides/SKILL.md` |
| antv-g2-chart | AntV G2 图表：柱状、折线、饼图、散点、雷达、热力等（本地渲染） | `../antv-g2-chart/SKILL.md` |
| antv-g6-graph | 关系图、网络图、树图、脑图（AntV G6） | `../antv-g6-graph/SKILL.md` |
| threejs-fundamentals | 3D 网页基础：场景、相机、渲染、动画循环 | `../threejs-fundamentals/SKILL.md` |
| threejs-animation | 3D 动画 | `../threejs-animation/SKILL.md` |
| threejs-interaction | 3D 交互：点击、拖拽、视角控制 | `../threejs-interaction/SKILL.md` |
| threejs-materials | 3D 材质 | `../threejs-materials/SKILL.md` |
| threejs-lighting | 3D 灯光和阴影 | `../threejs-lighting/SKILL.md` |
| threejs-textures | 3D 贴图 | `../threejs-textures/SKILL.md` |
| threejs-geometry | 3D 几何体 | `../threejs-geometry/SKILL.md` |
| threejs-loaders | 加载 3D 模型（glTF 等） | `../threejs-loaders/SKILL.md` |
| threejs-shaders | 着色器特效 | `../threejs-shaders/SKILL.md` |
| threejs-postprocessing | 3D 后期特效（泛光、景深） | `../threejs-postprocessing/SKILL.md` |
| threejs-performance | 3D 性能优化 | `../threejs-performance/SKILL.md` |
| threejs-react-three-fiber | React 里的 3D（R3F） | `../threejs-react-three-fiber/SKILL.md` |
| threejs-asset-pipeline | 3D 素材处理流程 | `../threejs-asset-pipeline/SKILL.md` |
| pretty-mermaid | 流程图、时序图、思维导图、甘特图等 Mermaid 图，渲染成好看的 SVG / PNG | `../pretty-mermaid/SKILL.md` |
| dashmotion | 会动的技术图：连线流动的流程图、架构图（单个 HTML） | `../dashmotion/SKILL.md` |
| taobao-detail-long-image | 淘宝 / 拼多多 / 京东详情页长图（750 宽，一屏一屏拼起来） | `../taobao-detail-long-image/SKILL.md` |
| sale-banner | 电商促销横幅 | `../sale-banner/SKILL.md` |
| selling-point-infographic | 商品卖点信息图 | `../selling-point-infographic/SKILL.md` |
| size-chart | 尺码表 | `../size-chart/SKILL.md` |
| ecommerce-listing-suite | 一套上架图：主图、卖点、场景、细节 | `../ecommerce-listing-suite/SKILL.md` |
| lifestyle-scene | 商品场景图 | `../lifestyle-scene/SKILL.md` |
| amazon-white-background | 白底商品图 | `../amazon-white-background/SKILL.md` |
| batch-background-swap | 商品图批量换背景 | `../batch-background-swap/SKILL.md` |
| multi-angle-set | 商品多角度图 | `../multi-angle-set/SKILL.md` |
| model-try-on | 模特上身图 | `../model-try-on/SKILL.md` |
| amazon-a-plus | 亚马逊 A+ 页面 | `../amazon-a-plus/SKILL.md` |
| xiaohongshu-cover | 小红书种草封面（电商商品） | `../xiaohongshu-cover/SKILL.md` |
| ip-as-logo | IP 形象 logo：极简、圆润、可爱的拟人角色 | `../ip-as-logo/SKILL.md` |
| naming | 起名：品牌、产品、店名、App（隐喻法，查重名和域名） | `../naming/SKILL.md` |
| copywriting | 营销文案：落地页、广告、产品介绍 | `../copywriting/SKILL.md` |
| copy-editing | 文案修改润色 | `../copy-editing/SKILL.md` |
| social | 社交媒体内容：帖子、话题、发布日历 | `../social/SKILL.md` |
| emails | 营销邮件和邮件序列 | `../emails/SKILL.md` |
| ad-creative | 广告创意和投放素材 | `../ad-creative/SKILL.md` |
| launch | 产品发布方案 | `../launch/SKILL.md` |
| marketing-ideas | 营销点子大全 | `../marketing-ideas/SKILL.md` |
| pricing | 定价策略 | `../pricing/SKILL.md` |
| offers | 促销和优惠方案 | `../offers/SKILL.md` |
| product-marketing | 产品定位和卖点 | `../product-marketing/SKILL.md` |
| content-strategy | 内容规划 | `../content-strategy/SKILL.md` |
| marketing-psychology | 营销心理学 | `../marketing-psychology/SKILL.md` |
| cro | 转化率优化：落地页、表单、注册 | `../cro/SKILL.md` |
| frontend-ui-engineering | 前端界面工程：组件、状态、可访问性 | `../frontend-ui-engineering/SKILL.md` |
| browser-testing-with-devtools | 用浏览器开发者工具测网页 | `../browser-testing-with-devtools/SKILL.md` |
| api-and-interface-design | 接口设计 | `../api-and-interface-design/SKILL.md` |
| code-review-and-quality | 代码审查 | `../code-review-and-quality/SKILL.md` |
| code-simplification | 代码化简 | `../code-simplification/SKILL.md` |
| performance-optimization | 性能优化 | `../performance-optimization/SKILL.md` |
| security-and-hardening | 安全加固 | `../security-and-hardening/SKILL.md` |
| shipping-and-launch | 上线前检查 | `../shipping-and-launch/SKILL.md` |
| idea-refine | 把模糊的想法打磨成能做的方案 | `../idea-refine/SKILL.md` |
| spec-driven-development | 先写规格再写代码 | `../spec-driven-development/SKILL.md` |
| game-designer | 游戏设计：玩法、关卡、手感 | `../game-designer/SKILL.md` |
| game-prototype | 快速做出能玩的游戏原型 | `../game-prototype/SKILL.md` |
| game-jam-mode | 限时做完一个小游戏 | `../game-jam-mode/SKILL.md` |
| game-playtest | 游戏试玩测试 | `../game-playtest/SKILL.md` |
| game-balance-check | 游戏数值平衡 | `../game-balance-check/SKILL.md` |
| pdf | PDF：生成、读取、检查（渲染成图片看排版） | `../pdf/SKILL.md` |
| genai-mesh-gradient | 渐变背景：网页、PPT、品牌视觉 | `../genai-mesh-gradient/SKILL.md` |
