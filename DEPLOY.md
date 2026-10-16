# 部署到国内服务器（腾讯云 / 阿里云轻量应用服务器）

本文档是从零到上线的完整步骤，全程约 **20 分钟**，费用约 **￥50~100 / 年**。

> 为什么选国内轻量服务器？
> 国外免费平台（Vercel / Netlify / Render / Cloudflare Workers）的默认域名在国内要么被 DNS 污染、要么绕道美国节点；而且它们的磁盘是临时的，本项目的 `data/db.json` 存不住。
> 国内服务器延迟只有 10~30ms，而且**只要不绑域名、直接用 `IP:端口` 访问，就不需要 ICP 备案**。

---

## 一、买服务器

腾讯云或阿里云都行，选 **轻量应用服务器**（不是 ECS/CVM，轻量更便宜且自带防火墙面板）。

| 项目 | 建议 |
| --- | --- |
| 地域 | 选离你近的（如上海 / 广州 / 北京） |
| 配置 | **2核2G** 足够；1核1G 也能跑（本项目零依赖、内存占用约 50MB） |
| 系统镜像 | **Ubuntu 22.04 LTS** 或 **Ubuntu 24.04 LTS** |
| 带宽 | 3Mbps 起（纯文字答题完全够） |
| 价格 | 新用户首年常见 ￥50~99；学生认证后更便宜 |

买完在控制台记下两样东西：

- **公网 IP**（形如 `123.45.67.89`）
- **root 密码**（在控制台「重置密码」里设置）

---

## 二、放行端口 ⚠️ 最容易忘的一步

本项目默认监听 **3210** 端口。必须在云控制台放行，否则外网永远打不开。

**腾讯云轻量**：控制台 → 轻量应用服务器 → 点进你的实例 → 「防火墙」→ 添加规则
- 应用类型：自定义
- 协议：**TCP**
- 端口：**3210**
- 来源：`0.0.0.0/0`

**阿里云轻量**：控制台 → 服务器 → 「防火墙」→ 添加规则 → TCP / 3210

> 服务器里如果还开着 ufw，也要放行：`ufw allow 3210/tcp`

---

## 三、连上服务器

Windows 自带 SSH，直接开 PowerShell：

```powershell
ssh root@你的公网IP
```

第一次会问 `yes/no`，输 `yes`，然后输密码（输入时屏幕不显示，正常）。

---

## 四、上传代码

### 方式 A：从你的 Windows 电脑直接传（推荐，最快）

**不要**在服务器上操作，回到你**自己的电脑**开一个新的 PowerShell，进到项目所在的目录：

```powershell
cd C:\Users\Administrator\Documents\deepseek-harness\dsf-workspace
scp -r quiz-site root@你的公网IP:/opt/
```

> `scp` 会把 `data/` 目录一起传过去（里面有你的试卷和成绩），这正是你想要的。
> 如果提示 `scp 不是内部或外部命令`，说明系统太旧，用方式 B。

### 方式 B：在服务器上 git clone

```bash
cd /opt
git clone https://github.com/Hitomechan/quiz-scoring-platform.git quiz-site
```

> 国内直连 GitHub 可能很慢或失败。多试几次，或者用手机热点。
> 注意：仓库里**没有** `data/`（数据不会被提交），所以第一次启动是空题库，需要重新出题或从本地再传一份 `db.json`：
> ```powershell
> scp quiz-site\data\db.json root@你的公网IP:/var/lib/quiz-site/
> ```

---

## 五、一键部署

回到**服务器的 SSH 窗口**：

```bash
cd /opt/quiz-site
sudo bash deploy/install.sh
```

脚本会自动完成：

1. 装好 `curl / xz-utils` 等基础工具
2. 安装 **Node.js 20**（优先走淘宝镜像，国内很快；已有 Node ≥18 则跳过）
3. 创建系统用户 `quiz` 和数据目录 `/var/lib/quiz-site`
4. 把代码同步到 `/opt/quiz-site`
5. 写入并启动 systemd 服务（**开机自启 + 崩溃自动重启**）
6. 自检并打印访问地址

结束时你会看到：

```
==================================================
  部署完成！
==================================================
  答题首页   http://123.45.67.89:3210/
  管理后台   http://123.45.67.89:3210/admin
```

---

## 六、首次登录

1. 浏览器打开 `http://你的公网IP:3210/admin`
2. 初始密码 **`admin123`**（除非你在部署时设了 `ADMIN_PASSWORD` 环境变量）
3. **立刻去「系统设置」→ 修改管理密码** ⚠️

然后就可以建试卷、出题、点「发布」，把链接和二维码发出去答题了。

