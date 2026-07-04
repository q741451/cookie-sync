# Cookie Channel Sync

[English](README.md) | [中文](README.zh-CN.md)

Sync browser cookies to your own server, grouped by "channel" — a single-file
Go binary plus a Chrome extension, for personal / small-group use.

> Built for your own server, not for the Chrome Web Store. No built-in HTTPS
> by design — meant to sit behind [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
> or another reverse proxy.

## Features

- 📦 **Zero-dependency single binary** — GitHub Actions cross-compiles Linux / macOS / Windows builds, download straight from Releases
- 🔑 **Channel name + separate key** two-factor auth; keys are bcrypt-hashed at rest and shown in plaintext only once
- 👥 **Per-channel isolation** — each channel keeps its own server address, so different groups (or even different servers) never mix; sites can be routed to specific channels via rules, everything else falls back to a default channel
- 🛡️ Hardened against brute force, timing attacks, path traversal, and umask-related permission leaks (see "Security design" below)
- 🌐 Rate limiting understands Cloudflare (`CF-Connecting-IP`) natively — no public port needed at all when using Tunnel
- 🌍 Extension UI available in English and Chinese, following your browser's language
- 🧩 Manual upload/download only — no background auto-sync

## Quick start

### 1. Download the server binary

Grab the build for your platform from [Releases](../../releases), e.g.
`cookie-sync-server-linux-amd64` for a Linux VPS.

### 2. Configure

```bash
chmod +x cookie-sync-server-linux-amd64
cp config.example.json config.json
```

Open `config.json` and **at least set `registration_secret` to a random
string**:
```bash
openssl rand -hex 16
```

### 3. Run

```bash
./cookie-sync-server-linux-amd64 -config config.json
```

Listens on `127.0.0.1:8787` by default — local only.

### 4. Expose it via Cloudflare Tunnel (recommended)

```bash
cloudflared tunnel login
cloudflared tunnel create cookie-sync
cloudflared tunnel route dns cookie-sync sync.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8787 cookie-sync
```
No inbound port needed on your server at all; HTTPS is handled by
Cloudflare's edge.

After Tunnel is set up, set `trust_proxy_header` to `"CF-Connecting-IP"` in
`config.json` so rate limiting works per real visitor IP. **This is only
safe when using Tunnel with no directly reachable origin port** — see
[go-server/README.md](go-server/README.md) for why.

### 5. Install the Chrome extension

Load the `extension/` folder (`chrome://extensions` → Developer mode →
"Load unpacked"), open its settings page, add a channel, and you're set.

## Run as a systemd service (production)

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

## Build from source / cut your own release

```bash
cd go-server
go mod tidy
go build .
```

Pushing a tag triggers CI to cross-compile and publish a GitHub Release:
```bash
git tag v1.0.0
git push origin v1.0.0
```

## Security design

| Risk | Mitigation |
|---|---|
| Brute-forcing a channel key | Per-IP failed-attempt rate limiting + bcrypt (slow hash) |
| Timing attack to detect whether a channel exists | A dummy bcrypt check always runs even when the channel is missing, equalizing response time |
| Path traversal / directory enumeration | Channel names are SHA-256 hashed before being used as filenames |
| Strangers creating unlimited channels | Channel creation requires a `registration_secret` known only to the operator |
| Loose file permissions from umask | Files are `chmod 0600` explicitly after writing, regardless of the system umask |
| Forged IP headers bypassing rate limits | Only the raw TCP connection's source is trusted by default; `trust_proxy_header` must be set explicitly |
| Plaintext transport | Left to Cloudflare Tunnel / your reverse proxy — out of scope for this binary |

Full details, including exactly when it's safe to trust Cloudflare's IP
header, are in [go-server/README.md](go-server/README.md).

## Known limitations

- Data is kept forever; nothing expires automatically — delete files under
  `data/channels/` manually if needed
- Cookie contents aren't additionally encrypted at rest; security relies on
  keeping the channel key secret plus correct file permissions
- Concurrent uploads to the same domain within a channel overwrite each
  other, with no merging
- Rate-limit counters live in memory and reset when the server restarts

## Repository layout

```
go-server/    Go server source + GitHub Actions workflows
extension/    Chrome extension (English/Chinese UI)
```
