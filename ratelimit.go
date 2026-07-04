package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimiter 是纯内存的滑动窗口限流器。
// 由于服务是单进程常驻运行（不像 PHP-FPM 那样每个请求可能是独立进程），
// 直接用内存 map 就够了，不需要落盘，重启后计数自然清零。
type RateLimiter struct {
	mu          sync.Mutex
	attempts    map[string]*attemptRecord
	maxAttempts int
	window      time.Duration
}

type attemptRecord struct {
	count int
	start time.Time
}

func NewRateLimiter(maxAttempts int, windowSeconds int) *RateLimiter {
	return &RateLimiter{
		attempts:    make(map[string]*attemptRecord),
		maxAttempts: maxAttempts,
		window:      time.Duration(windowSeconds) * time.Second,
	}
}

func (r *RateLimiter) Allowed(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	rec, ok := r.attempts[key]
	if !ok {
		return true
	}
	if time.Since(rec.start) > r.window {
		delete(r.attempts, key)
		return true
	}
	return rec.count < r.maxAttempts
}

func (r *RateLimiter) RecordFailure(key string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	rec, ok := r.attempts[key]
	if !ok || time.Since(rec.start) > r.window {
		rec = &attemptRecord{count: 0, start: time.Now()}
		r.attempts[key] = rec
	}
	rec.count++
}

// clientIP 决定用什么作为"客户端标识"来做限流。
//
// 安全要点：只有当 trustedHeader 非空时才会读取对应请求头（比如 Cloudflare 的
// CF-Connecting-IP），这个头是客户端能否伪造取决于你的部署方式——
// 详见 config.go 里 TrustProxyHeader 字段的说明。默认（trustedHeader 为空）
// 只使用 TCP 连接本身的来源地址，这个是没法伪造的。
func clientIP(r *http.Request, trustedHeader string) string {
	if trustedHeader != "" {
		if v := r.Header.Get(trustedHeader); v != "" {
			parts := strings.Split(v, ",")
			return strings.TrimSpace(parts[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