> 答题页给出的是 `http://你的公网IP:3210/p/XXXXXXXX`，这个链接任何人打开都能答题，**不需要备案**。

---

## 七、日常维护

```bash
systemctl status quiz-site      # 查看运行状态
journalctl -u quiz-site -f      # 实时看日志（Ctrl+C 退出）
systemctl restart quiz-site     # 重启
systemctl stop quiz-site        # 停止
```

### 备份数据（重要）

所有试卷、题目、成绩、密码都在**一个文件**里：

```
/var/lib/quiz-site/db.json
```

设个每天凌晨 3 点自动备份，只保留最近 30 天：

```bash
crontab -e
```

加上这一行：

```cron
0 3 * * * mkdir -p /root/quiz-backup && cp /var/lib/quiz-site/db.json /root/quiz-backup/db-$(date +\%F).json && find /root/quiz-backup -name 'db-*.json' -mtime +30 -delete
```

想把它拉回自己电脑：

```powershell
scp root@你的公网IP:/var/lib/quiz-site/db.json .\quiz-backup\db.json
```

### 升级代码

```bash
cd /opt/quiz-site
# 方式 A：重新上传覆盖后
sudo bash deploy/install.sh
# 方式 B：git 拉取后
git pull && sudo bash deploy/install.sh
```

> 数据在 `/var/lib/quiz-site`，不在代码目录里，所以升级**不会**动到试卷和成绩。

### 用 Docker 部署（可选）

服务器上装了 Docker 的话，也可以：

```bash
cd /opt/quiz-site
docker compose up -d --build
docker compose logs -f
```

---

## 八、进阶：绑域名 + HTTPS（可选）

用 `IP:3210` 已经能用，但有两个缺点：地址难记，且 **HTTP 明文传输管理密码和登录令牌**。如果在意，可以：

1. 买个域名（`.top` / `.xyz` 首年几块钱），解析 A 记录到你的公网 IP
2. **国内服务器绑域名必须完成 ICP 备案**（在云厂商控制台提交，一般 7~20 个工作日）
3. 备案通过后装 Caddy，自动申请并续期 HTTPS：

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

编辑 `/etc/caddy/Caddyfile`：

```
答题.example.com {
    reverse_proxy 127.0.0.1:3210
}
```

```bash
systemctl reload caddy
```

之后用 `https://答题.example.com` 访问，证书自动续期。原来的 3210 端口可以在安全组里删掉。

> 不想备案的话：把服务器换成**香港 / 新加坡**地域即可，国内访问延迟 30~60ms，不需要备案。

---

## 九、常见问题

**Q：浏览器打不开 `http://IP:3210`**
1. 服务器上先自测：`curl http://127.0.0.1:3210/healthz`，返回 `{"ok":true,...}` 说明服务正常
2. 服务正常但外网打不开 → **99% 是云控制台的防火墙/安全组没放行 3210**
3. 还不行看日志：`journalctl -u quiz-site -n 50 --no-pager`

**Q：端口 3210 被占用**
改 `/etc/systemd/system/quiz-site.service` 里的 `Environment=PORT`，然后 `systemctl daemon-reload && systemctl restart quiz-site`，别忘了安全组也要放行新端口。

**Q：答题页提示「试卷不存在或尚未发布」**
在后台把该试卷点一下**「发布」**。草稿状态的链接打不开。

**Q：会不会丢数据？**
数据是单个 JSON 文件，正常使用不会丢。但**没有自动备份**的话，误删服务器就没了 —— 请务必按上面配好定时备份。

**Q：能给多少人同时用？**
纯文字答题，2核2G 跑几百人并发没问题。真正的瓶颈是带宽，3Mbps 大约能支撑几百人同时提交。

**Q：怎么改成学生只能用一次 / 需要账号？**
目前是「拿到链接就能答，可选答题口令」。如果需要按人分发账号，告诉我，可以加。

---

## 附：手动部署（不想用脚本）

```bash
# 1. 装 Node 20
cd /tmp
curl -fLO https://npmmirror.com/mirrors/node/v20.18.0/node-v20.18.0-linux-x64.tar.xz
mkdir -p /usr/local/lib/nodejs
tar -xJf node-v20.18.0-linux-x64.tar.xz -C /usr/local/lib/nodejs --strip-components=1
ln -s /usr/local/lib/nodejs/bin/node /usr/local/bin/node

# 2. 放代码
mkdir -p /opt/quiz-site /var/lib/quiz-site
# （把 server.js 和 public/ 传到 /opt/quiz-site）

# 3. 开机自启
cp /opt/quiz-site/deploy/quiz-site.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now quiz-site

# 4. 看状态
systemctl status quiz-site
```
