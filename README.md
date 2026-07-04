# Cookie Channel Sync - Go Server

跟 `server/`（PHP版）功能、接口、安全设计完全对齐的 Go 版本。单文件二进制，
没有任何运行时依赖（不需要装 PHP、不需要 Composer），配合 GitHub Actions
可以自动交叉编译出 Linux / macOS / Windows 的可执行文件，不用自己搭编译环境。

## 和 PHP 版的区别

- 单进程运行，用进程内互斥锁代替 PHP 的文件锁（flock），逻辑更简单
- **不内置 HTTPS**（按你的要求），设计上就是要配合 Cloudflare Tunnel 或其他
  反向代理使用，由外层提供 TLS
- 限流的"信任代理"逻辑做了泛化：可以指定信任任意一个请求头（比如 Cloudflare
  的 `CF-Connecting-IP`），而不是只认 `X-Forwarded-For`
- 接口路径特意保留了 `.php` 后缀（`/api/upload.php` 等），这样同一套 Chrome
  插件不用改代码就能切换用 PHP 版还是 Go 版

## 快速开始

### 本地直接跑（用于测试）

```bash
go mod tidy
go run . -config config.example.json
```

默认监听 `127.0.0.1:8787`。

### 用 GitHub Actions 自动编译发布

1. 把这个仓库推到你自己的 GitHub
2. 打一个 tag 并推送：
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. Actions 会自动跑起来，编译出 Linux/macOS/Windows 各平台的可执行文件，
   发布到该 tag 对应的 GitHub Release 里，直接下载就能用，不用自己装Go环境编译

### 部署到 VPS

```bash
# 下载对应平台的可执行文件后
cp config.example.json config.json
vim config.json   # 至少把 registration_secret 改成随机字符串

./cookie-sync-server-linux-amd64 -config config.json
```

建议用 `systemd` 常驻：

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
建议专门建一个非 root 用户跑这个服务（`useradd -r -s /sbin/nologin cookiesync`），
即使程序被攻破，攻击者拿到的权限也有限。

## ⚠️ 关于 Cloudflare（既然你打算用它包一层，这几点务必看完）

### 用 Tunnel，别用"开放端口 + 橙色云朵代理"

**强烈推荐用 Cloudflare Tunnel（`cloudflared`）**，原因：

- Tunnel 是 `cloudflared` 进程主动从你的服务器"拨出去"连 Cloudflare，全程不需要
  在你的 VPS 上开放任何入站端口。别人根本连不到你的源站IP，也就没有"绕过
  Cloudflare 直接攻击"这回事。
- 如果你只是给公网IP套一层 Cloudflare 代理（DNS 记录开橙色云朵），你的源站IP
  理论上还是能被人间接查到、直接连接的（历史DNS记录、证书透明度日志等途径都
  可能泄露）。一旦被绕过，Cloudflare 加的所有防护（包括下面说的真实IP）就都
  失效了。

配置 Tunnel 大致流程（官方文档为准）：
```bash
cloudflared tunnel login
cloudflared tunnel create cookie-sync
cloudflared tunnel route dns cookie-sync sync.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8787 cookie-sync
```
这样 `config.json` 里 `listen_addr` 保持 `127.0.0.1:8787` 就行，完全不用对公网开端口。

### 要不要设置 `trust_proxy_header`

- **用 Tunnel**：可以放心把 `trust_proxy_header` 设为 `"CF-Connecting-IP"`，
  这样限流会按访客真实IP生效，而不是所有人共用一个IP。因为走 Tunnel 的话，
  攻击者没有任何办法绕过 Cloudflare 直接连你的服务器伪造这个头。
- **只是套了代理、端口还开着公网**：不建议设置，保持默认空字符串。因为攻击者
  完全可以直连你的源站IP并自己伪造 `CF-Connecting-IP` 头，这时候"信任"这个头
  反而是安全隐患，等于限流被架空。

### HTTPS 到底谁来管

不管用 Tunnel 还是普通代理模式，Cloudflare 到访客浏览器这一段的 HTTPS 都是
Cloudflare 帮你管的。但 Cloudflare 到你源站这一段（"源站到边缘"）也有加密方式的
选择，在 Cloudflare 后台 SSL/TLS 设置里注意别选成 "Off" 或者来源不校验的模式；
用 Tunnel 的话这段直接是走 Cloudflare 私有网络隧道，不用操心这个问题，这也是
推荐用 Tunnel 的另一个原因。

## API

跟 PHP 版完全一致，见 `server/README.md` 里的 API 表格，这里不重复。

## 已知限制

跟 PHP 版一致：数据永久保存不过期、不额外加密存储内容、同频道并发写入同一
域名是后写覆盖前写。另外 Go 版的限流计数存在内存里，重启进程会清零。
