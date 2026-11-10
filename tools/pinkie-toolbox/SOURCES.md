# 工具箱版本和来源

- Python 包固定版本与每个发行包的 SHA-256 记录在 `requirements/*.lock`；元数据来自 PyPI。执行时使用 `pip --require-hashes --only-binary`。
- `ffprobe` 来自 npm `@ffprobe-installer` 的平台发行包，版本及 SHA-512 来自各发行包的 npm 元数据。只解包可执行文件，不运行包内安装脚本。
- 中文字体来自 npm `@expo-google-fonts/noto-sans-sc` 0.4.4；哈希来自 npm 元数据，字体采用 SIL Open Font License。
- Mac 版 LibreOffice 26.8.2 的 SHA-256 记录参考 [Homebrew Cask 的版本清单](https://github.com/Homebrew/homebrew-cask/blob/HEAD/Casks/l/libreoffice.rb)，下载使用 The Document Foundation 及镜像的同一文件，解包后还核验应用签名；Windows 版哈希参考 [Scoop 的版本清单](https://github.com/ScoopInstaller/Extras/blob/master/bucket/libreoffice.json)，采用 Windows Installer 的管理镜像解包，不注册系统安装。
- Windows MinGit 2.56.0.4 的 SHA-256 来自 [Git for Windows 官方发布说明](https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4)。

版本不会自动追新。更新时要重新核验来源、适用平台、哈希和实际自检；未经验证的文件不能加入清单。
