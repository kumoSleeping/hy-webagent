#!/bin/bash
# pi-web-platform 图片渲染微服务启动脚本
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RENDER_DIR="$SCRIPT_DIR/server/src/render"
VENV="/Users/kumo/git/kumocode_v2/dev.entari/.venv"

if [ ! -d "$VENV" ]; then
    echo "❌ 虚拟环境不存在: $VENV"
    echo "   请先设置 dev.entari: cd kumocode_v2/dev.entari && uv sync"
    exit 1
fi

cd "$RENDER_DIR"
echo "🎨 启动 pi-render 微服务 (http://127.0.0.1:5151)"
exec "$VENV/bin/python" service.py --host 127.0.0.1 --port 5151
