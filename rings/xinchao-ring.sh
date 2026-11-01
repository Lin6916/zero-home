#!/bin/sh
# 年轮环 · 每天给心潮念的身份文件留一环
# 内容变了才存；没变就什么都不做。
# 装到 /usr/local/bin/xinchao-ring.sh，用 crontab 每天跑一次。
set -eu

OUT="${RING_DIR:-/opt/xinchao-rings}"
VOL="${RING_VOLUME:-xinchao-nian_xinchao-state}"
mkdir -p "$OUT"

# 容器卷名可能是 compose 项目前缀，也可能不是，两个都试
if ! docker volume inspect "$VOL" >/dev/null 2>&1; then
  VOL=$(docker volume ls --format '{{.Name}}' | grep -E 'xinchao-state$' | head -n1 || true)
fi
if [ -z "${VOL:-}" ]; then
  echo "ring: 找不到 xinchao-state 卷" >&2
  exit 0
fi

DATE=$(date +%F)
saved=0

for f in personality.json state.json; do
  if docker run --rm -v "$VOL":/d alpine test -f "/d/$f" 2>/dev/null; then
    NEW=$(docker run --rm -v "$VOL":/d alpine cat "/d/$f" 2>/dev/null || true)
    LAST=$(ls -1t "$OUT"/"$f".*.json 2>/dev/null | head -n1 || true)
    if [ -n "$LAST" ] && [ "$NEW" = "$(cat "$LAST")" ]; then
      echo "ring: $f 没变，跳过"
      continue
    fi
    printf '%s' "$NEW" > "$OUT/$f.$DATE.json"
    echo "ring: 存了一环 $f.$DATE.json"
    saved=$((saved+1))
  fi
done

echo "ring: 本轮存了 $saved 个文件，目录 $OUT"
