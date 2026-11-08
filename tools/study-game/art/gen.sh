#!/bin/zsh
# 一张图 = 一次 codex exec（内置 image_gen）。用法：gen.sh <raw 相对路径.png> <提示词文件> <参考图逗号列表|->
# 工作目录 = 仓库外的美术根（art/study-game），原图落 raw/，日志落 logs/。
set -u
ART=${STUDY_GAME_ART:-/Users/Admin/release-superpinkie/art/study-game}
cd "$ART"
out=$1; promptfile=$2; refs=${3:--}
C=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
log="logs/${out//\//__}.log"
mkdir -p "raw/${out:h}" logs
body=$(cat "$promptfile")
prompt="Use your built-in image generation tool (image_gen) exactly once to create ONE image, then copy the generated PNG file into ./raw/${out} (create the folder if needed; create nothing else, do not edit the image, do not write code to draw it). If the tool supports a transparent background option and the brief asks for transparency, turn it on.

${body}"
args=(exec --skip-git-repo-check -s workspace-write -C "$ART")
[[ "$refs" != "-" ]] && args+=(--image "$refs")
print -r -- "$prompt" | perl -e 'alarm 900; exec @ARGV' $C "${args[@]}" > "$log" 2>&1
code=$?
ls -la "raw/${out}" >> "$log" 2>&1 || code=9
exit $code
