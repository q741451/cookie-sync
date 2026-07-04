package main

import (
	"flag"
	"log"
	"net/http"
)

func main() {
	configPath := flag.String("config", "config.json", "path to config file (JSON)")
	listenOverride := flag.String("listen", "", "override listen address from config, e.g. 127.0.0.1:8787")
	flag.Parse()

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("failed to load config %s: %v", *configPath, err)
	}
	if *listenOverride != "" {
		cfg.ListenAddr = *listenOverride
	}

	if cfg.RegistrationSecret == "" {
		log.Println("⚠️  警告：registration_secret 为空，任何人都能对本服务器无限创建频道，生产环境强烈建议设置")
	}
	if cfg.TrustProxyHeader != "" {
		log.Printf("⚠️  已配置信任请求头 %q 作为客户端IP来源，请确认这个头不会被绕过伪造（详见 README「关于 Cloudflare」一节）", cfg.TrustProxyHeader)
	}

	store, err := NewStore(cfg.DataDir)
	if err != nil {
		log.Fatalf("failed to init storage at %s: %v", cfg.DataDir, err)
	}

	rl := NewRateLimiter(cfg.RateLimitMaxAttempts, cfg.RateLimitWindowSeconds)
	srv := NewServer(cfg, store, rl)

	mux := http.NewServeMux()
	// 接口路径特意保留 .php 后缀，是为了跟同项目里的 Chrome 插件 100% 兼容——
	// 插件只认这几个路径字符串，并不关心背后到底是 PHP 还是 Go 在处理，
	// 这样切换后端时插件端不用改一行代码。
	mux.HandleFunc("/api/create_channel.php", srv.handleCreateChannel)
	mux.HandleFunc("/api/upload.php", srv.handleUpload)
	mux.HandleFunc("/api/download.php", srv.handleDownload)
	mux.HandleFunc("/api/list_domains.php", srv.handleListDomains)

	log.Printf("cookie-sync-go 正在监听 %s", cfg.ListenAddr)
	log.Printf("本程序不内置 HTTPS，请通过 Cloudflare Tunnel 或反向代理来提供 TLS，不要把 %s 直接暴露在公网上", cfg.ListenAddr)

	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatalf("server stopped: %v", err)
	}
}
