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
		log.Println("WARNING: registration_secret is empty. Anyone can create unlimited channels on this server. Set one before exposing this to the internet.")
	}
	if cfg.TrustProxyHeader != "" {
		log.Printf("WARNING: trusting header %q as the client IP source. Make sure this header cannot be spoofed by bypassing your proxy (see README, section \"About Cloudflare\").", cfg.TrustProxyHeader)
	}

	store, err := NewStore(cfg.DataDir)
	if err != nil {
		log.Fatalf("failed to init storage at %s: %v", cfg.DataDir, err)
	}

	rl := NewRateLimiter(cfg.RateLimitMaxAttempts, cfg.RateLimitWindowSeconds)
	srv := NewServer(cfg, store, rl)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/create_channel", srv.handleCreateChannel)
	mux.HandleFunc("/api/upload", srv.handleUpload)
	mux.HandleFunc("/api/download", srv.handleDownload)
	mux.HandleFunc("/api/list_domains", srv.handleListDomains)

	log.Printf("cookie-sync-go listening on %s", cfg.ListenAddr)
	log.Printf("This binary does not terminate TLS itself. Put it behind Cloudflare Tunnel or a reverse proxy; do not expose %s directly to the internet.", cfg.ListenAddr)

	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatalf("server stopped: %v", err)
	}
}
