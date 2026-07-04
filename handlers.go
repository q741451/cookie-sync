package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	cfg       Config
	store     *Store
	rl        *RateLimiter
	dummyHash []byte // fixed dummy hash used for timing-safe auth checks, see authenticate()
}

func NewServer(cfg Config, store *Store, rl *RateLimiter) *Server {
	dummy, err := bcrypt.GenerateFromPassword([]byte("dummy-fixed-value-for-timing-safety"), cfg.BcryptCost)
	if err != nil {
		log.Fatalf("failed to init dummy hash: %v", err)
	}
	return &Server{cfg: cfg, store: store, rl: rl, dummyHash: dummy}
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

var channelNameRe = regexp.MustCompile(`^[a-zA-Z0-9_\-\p{Han}]{1,64}$`)

func generateChannelKey() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	ip := clientIP(r, s.cfg.TrustProxyHeader)
	if !s.rl.Allowed(ip) {
		errJSON(w, http.StatusTooManyRequests, "too many attempts from your IP, please try again later")
		return
	}

	// Registration secret: the operator's own "master switch", separate
	// from channel keys. Channel keys are shared with group members to
	// read/write data; this secret is known only to the operator, and
	// prevents strangers from creating unlimited channels on your server.
	if s.cfg.RegistrationSecret != "" {
		provided := r.Header.Get("X-Register-Secret")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(s.cfg.RegistrationSecret)) != 1 {
			s.rl.RecordFailure(ip)
			errJSON(w, http.StatusForbidden, "invalid registration secret")
			return
		}
	}

	var body struct {
		ChannelName string `json:"channel_name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid json body")
		return
	}

	name := strings.TrimSpace(body.ChannelName)
	if !channelNameRe.MatchString(name) {
		errJSON(w, http.StatusBadRequest, "invalid channel name (1-64 chars; letters, numbers, _, -, or Chinese)")
		return
	}

	if s.cfg.MaxChannels > 0 {
		count, err := s.store.CountChannels()
		if err == nil && count >= s.cfg.MaxChannels {
			errJSON(w, http.StatusForbidden, "channel limit reached on this server")
			return
		}
	}

	key, err := generateChannelKey()
	if err != nil {
		log.Printf("generate key error: %v", err)
		errJSON(w, http.StatusInternalServerError, "internal error")
		return
	}

	if _, err := s.store.CreateChannel(name, key, s.cfg.BcryptCost); err != nil {
		if err == ErrChannelExists {
			errJSON(w, http.StatusConflict, "channel name already taken, please choose another one")
			return
		}
		log.Printf("create channel error: %v", err)
		errJSON(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"channel_name": name,
		"channel_key":  key,
		"notice":       "Please save the channel key now. The server will never show the plaintext key again.",
	})
}

// authenticate checks X-Channel-Name / X-Channel-Key, recording failures
// against the rate limiter.
//
// Timing safety: a bcrypt check always runs, even when the channel doesn't
// exist (against a fixed dummy hash), so "channel doesn't exist" and
// "channel exists but key is wrong" take roughly the same time. This
// prevents an attacker from telling which channel names are real just by
// measuring response latency.
func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) (*ChannelData, bool) {
	ip := clientIP(r, s.cfg.TrustProxyHeader)
	if !s.rl.Allowed(ip) {
		errJSON(w, http.StatusTooManyRequests, "too many attempts from your IP, please try again later")
		return nil, false
	}

	name := r.Header.Get("X-Channel-Name")
	key := r.Header.Get("X-Channel-Key")
	if name == "" || key == "" {
		s.rl.RecordFailure(ip)
		errJSON(w, http.StatusUnauthorized, "invalid channel name or key")
		return nil, false
	}

	data, err := s.store.ReadChannel(name)
	if err != nil {
		log.Printf("read channel error: %v", err)
		errJSON(w, http.StatusInternalServerError, "internal error")
		return nil, false
	}

	hashToCheck := s.dummyHash
	if data != nil {
		hashToCheck = []byte(data.KeyHash)
	}
	matchErr := bcrypt.CompareHashAndPassword(hashToCheck, []byte(key))

	if data == nil || matchErr != nil {
		s.rl.RecordFailure(ip)
		errJSON(w, http.StatusUnauthorized, "invalid channel name or key")
		return nil, false
	}

	return data, true
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	data, ok := s.authenticate(w, r)
	if !ok {
		return
	}

	const maxBody = 512 * 1024
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		errJSON(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	if len(body) > maxBody {
		errJSON(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}

	var payload struct {
		Domain  string                   `json:"domain"`
		Cookies []map[string]interface{} `json:"cookies"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid json body")
		return
	}

	domain := strings.TrimSpace(payload.Domain)
	if domain == "" || payload.Cookies == nil {
		errJSON(w, http.StatusBadRequest, "domain and cookies are required")
		return
	}
	if len(payload.Cookies) > 500 {
		errJSON(w, http.StatusBadRequest, "too many cookies in one request")
		return
	}

	if err := s.store.UpsertDomain(data.ChannelName, domain, payload.Cookies); err != nil {
		log.Printf("upsert domain error: %v", err)
		errJSON(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":     true,
		"domain": domain,
		"count":  len(payload.Cookies),
	})
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	data, ok := s.authenticate(w, r)
	if !ok {
		return
	}

	domain := strings.TrimSpace(r.URL.Query().Get("domain"))
	entry, found := data.Domains[domain]
	if domain == "" || !found {
		errJSON(w, http.StatusNotFound, "no data found for this domain in this channel")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":         true,
		"domain":     domain,
		"cookies":    entry.Cookies,
		"updated_at": entry.UpdatedAt,
	})
}

func (s *Server) handleListDomains(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	data, ok := s.authenticate(w, r)
	if !ok {
		return
	}

	type item struct {
		Domain    string `json:"domain"`
		UpdatedAt int64  `json:"updated_at"`
	}
	list := make([]item, 0, len(data.Domains))
	for d, e := range data.Domains {
		list = append(list, item{Domain: d, UpdatedAt: e.UpdatedAt})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "domains": list})
}
