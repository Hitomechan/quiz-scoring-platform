#!/usr/bin/env bash
#
# 在线答题系统 —— 一键部署到 Linux 服务器（Ubuntu / Debian）
#
# 用法（在项目根目录执行）：
#     sudo bash deploy/install.sh
#
# 可选环境变量：
#     PORT=3210              对外端口
#     NODE_VERSION=v20.18.0  要安装的 Node 版本（已装 Node >= 18 则跳过）
#     ADMIN_PASSWORD=xxx     首次启动的初始管理密码（不填则用 admin123）
#
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v20.18.0}"
PORT="${PORT:-3210}"
APP_DIR="/opt/quiz-site"
DATA_DIR="/var/lib/quiz-site"
SERVICE="quiz-site"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[36m%s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { red "请用 root 运行：  sudo bash deploy/install.sh"; exit 1; }

SRC="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC/server.js" ] || { red "没找到 server.js，请在项目根目录执行本脚本"; exit 1; }

blue "==> 1/6  检查系统与基础工具"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates xz-utils >/dev/null
  green "    基础工具就绪"
else
  red "    这个脚本只支持 Debian/Ubuntu（apt）。其他系统请参考 DEPLOY.md 手动部署。"
  exit 1
fi

blue "==> 2/6  检查 Node.js"
NODE_BIN="$(command -v node || true)"
if [ -n "$NODE_BIN" ] && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 18 ]; then
  green "    已有 Node $(node -v)，跳过安装"
else
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  A=x64 ;;
    aarch64|arm64) A=arm64 ;;
    *) red "    不支持的 CPU 架构：$ARCH"; exit 1 ;;
  esac
  PKG="node-${NODE_VERSION}-linux-${A}.tar.xz"
  cd /tmp
  blue "    下载 $PKG （优先用国内镜像）"
  # 国内镜像优先，失败再回退官方源
  curl -fL --retry 3 --connect-timeout 15 -o "$PKG" \
      "https://npmmirror.com/mirrors/node/${NODE_VERSION}/${PKG}" \
    || curl -fL --retry 3 --connect-timeout 15 -o "$PKG" \
      "https://nodejs.org/dist/${NODE_VERSION}/${PKG}"
  rm -rf /usr/local/lib/nodejs
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$PKG" -C /usr/local/lib/nodejs --strip-components=1
  ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node
  ln -sf /usr/local/lib/nodejs/bin/npm  /usr/local/bin/npm  2>/dev/null || true
  ln -sf /usr/local/lib/nodejs/bin/npx  /usr/local/bin/npx  2>/dev/null || true
  rm -f "$PKG"
  green "    Node $(node -v) 安装完成"
fi

blue "==> 3/6  创建运行用户与数据目录"
if ! id -u quiz >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin quiz
  green "    已创建系统用户 quiz"
fi
mkdir -p "$DATA_DIR"
chown -R quiz:quiz "$DATA_DIR"
green "    数据目录：$DATA_DIR"

blue "==> 4/6  部署代码到 $APP_DIR"
mkdir -p "$APP_DIR"
# 只同步运行必需的文件，data/ 与 .git 一律不带过去
for item in server.js package.json public tools README.md DEPLOY.md; do
  [ -e "$SRC/$item" ] || continue
  rm -rf "$APP_DIR/$item"
  cp -r "$SRC/$item" "$APP_DIR/$item"
done
chown -R root:root "$APP_DIR"
green "    代码已就位"

blue "==> 5/6  写入 systemd 服务"
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Quiz Scoring Platform (在线答题系统)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=quiz
Group=quiz
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=${PORT}
Environment=DATA_DIR=${DATA_DIR}
${ADMIN_PASSWORD:+Environment=ADMIN_PASSWORD=${ADMIN_PASSWORD}}
ExecStart=/usr/local/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE}
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
green "    服务已启动"

blue "==> 6/6  自检"
sleep 2
if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
  green "    ✓ 服务响应正常"
else
  red "    ✗ 服务没起来，用下面这条看日志："
  red "      journalctl -u ${SERVICE} -n 50 --no-pager"
  exit 1
fi

IP="$(curl -fsS --max-time 5 https://ipinfo.io/ip 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
echo
green "=================================================="
green "  部署完成！"
green "=================================================="
echo   "  答题首页   http://${IP}:${PORT}/"
echo   "  管理后台   http://${IP}:${PORT}/admin"
echo
echo   "  常用命令："
echo   "    查看状态   systemctl status ${SERVICE}"
echo   "    查看日志   journalctl -u ${SERVICE} -f"
echo   "    重启       systemctl restart ${SERVICE}"
echo   "    停止       systemctl stop ${SERVICE}"
echo
echo   "  数据文件   ${DATA_DIR}/db.json   （备份直接复制这个文件）"
echo
blue   "  ⚠ 一定要先在云控制台的「防火墙 / 安全组」放行 TCP ${PORT}，否则外网打不开。"
echo
blue   "  ⚠ 首次登录后请到「系统设置」修改管理密码。"
echo
