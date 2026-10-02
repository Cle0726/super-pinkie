#!/bin/bash
# Rebuild Pinkie's tool environment (~/.openclaw/agent-env) and the helper commands.
# The four Pinkie modes put ~/.openclaw/agent-env/bin, /opt/homebrew/opt/ffmpeg-full/bin and
# /opt/homebrew/bin first on PATH via agents.list[].tools.exec.pathPrepend in openclaw.json.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
env_dir="$HOME/.openclaw/agent-env"
# Use the standard-prefix Homebrew: the ~/.homebrew one cannot use bottles and builds from source.
/opt/homebrew/bin/brew install ffmpeg-full imagemagick poppler tesseract librsvg cairo pango pkgconf
/opt/homebrew/bin/brew install --cask blender || true
for lang in chi_sim chi_tra; do
  [ -f "/opt/homebrew/share/tessdata/$lang.traineddata" ] || \
    curl -fsSL -o "/opt/homebrew/share/tessdata/$lang.traineddata" "https://github.com/tesseract-ocr/tessdata/raw/main/$lang.traineddata"
done
[ -x "$env_dir/bin/python" ] || uv venv "$env_dir" --python 3.12
PKG_CONFIG_PATH=/opt/homebrew/lib/pkgconfig PATH=/opt/homebrew/bin:$PATH uv pip install --python "$env_dir/bin/python" \
  pillow numpy matplotlib requests aiohttp loguru pycryptodome getuseragent python-pptx python-docx openpyxl \
  pypdf pdf2image pytesseract opencv-python-headless moviepy "markitdown[pptx,docx,xlsx,pdf]" playwright apng manim
PUPPETEER_SKIP_DOWNLOAD=1 npm install -g @marp-team/marp-cli @mermaid-js/mermaid-cli pptxgenjs
for tool in look-video look-page look-doc; do install -m 755 "$here/bin/$tool" "$env_dir/bin/$tool"; done
# mmdc/marp wrappers point at this machine's global npm prefix.
for tool in mmdc marp; do
  sed "s#/Users/Admin/.nvm/versions/node/v24.20.0#$(npm prefix -g)#" "$here/bin/$tool" > "$env_dir/bin/$tool"
  chmod 755 "$env_dir/bin/$tool"
done
echo "agent-env ready: $env_dir"
