#!/bin/zsh
# 拼图自查：sheet.sh <输出名> <png...>  → art/study-game/sheets/<名>.jpg，深灰底（看白切边和抠图毛边）
ART=${STUDY_GAME_ART:-/Users/Admin/release-superpinkie/art/study-game}
name=$1; shift
magick montage "$@" -background '#3a3a46' -geometry 512x512+8+8 -tile 3x -label '%t' -fill white -pointsize 18 "$ART/sheets/$name.jpg"
echo "$ART/sheets/$name.jpg"
