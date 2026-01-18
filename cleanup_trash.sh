#!/bin/bash
# MagicMirror 垃圾文件清理脚本
# 清理 core dump 文件、macOS 临时文件和 .DS_Store 文件

# 设置工作目录
MM_DIR="/home/mm/MagicMirror"
cd "$MM_DIR" || exit 1

# 输出日志文件
LOG_FILE="$MM_DIR/logs/cleanup.log"
mkdir -p "$(dirname "$LOG_FILE")"

# 记录开始时间
echo "========================================" >> "$LOG_FILE"
echo "垃圾清理开始时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"

# 统计清理前的文件数和大小
echo "清理前统计:" >> "$LOG_FILE"

# 1. 统计 core dump 文件
CORE_COUNT=$(find . -maxdepth 1 -name "core.*" -type f 2>/dev/null | wc -l)
CORE_SIZE=$(find . -maxdepth 1 -name "core.*" -type f -exec du -ch {} + 2>/dev/null | tail -1 | awk '{print $1}')
echo "  Core dump 文件: $CORE_COUNT 个, 大小: ${CORE_SIZE:-0}" >> "$LOG_FILE"

# 2. 统计 macOS 临时文件
MAC_TEMP_COUNT=$(find . -name "._*" -type f 2>/dev/null | wc -l)
echo "  macOS 临时文件: $MAC_TEMP_COUNT 个" >> "$LOG_FILE"

# 3. 统计 .DS_Store 文件
DS_STORE_COUNT=$(find . -name ".DS_Store" -type f 2>/dev/null | wc -l)
echo "  .DS_Store 文件: $DS_STORE_COUNT 个" >> "$LOG_FILE"

# 开始清理
echo "开始清理..." >> "$LOG_FILE"

# 清理 core dump 文件
if [ "$CORE_COUNT" -gt 0 ]; then
    find . -maxdepth 1 -name "core.*" -type f -delete 2>/dev/null
    echo "  ✓ 已删除 $CORE_COUNT 个 core dump 文件" >> "$LOG_FILE"
fi

# 清理 macOS 临时文件
if [ "$MAC_TEMP_COUNT" -gt 0 ]; then
    find . -name "._*" -type f -delete 2>/dev/null
    echo "  ✓ 已删除 $MAC_TEMP_COUNT 个 macOS 临时文件" >> "$LOG_FILE"
fi

# 清理 .DS_Store 文件
if [ "$DS_STORE_COUNT" -gt 0 ]; then
    find . -name ".DS_Store" -type f -delete 2>/dev/null
    echo "  ✓ 已删除 $DS_STORE_COUNT 个 .DS_Store 文件" >> "$LOG_FILE"
fi

# 记录完成时间
echo "垃圾清理完成时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

# 输出 JSON 格式的结果供前端使用
cat << EOF
{
  "success": true,
  "cleaned": {
    "coreDump": $CORE_COUNT,
    "macTemp": $MAC_TEMP_COUNT,
    "dsStore": $DS_STORE_COUNT,
    "totalSize": "${CORE_SIZE:-0}"
  },
  "timestamp": "$(date '+%Y-%m-%d %H:%M:%S')"
}
EOF

exit 0
