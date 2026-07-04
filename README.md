# Cookie Channel Sync

按「频道」分组，把浏览器 Cookie 手动同步到你自己的服务器 —— 单文件 Go 二进制，
零运行时依赖，配合 Chrome 插件使用。仅供个人 / 小圈子内部使用。

> 面向自己的服务器，不追求发布到 Chrome 应用商店。默认不内置 HTTPS，
> 设计上配合 [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 或反向代理使用。

## 特性

- 📦 **零依赖单文件二进制**，GitHub Actions 自动交叉编译 Linux / macOS / Windows，Release 页直接下载
- 🔑 **频道名 + 独立密钥**两段式鉴权，密钥 bcrypt 加密存储，只在创建时明文返回一次
- 👥 **多组人群隔离**，不同频道数据互不干扰，同频道内按域名分组
- 🛡️ 面向暴力破解 / 计时攻击 / 目录枚举 / umask 权限漏洞做了针对性加固（见下方「安全设计」）
- 🌐 限流逻辑原生适配 Cloudflare（`CF-Connecting-IP`），Tunnel 模式下无需公网开放端口
- 🧩 配套 Chrome 插件，手动上传/下载当前网站 Cookie，不做后台自动同步

## 快速开始

### 1. 下载可执行文件

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

配好 Tunnel 后，`config.json` 里把 `trust_proxy_header` 设为 `"CF-Connecting-IP"`，
这样限流会按访客真实 IP 生效。**只有在用 Tunnel、源站没有公网可直连端口的前提下
这样设置才安全**——如果你是直接开放公网端口只是套了层代理，不要这样设，详见
[go-server/README.md](go-server/README.md) 里的说明。

### 5. 安装 Chrome 插件

加载 `extension/` 目录（`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序），
打开插件设置页，填服务器地址，创建频道即可开始使用。

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
go mod tidy
go build .
```

打 tag 会自动触发 CI 交叉编译并发布到 Release：
```bash
git tag v1.0.1
git push origin v1.0.1
```

## 安全设计

| 风险点 | 应对方式 |
|---|---|
| 暴力破解频道密钥 | 基于 IP 的失败次数限流 + bcrypt 慢哈希 |
| 计时攻击探测频道是否存在 | 频道不存在时也执行一次哑值 bcrypt 校验，抹平耗时差异 |
| 路径穿越 / 目录枚举 | 频道名 SHA256 哈希后才作为文件名 |
| 陌生人无限建频道占用资源 | 建频道需要额外的 `registration_secret` 口令 |
| umask 导致文件权限过松 | 落盘后显式 `chmod 0600`，不依赖系统 umask |
| 伪造 IP 头绕过限流 | 默认只信任 TCP 连接本身来源，`trust_proxy_header` 需显式配置 |
| 传输过程明文 | 交给 Cloudflare Tunnel / 反向代理做 TLS，不在本程序范围内 |

更详细的解释和「什么情况下能信任 Cloudflare 的 IP 头」说明，见
[go-server/README.md](go-server/README.md)。

## 已知限制

- 数据永久保存，不自动过期，需要清理请手动删除 `data/channels/` 下对应文件
- 不对存储内容做额外加密，安全性依赖频道密钥保密 + 文件权限
- 同频道内多人同时上传同一域名会后写覆盖前写，不做合并
- 限流计数存在内存里，重启进程会清零

## 目录结构

```
go-server/    Go 服务端源码 + GitHub Actions 工作流
extension/    Chrome 插件
server/       PHP 版实现（历史版本，功能对齐但不再更新，需要的话仍可用）
```
