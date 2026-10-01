# 模式转场素材重生成

这里的工具把五张转场原图拆成 WebGL 使用的四层：三通道遮罩、补好的背景板、柔焦背景和柔焦角色。

先为每张转场图生成 Vision 前景遮罩：

```bash
swift mask.swift <转场图> <输出遮罩>
```

把五个 `<mode>-mask.png` 放进同一个目录后，在本目录启动生成页：

```bash
python3 serve.py --masks <遮罩目录>
```

然后打开 <http://127.0.0.1:18841/build.html>。页面会读取 `ui/assets/laolao-mode-transition-<mode>.png` 和遮罩，生成并写回这些文件：

- `laolao-mode-transition-<mode>-mask.png`
- `laolao-mode-transition-<mode>-plate.webp`
- `laolao-mode-transition-<mode>-plate-soft.png`
- `laolao-mode-transition-<mode>-char-soft.png`

只允许写回上述五个模式的 20 个派生素材；原图不会被这个服务改动。
