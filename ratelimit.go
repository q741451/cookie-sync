package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimiter is a purely in-memory sliding-window limiter.
// Since the service runs as a single long-lived process (unlike PHP-FPM,
// where each request may be a separate process), an in-memory map is
// enough — no need to persist to disk, and counts reset naturally on
// restart.
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

// clientIP decides what identity to use for rate limiting.
//
// Security note: trustedHeader is only consulted when non-empty (e.g.
// Cloudflare's CF-Connecting-IP). Whether that header can be forged depends
// entirely on your deployment — see the TrustProxyHeader comment in
// config.go. By default (trustedHeader empty) only the raw TCP connection's
// source address is used, which cannot be forged.
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
