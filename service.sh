#!/bin/bash

# ============================================================
# MagicMirror 服务管理脚本
# ============================================================
#
# 用法: ./service.sh [install|start|stop|restart|status|logs|cleanup|clean|help]
#
# 命令说明:
#   install - 一键安装 MagicMirror + MMM-TClient
#   start   - 后台启动服务
#   stop    - 停止服务
#   restart - 重启服务
#   status  - 查看服务状态
#   logs    - 查看实时日志
#   cleanup - 清理僵尸进程和端口占用
#   clean   - 清理垃圾文件（.DS_Store、core.*、._* 等）
#   help    - 显示帮助信息

# ============================================================
# 配置变量
# ============================================================

# 服务显示名称
SERVICE_NAME="MagicMirror 智能魔镜"

# 应用名称（用于标识）
APP_NAME="magicmirror"

# 工作目录（MagicMirror 安装位置）
WORK_DIR="${MM_DIR:-$HOME/MagicMirror}"

# PID 文件路径
PID_FILE="$WORK_DIR/magicmirror.pid"

# 日志文件路径
LOG_FILE="$WORK_DIR/logs/magicmirror.log"

# Node.js 版本要求
NODE_VERSION="22"

# 启动命令
START_CMD="DISPLAY=:0 ./node_modules/.bin/electron js/electron.js"

# 服务端口
SERVICE_PORT="8080"

# 是否需要检查依赖
CHECK_DEPS="true"

# 依赖文件路径
DEPS_FILE="package.json"

# ============================================================
# 工具函数
# ============================================================

# 显示帮助信息
show_help() {
    echo "$SERVICE_NAME - 服务管理脚本"
    echo ""
    echo "用法: $0 [install|start|stop|restart|status|logs|cleanup|clean|help]"
    echo ""
    echo "命令说明:"
    echo "  install - 一键安装 MagicMirror + MMM-TClient（从零开始）"
    echo "  start   - 后台启动服务"
    echo "  stop    - 停止服务"
    echo "  restart - 重启服务"
    echo "  status  - 查看服务状态"
    echo "  logs    - 查看实时日志"
    echo "  cleanup - 清理僵尸进程和端口占用"
    echo "  clean   - 清理垃圾文件（.DS_Store、core.*、._* 等）"
    echo "  help    - 显示帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 install  # 首次使用，一键安装所有组件"
    echo "  $0 start    # 启动服务"
    echo "  $0 status   # 查看状态"
    echo "  $0 logs     # 查看日志"
    echo "  $0 restart  # 重启服务"
    echo "  $0 stop     # 停止服务"
}

# 检查 Node.js 环境
check_nodejs() {
    # 加载 nvm（如果存在）
    if [ -d "$HOME/.nvm" ]; then
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi

    # 检查并切换到正确的 Node.js 版本
    if command -v nvm &> /dev/null; then
        nvm use "$NODE_VERSION" >/dev/null 2>&1 || nvm install "$NODE_VERSION"
    fi
}

