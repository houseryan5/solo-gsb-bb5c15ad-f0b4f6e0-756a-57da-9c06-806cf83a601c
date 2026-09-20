#!/bin/sh
# entrypoint.sh —— 容器启动时的初始化（幂等）
# 1) 确认依赖已安装（镜像构建阶段已完成；若以源码挂载方式启动则自动补装）
# 2) 输出初始化信息后启动服务
set -e

echo "[entrypoint] 盲文标签排版台初始化..."
echo "[entrypoint] Node: $(node -v)  /  工作目录: $(pwd)"

if [ ! -d "/app/node_modules" ] || [ ! -d "/app/node_modules/express" ]; then
  echo "[entrypoint] 未检测到依赖，执行 npm install（仅源码挂载启动时需要）..."
  if [ -f /app/package-lock.json ]; then
    npm ci --omit=dev --no-audit --no-fund
  else
    npm install --omit=dev --no-audit --no-fund
  fi
fi

echo "[entrypoint] 初始化完成，启动服务（端口 ${PORT:-3000}）..."
exec "$@"
