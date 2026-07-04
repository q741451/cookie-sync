package main

import (
	"encoding/json"
	"os"
)

// Config 对应 config.json 的结构。
// 所有字段都有合理默认值，配置文件缺失字段时会用默认值填充。
type Config struct {
	// 监听地址。默认只监听 127.0.0.1，配合 Cloudflare Tunnel 使用时
	// 不需要（也不应该）直接对公网暴露端口。
	ListenAddr string `json:"listen_addr"`

	// 数据存储目录
	DataDir string `json:"data_dir"`

	// bcrypt 加密频道密钥时的 cost 参数，越大越安全但越慢
	BcryptCost int `json:"bcrypt_cost"`

	// 暴力破解防护：同一"来源标识"（见 TrustProxyHeader 说明）在时间窗口内
	// 允许的最大失败尝试次数
	RateLimitMaxAttempts   int `json:"rate_limit_max_attempts"`
	RateLimitWindowSeconds int `json:"rate_limit_window_seconds"`

	// 允许创建的最大频道数量，0 表示不限制
	MaxChannels int `json:"max_channels"`

	// 信任哪个请求头作为客户端真实 IP，用于限流。
	//
	// 留空（默认）：只信任 TCP 连接本身的来源 IP，最安全，但如果你在反向代理
	// 后面，所有请求会显示成同一个代理IP，限流会对所有人一起生效（不精确，
	// 但不会被绕过）。
	//
	// 如果你使用 Cloudflare Tunnel（cloudflared）:
	// 因为 Tunnel 不开放任何入站端口，攻击者不可能绕过 Cloudflare 直连你的服务器，
	// 这种情况下把这里设置为 "CF-Connecting-IP" 是安全的，可以拿到访客真实IP。
	//
	// 如果你只是给公网IP套了个 Cloudflare 代理（橙色云朵）但服务器端口本身仍然
	// 对公网开放：攻击者可以绕过 Cloudflare 直接打你的源站IP，同时伪造
	// CF-Connecting-IP 头，此时信任这个头是不安全的。请用防火墙只放行
	// Cloudflare 的 IP 段，或者干脆用 Tunnel。
	TrustProxyHeader string `json:"trust_proxy_header"`

	// 创建新频道需要携带的口令（放在请求头 X-Register-Secret 里）。
	// 留空表示不启用（不建议在公网环境下留空）。
	RegistrationSecret string `json:"registration_secret"`
}

func defaultConfig() Config {
	return Config{
		ListenAddr:             "127.0.0.1:8787",
		DataDir:                "./data",
		BcryptCost:             10,
		RateLimitMaxAttempts:   10,
		RateLimitWindowSeconds: 900,
		MaxChannels:            20,
		TrustProxyHeader:       "",
		RegistrationSecret:     "",
	}
}

// loadConfig 从指定路径加载配置文件；文件不存在时直接返回默认配置，
// 方便第一次快速试用（生产部署强烈建议自己写一份 config.json，见 config.example.json）。
func loadConfig(path string) (Config, error) {
	cfg := defaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}
