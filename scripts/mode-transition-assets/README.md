# 模式转场和开屏素材重生成

这里的工具把五张模式转场原图和一张开屏原图拆成 WebGL 使用的四层：三通道遮罩、补好的背景板、柔焦背景和柔焦角色。

先为每张转场图和开屏图生成 Vision 前景遮罩：

```bash
swift mask.swift <转场图> <输出遮罩>
```

例如，开屏的遮罩命名为 `splash-mask.png`：

```bash
swift mask.swift ../../ui/assets/laolao-splash.png /tmp/laolao-masks/splash-mask.png
```

Vision 给 `laolao-splash.png` 的结果应只保留碧琪（鬃毛、尾巴和假胡子都完整）。扬尘和火花留在背景层，这样角色边缘更干净；运行时的扬尘和彩纸由动效单独绘制。

把五个 `<mode>-mask.png` 和 `splash-mask.png` 放进同一个目录后，在本目录启动生成页：

```bash
python3 serve.py --masks <遮罩目录>
```

然后打开 <http://127.0.0.1:18841/build.html>。页面会读取 `ui/assets/laolao-mode-transition-<mode>.png`、`ui/assets/laolao-splash.png` 和遮罩，生成并写回这些文件：

- `laolao-mode-transition-<mode>-mask.png`
- `laolao-mode-transition-<mode>-plate.webp`
- `laolao-mode-transition-<mode>-plate-soft.png`
- `laolao-mode-transition-<mode>-char-soft.png`

开屏也会生成对应的四个文件：

- `laolao-splash-mask.png`
- `laolao-splash-plate.webp`
- `laolao-splash-plate-soft.png`
- `laolao-splash-char-soft.png`

只允许写回上述五个模式和开屏的 24 个派生素材；原图不会被这个服务改动。

若只想重做开屏，不改动五个模式的现有派生素材，可以打开 <http://127.0.0.1:18841/build.html?scene=splash>。
