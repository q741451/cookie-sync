package main

import (
	"encoding/json"
	"os"
)

// Config mirrors the structure of config.json.
// Every field has a sane default, so missing fields fall back to defaults.
type Config struct {
	// Listen address. Defaults to 127.0.0.1 only. When used with Cloudflare
	// Tunnel you should not (and don't need to) expose a public port at all.
	ListenAddr string `json:"listen_addr"`

	// Data storage directory.
	DataDir string `json:"data_dir"`

	// bcrypt cost used when hashing channel keys. Higher is slower but safer.
	BcryptCost int `json:"bcrypt_cost"`

	// Brute-force protection: max allowed failed attempts per "identity"
	// (see TrustProxyHeader below) within the time window.
	RateLimitMaxAttempts   int `json:"rate_limit_max_attempts"`
	RateLimitWindowSeconds int `json:"rate_limit_window_seconds"`

	// Max number of channels that may be created. 0 = unlimited.
	MaxChannels int `json:"max_channels"`

	// Which request header to trust as the client's real IP, used for rate
	// limiting.
	//
	// Empty (default): only trust the raw TCP connection's source address.
	// Safest option. If you're behind a reverse proxy, every request will
	// appear to come from the proxy's IP, so rate limiting becomes coarse
	// (applies to everyone together) but cannot be bypassed.
	//
	// If you use Cloudflare Tunnel (cloudflared): since the tunnel doesn't
	// open any inbound port, attackers cannot bypass Cloudflare and connect
	// to your origin directly. In that case it's safe to set this to
	// "CF-Connecting-IP" to get the visitor's real IP.
	//
	// If you merely proxy a public IP through Cloudflare (orange cloud) while
	// the origin port is still open to the internet: an attacker can bypass
	// Cloudflare, connect directly to your origin, and forge the
	// CF-Connecting-IP header themselves. Trusting this header in that setup
	// is unsafe. Either firewall to Cloudflare's IP ranges only, or use
	// Tunnel instead.
	TrustProxyHeader string `json:"trust_proxy_header"`

	// Secret required (via the X-Register-Secret header) to create a new
	// channel. Empty disables this check (not recommended on the public
	// internet).
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

// loadConfig loads the config file at path. If the file doesn't exist, it
// silently falls back to defaults, which is handy for a quick first try.
// Production deployments should ship their own config.json (see
// config.example.json).
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
