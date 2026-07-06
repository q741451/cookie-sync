# Cookie Channel Sync

[English](README.md) | [中文](README.zh-CN.md)

按「频道」分组，把浏览器 Cookie 同步到你自己的服务器 —— 单文件 Go 二进制
+ Chrome 插件，供个人 / 小圈子内部使用。

> 面向自己的服务器，不追求发布到 Chrome 应用商店。默认不内置 HTTPS，
> 设计上配合 [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 或反向代理使用。

## 特性

- 📦 **零依赖单文件二进制**，GitHub Actions 自动交叉编译 Linux / macOS / Windows，Release 页直接下载
- 🔑 **频道名 + 读写/只读双密钥**：创建频道时生成两把互相独立的密钥——读写密钥可上传+下载，只读密钥只能下载、无法覆盖数据；两者都用 bcrypt 加密存储，只在创建时明文返回一次
- 👥 **按频道隔离**：每个频道各自记录服务器地址，不同用途（甚至不同服务器）互不干扰；可以给特定网站配规则走特定频道，其余网站统一走默认频道
- 🛡️ 针对暴力破解、计时攻击、路径穿越、umask权限漏洞都做了专门加固（见下方「安全设计」）
- 🌐 限流原生支持 Cloudflare（`CF-Connecting-IP`），配合 Tunnel 完全不用开放公网端口
- 🌍 插件界面支持中英文，跟随浏览器语言自动切换
- 🧩 只做手动上传/下载，不做后台自动同步

## 快速开始

### 1. 下载服务端可执行文件

去 [Releases](../../releases) 页下载对应平台的文件，比如 Linux 服务器用
`cookie-sync-server-linux-amd64`。

### 2. 配置

```bash
chmod +x cookie-sync-server-linux-amd64
cp config.example.json config.json
```

打开 `config.json`，**至少把 `registration_secret` 改成一个随机字符串**：
```bash
openssl rand -hex 16
```

### 3. 运行

```bash
./cookie-sync-server-linux-amd64 -config config.json
```

默认监听 `127.0.0.1:8787`，只在本机可访问。

### 4. 用 Cloudflare Tunnel 对外提供服务（推荐）

```bash
cloudflared tunnel login
cloudflared tunnel create cookie-sync
cloudflared tunnel route dns cookie-sync sync.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8787 cookie-sync
```
不需要在服务器上开放任何入站端口，HTTPS 由 Cloudflare 边缘节点提供。

配好 Tunnel 后，把 `config.json` 里的 `trust_proxy_header` 设为
`"CF-Connecting-IP"`，这样限流会按访客真实 IP 生效。**只有在用 Tunnel、
源站没有公网可直连端口的前提下这样设置才安全**，原因详见
[go-server/README.md](go-server/README.md)（英文）。

### 5. 安装 Chrome 插件

加载 `extension/` 目录（`chrome://extensions` → 开发者模式 → 加载已解压的
扩展程序），打开设置页添加一个频道即可开始使用。

## 用 systemd 常驻（生产部署）

```ini
# /etc/systemd/system/cookie-sync.service
[Unit]
Description=Cookie Channel Sync Server
After=network.target

[Service]
Type=simple
User=cookiesync
WorkingDirectory=/opt/cookie-sync
ExecStart=/opt/cookie-sync/cookie-sync-server-linux-amd64 -config /opt/cookie-sync/config.json
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
```bash
useradd -r -s /sbin/nologin cookiesync
systemctl enable --now cookie-sync
```

## 从源码构建 / 自己发布 Release

```bash
cd go-server
go mod tidy
go build .
```

打 tag 会自动触发 CI 交叉编译并发布到 Release：
```bash
git tag v1.0.0
git push origin v1.0.0
```

## 安全设计

| 风险点 | 应对方式 |
|---|---|
| 暴力破解频道密钥 | 基于 IP 的失败次数限流 + bcrypt 慢哈希 |
| 计时攻击探测频道是否存在 / 密钥属于哪个权限档 | 无论频道是否存在、密钥命中读写档还是只读档，都会执行等量的 bcrypt 校验，抹平耗时差异 |
| 单把密钥泄露导致数据被覆盖 | 读写密钥与只读密钥相互独立、互不可推导；只读密钥被使用方持有也无法上传覆盖数据 |
| 路径穿越 / 目录枚举 | 频道名 SHA256 哈希后才作为文件名 |
| 陌生人无限建频道占用资源 | 建频道需要只有站长知道的 `registration_secret` 口令 |
| umask 导致文件权限过松 | 落盘后显式 `chmod 0600`，不依赖系统 umask |
| 伪造 IP 头绕过限流 | 默认只信任 TCP 连接本身来源，`trust_proxy_header` 需显式配置 |
| 传输过程明文 | 交给 Cloudflare Tunnel / 反向代理做 TLS，不在本程序范围内 |

更详细的解释（包括「什么情况下能信任 Cloudflare 的 IP 头」）见
[go-server/README.md](go-server/README.md)（英文）。

> **升级须知**：读写/只读密钥分离改变了频道数据的存储结构（`key_hash`
> 拆分为 `write_key_hash` / `read_key_hash`）。如果你已经在旧版本上创建过
> 频道，升级后这些频道的鉴权会失效，需要用新版本重新创建频道。

## 已知限制

- 数据永久保存，不自动过期，需要清理请手动删除 `data/channels/` 下对应文件
- 不对存储内容做额外加密，安全性依赖密钥保密 + 文件权限
- 同频道内多设备同时上传同一域名会后写覆盖前写，不做合并
- 限流计数存在内存里，重启进程会清零

## 目录结构

```
go-server/    Go 服务端源码 + GitHub Actions 工作流
extension/    Chrome 插件（界面支持中/英文）
```