# 启动服务
start_service() {
    echo "=========================================="
    echo "$SERVICE_NAME - 启动服务"
    echo "=========================================="

    # 检查工作目录是否存在
    if [ ! -d "$WORK_DIR" ]; then
        echo "✗ MagicMirror 目录不存在: $WORK_DIR"
        echo ""
        echo "请先运行安装命令："
        echo "  $0 install"
        exit 1
    fi

    cd "$WORK_DIR" || exit 1

    # 检查服务是否已经运行
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "服务已经在运行中 (PID: $PID)"
            echo "如需重启，请使用: $0 restart"
            exit 1
        else
            echo "PID 文件存在但进程不存在，清理旧的 PID 文件"
            rm -f "$PID_FILE"
        fi
    fi

    # 检查 Node.js 环境
    check_nodejs

    # 创建日志目录
    mkdir -p "$(dirname "$LOG_FILE")"

    # 检查端口是否被占用
    echo "检查端口 $SERVICE_PORT 可用性..."
    PORT_OCCUPIED=false
    if command -v lsof &> /dev/null; then
        if lsof -i :"$SERVICE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
            PORT_OCCUPIED=true
            OCCUPIER_INFO=$(lsof -i :"$SERVICE_PORT" -sTCP:LISTEN | tail -1)
        fi
    elif command -v ss &> /dev/null; then
        if ss -tlnp 2>/dev/null | grep ":$SERVICE_PORT " >/dev/null; then
            PORT_OCCUPIED=true
            OCCUPIER_INFO=$(ss -tlnp 2>/dev/null | grep ":$SERVICE_PORT ")
        fi
    fi

    if [ "$PORT_OCCUPIED" = true ]; then
        echo "✗ 端口 $SERVICE_PORT 已被占用！"
        echo ""
        echo "占用进程信息:"
        echo "  $OCCUPIER_INFO"
        echo ""
        echo "解决方案："
        echo "  1. 使用 $0 cleanup 清理僵尸进程"
        echo "  2. 停止占用该端口的其他服务"
        exit 1
    fi

    echo "✓ 端口 $SERVICE_PORT 可用"
    echo "正在启动服务..."

    # 启动服务
    nohup bash -c "$START_CMD" > "$LOG_FILE" 2>&1 &
    PID=$!

    # 保存 PID
    echo $PID > "$PID_FILE"

    # 等待启动
    sleep 2

    # 检查进程是否真的在运行
    if ps -p $PID > /dev/null 2>&1; then
        echo "✓ 服务启动成功!"
        echo "  PID: $PID"
        echo "  日志文件: $LOG_FILE"
        echo ""
        echo "📡 访问地址:"
        echo "  本地访问: http://localhost:$SERVICE_PORT"

        # 获取局域网IP地址
        LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        if [ -n "$LOCAL_IP" ]; then
            echo "  局域网访问: http://$LOCAL_IP:$SERVICE_PORT"
        fi

        echo ""
        echo "管理命令:"
        echo "  $0 status - 查看状态"
        echo "  $0 logs   - 查看日志"
        echo "  $0 stop   - 停止服务"
    else
        echo "✗ 服务启动失败，请检查日志: $LOG_FILE"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# 停止服务
stop_service() {
    echo "=========================================="
    echo "$SERVICE_NAME - 停止服务"
    echo "=========================================="

    # 检查 PID 文件是否存在
    if [ ! -f "$PID_FILE" ]; then
        echo "服务未运行（PID 文件不存在）"

        # 额外检查：清理所有 electron 进程
        if pgrep -f "electron.*MagicMirror" > /dev/null; then
            echo "检测到僵尸进程，正在清理..."
            pkill -f "electron.*MagicMirror"
            sleep 2
            echo "✓ 僵尸进程已清理"
        fi

        return 0
    fi

    # 读取 PID
    PID=$(cat "$PID_FILE")

    # 检查进程是否存在
    if ! ps -p "$PID" > /dev/null 2>&1; then
        echo "进程不存在 (PID: $PID)，清理 PID 文件"
        rm -f "$PID_FILE"

        # 额外检查：清理所有 electron 进程
        if pgrep -f "electron.*MagicMirror" > /dev/null; then
            echo "检测到僵尸进程，正在清理..."
            pkill -f "electron.*MagicMirror"
            sleep 2
            echo "✓ 僵尸进程已清理"
        fi

        return 0
    fi

    echo "正在停止服务 (PID: $PID)..."

    # 尝试优雅停止
    kill $PID

    # 等待进程结束
    for i in {1..10}; do
        if ! ps -p $PID > /dev/null 2>&1; then
            echo "✓ 服务已优雅停止"
            rm -f "$PID_FILE"
            return 0
        fi
        echo "等待进程结束... ($i/10)"
        sleep 1
    done

    # 如果优雅停止失败，强制停止
    echo "优雅停止失败，强制停止服务..."
    kill -9 $PID 2>/dev/null

    # 清理所有相关进程
    pkill -9 -f "electron.*MagicMirror" 2>/dev/null

    sleep 2

    echo "✓ 服务已强制停止"
    rm -f "$PID_FILE"
}

# 重启服务
restart_service() {
    echo "=========================================="
    echo "$SERVICE_NAME - 重启服务"
    echo "=========================================="

    echo "正在停止服务..."
    stop_service

    echo ""
    echo "正在启动服务..."
    start_service
}

# 查看服务状态
show_status() {
    echo "=========================================="
    echo "$SERVICE_NAME - 服务状态"
    echo "=========================================="

    # 检查 PID 文件是否存在
    if [ ! -f "$PID_FILE" ]; then
        echo "服务状态: 未运行"
        echo "PID 文件不存在"
        echo ""
        echo "启动服务: $0 start"
        exit 0
    fi

    # 读取 PID
    PID=$(cat "$PID_FILE")

    # 检查进程是否存在
    if ps -p $PID > /dev/null 2>&1; then
        # 获取进程信息
        CMDLINE=$(ps -p $PID -o cmd --no-headers 2>/dev/null)
        START_TIME=$(ps -p $PID -o lstart --no-headers 2>/dev/null)
        CPU_USAGE=$(ps -p $PID -o %cpu --no-headers 2>/dev/null)
        MEM_USAGE=$(ps -p $PID -o %mem --no-headers 2>/dev/null)

        echo "服务状态: ✓ 正在运行"
        echo "进程ID: $PID"
        echo "启动时间: $START_TIME"
        echo "CPU使用: ${CPU_USAGE}%"
        echo "内存使用: ${MEM_USAGE}%"
        echo ""

        # 显示访问地址
        echo "📡 访问地址:"
        echo "  本地访问: http://localhost:$SERVICE_PORT"

        LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        if [ -n "$LOCAL_IP" ]; then
            echo "  局域网访问: http://$LOCAL_IP:$SERVICE_PORT"
        fi

        echo ""
        echo "日志文件: $LOG_FILE"
        echo ""
        echo "管理命令:"
        echo "  $0 logs     - 查看日志"
        echo "  $0 restart  - 重启服务"
        echo "  $0 stop     - 停止服务"

    else
        echo "服务状态: ✗ 进程不存在"
        echo "PID 文件存在但进程不在运行"
        echo "清理 PID 文件..."
        rm -f "$PID_FILE"
        echo ""
        echo "启动服务: $0 start"
    fi
}

# 查看日志
show_logs() {
    echo "=========================================="
    echo "$SERVICE_NAME - 实时日志"
    echo "=========================================="
    echo "按 Ctrl+C 退出日志查看"
    echo ""

    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "日志文件不存在: $LOG_FILE"
        echo "请先启动服务: $0 start"
    fi
}

# 清理服务
cleanup_service() {
    echo "=========================================="
    echo "$SERVICE_NAME - 清理服务"
    echo "=========================================="

    CLEANED=false

    # 1. 清理 PID 文件对应的进程
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "清理 PID 文件中的进程 ($PID)..."
            kill -9 $PID 2>/dev/null
            CLEANED=true
        fi
        rm -f "$PID_FILE"
        echo "✓ PID 文件已清理"
    fi

    # 2. 清理所有 Electron MagicMirror 进程
    if pgrep -f "electron.*MagicMirror" > /dev/null; then
        echo "清理 Electron MagicMirror 进程..."
        pkill -9 -f "electron.*MagicMirror"
        CLEANED=true
        echo "✓ Electron 进程已清理"
    fi

    # 3. 清理端口占用进程
    if command -v lsof &> /dev/null; then
        PORT_PIDS=$(lsof -i :$SERVICE_PORT -t 2>/dev/null)
        if [ -n "$PORT_PIDS" ]; then
            echo "清理端口 $SERVICE_PORT 占用进程..."
            for pid in $PORT_PIDS; do
                kill -9 $pid 2>/dev/null
                echo "  已清理进程: $pid"
                CLEANED=true
            done
        fi
    fi

    if [ "$CLEANED" = false ]; then
        echo "未发现需要清理的进程"
    else
        echo ""
        echo "✓ 清理完成"
    fi
}

# 清理垃圾文件
cleanup_trash() {
    echo "=========================================="
    echo "$SERVICE_NAME - 清理垃圾文件"
    echo "=========================================="

    cd "$WORK_DIR" || exit 1

    # 初始化计数器
    core_dump_count=0
    mac_temp_count=0
    ds_store_count=0
    total_size=0

    echo "正在扫描垃圾文件..."
    echo ""

    # 1. 清理 Core dump 文件
    while IFS= read -r -d '' file; do
        if [ -f "$file" ]; then
            size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
            total_size=$((total_size + size))
            rm -f "$file"
            core_dump_count=$((core_dump_count + 1))
        fi
    done < <(find "$WORK_DIR" -type f -name "core.*" -print0 2>/dev/null)

    # 2. 清理 macOS 临时文件（._*）
    while IFS= read -r -d '' file; do
        if [ -f "$file" ]; then
            size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
            total_size=$((total_size + size))
            rm -f "$file"
            mac_temp_count=$((mac_temp_count + 1))
        fi
    done < <(find "$WORK_DIR" -type f -name "._*" -print0 2>/dev/null)

    # 3. 清理 .DS_Store 文件
    while IFS= read -r -d '' file; do
        if [ -f "$file" ]; then
            size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
            total_size=$((total_size + size))
            rm -f "$file"
            ds_store_count=$((ds_store_count + 1))
        fi
    done < <(find "$WORK_DIR" -type f -name ".DS_Store" -print0 2>/dev/null)

    # 格式化总大小
    if [ $total_size -ge 1073741824 ]; then
        # GB
        total_size_str=$(awk "BEGIN {printf \"%.2f GB\", $total_size/1073741824}")
    elif [ $total_size -ge 1048576 ]; then
        # MB
        total_size_str=$(awk "BEGIN {printf \"%.2f MB\", $total_size/1048576}")
    elif [ $total_size -ge 1024 ]; then
        # KB
        total_size_str=$(awk "BEGIN {printf \"%.2f KB\", $total_size/1024}")
    else
        # Bytes
        total_size_str="${total_size} Bytes"
    fi

    echo "清理结果："
    echo "  Core dump 文件: $core_dump_count 个"
    echo "  macOS 临时文件: $mac_temp_count 个"
    echo "  .DS_Store 文件: $ds_store_count 个"
    echo "  释放空间: $total_size_str"
    echo ""

    # 输出 JSON 格式（供 node_helper.js 调用）
    cat <<EOF
{
  "success": true,
  "cleaned": {
    "coreDump": $core_dump_count,
    "macTemp": $mac_temp_count,
    "dsStore": $ds_store_count,
    "totalSize": "$total_size_str"
  }
}
EOF

    echo ""
    echo "✓ 垃圾文件清理完成"
}

# 一键安装
install_service() {
    echo "=========================================="
    echo "$SERVICE_NAME - 一键安装"
    echo "=========================================="
    echo ""

    # 获取脚本所在目录
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # 检查 install.sh 是否存在
    if [ ! -f "$SCRIPT_DIR/install.sh" ]; then
        echo "✗ 安装脚本不存在: $SCRIPT_DIR/install.sh"
        echo ""
        echo "请确保 MMM-TClient 仓库完整"
        exit 1
    fi

    # 调用安装脚本
    cd "$SCRIPT_DIR" || exit 1
    bash ./install.sh

    if [ $? -eq 0 ]; then
        echo ""
        echo "=========================================="
        echo "✓ 安装完成！"
        echo "=========================================="
        echo ""
        echo "下一步:"
        echo "  cd $WORK_DIR"
        echo "  $0 start    # 启动服务"
        echo "  $0 status   # 查看状态"
    else
        echo ""
        echo "✗ 安装失败，请检查错误信息"
        exit 1
    fi
}

# 主程序
main() {
    case "$1" in
        install)
            install_service
            ;;
        start)
            start_service
            ;;
        stop)
            stop_service
            ;;
        restart)
            restart_service
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        cleanup)
            cleanup_service
            ;;
        clean)
            cleanup_trash
            ;;
        help|--help|-h|"")
            show_help
            ;;
        *)
            echo "错误: 未知命令 '$1'"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# 执行主程序
main "$@"
