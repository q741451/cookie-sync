package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// DomainEntry holds the cookie data for one domain within one channel.
type DomainEntry struct {
	Cookies   []map[string]interface{} `json:"cookies"`
	UpdatedAt int64                     `json:"updated_at"`
}

// ChannelData is the full content of one channel's file on disk.
//
// A channel has two independent keys instead of one:
//   - WriteKeyHash: can upload (and, since write implies read, also download)
//   - ReadKeyHash:  can only download; uploading with this key is rejected
//
// This lets the owner hand out a read-only key to a device or script that
// should never be able to overwrite the channel's cookie data, without
// giving up the ability to also have a full read-write key for trusted
// devices.
type ChannelData struct {
	ChannelName  string                 `json:"channel_name"`
	WriteKeyHash string                 `json:"write_key_hash"`
	ReadKeyHash  string                 `json:"read_key_hash"`
	CreatedAt    int64                  `json:"created_at"`
	Domains      map[string]DomainEntry `json:"domains"`
}

var (
	ErrChannelExists   = errors.New("channel already exists")
	ErrChannelNotFound = errors.New("channel not found")
)

// Store handles reading and writing channel data.
//
// Concurrency safety here relies on "only one process (this one) accessing
// a given data directory at a time" — it uses in-process mutexes, not
// cross-process file locks. That assumption holds as long as you only run a
// single cookie-sync-go process. Do not point two running instances at the
// same data directory; concurrent writes could still race.
type Store struct {
	dataDir   string
	mu        sync.Mutex
	fileLocks map[string]*sync.Mutex
}

func NewStore(dataDir string) (*Store, error) {
	channelsDir := filepath.Join(dataDir, "channels")
	if err := os.MkdirAll(channelsDir, 0700); err != nil {
		return nil, err
	}
	// Explicitly fix permissions instead of relying on umask.
	if err := os.Chmod(channelsDir, 0700); err != nil {
		return nil, err
	}
	return &Store{
		dataDir:   dataDir,
		fileLocks: make(map[string]*sync.Mutex),
	}, nil
}

func channelHash(name string) string {
	sum := sha256.Sum256([]byte(name))
	return hex.EncodeToString(sum[:])
}

// channelFile uses the SHA256 hash of the channel name as the filename
// instead of the raw name:
//  1. Prevents path traversal (e.g. a channel name containing ../../).
//  2. Prevents recovering channel names by listing the data directory.
func (s *Store) channelFile(name string) string {
	return filepath.Join(s.dataDir, "channels", channelHash(name)+".json")
}

func (s *Store) lockFor(name string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := channelHash(name)
	if l, ok := s.fileLocks[h]; ok {
		return l
	}
	l := &sync.Mutex{}
	s.fileLocks[h] = l
	return l
}

func (s *Store) CountChannels() (int, error) {
	matches, err := filepath.Glob(filepath.Join(s.dataDir, "channels", "*.json"))
	if err != nil {
		return 0, err
	}
	return len(matches), nil
}

func (s *Store) readChannelFile(file string) (*ChannelData, error) {
	b, err := os.ReadFile(file)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var data ChannelData
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// writeChannelFile writes via a temp file + atomic rename, so a crash or
// power loss mid-write can't leave a corrupted file behind.
func (s *Store) writeChannelFile(file string, data *ChannelData) error {
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	// Explicitly fix permissions instead of relying on umask: this file
	// holds the bcrypt key hash and all cookie data for the channel.
	if err := os.Chmod(tmp, 0600); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, file); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// CreateChannel creates a new channel with two independent keys. The
// per-channel mutex plus an existence check right before creating avoids a
// race where two concurrent create requests for the same name could
// overwrite each other.
func (s *Store) CreateChannel(name, writeKey, readKey string, bcryptCost int) (*ChannelData, error) {
	lock := s.lockFor(name)
	lock.Lock()
	defer lock.Unlock()

	file := s.channelFile(name)
	if _, err := os.Stat(file); err == nil {
		return nil, ErrChannelExists
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	writeHash, err := bcrypt.GenerateFromPassword([]byte(writeKey), bcryptCost)
	if err != nil {
		return nil, err
	}
	readHash, err := bcrypt.GenerateFromPassword([]byte(readKey), bcryptCost)
	if err != nil {
		return nil, err
	}

	data := &ChannelData{
		ChannelName:  name,
		WriteKeyHash: string(writeHash),
		ReadKeyHash:  string(readHash),
		CreatedAt:    time.Now().Unix(),
		Domains:      map[string]DomainEntry{},
	}

	if err := s.writeChannelFile(file, data); err != nil {
		return nil, err
	}
	return data, nil
}

func (s *Store) ReadChannel(name string) (*ChannelData, error) {
	lock := s.lockFor(name)
	lock.Lock()
	defer lock.Unlock()
	return s.readChannelFile(s.channelFile(name))
}

// UpsertDomain writes cookie data for a domain within a channel.
// Later writes overwrite earlier ones for the same domain; no merging.
func (s *Store) UpsertDomain(name, domain string, cookies []map[string]interface{}) error {
	lock := s.lockFor(name)
	lock.Lock()
	defer lock.Unlock()

	file := s.channelFile(name)
	data, err := s.readChannelFile(file)
	if err != nil {
		return err
	}
	if data == nil {
		return ErrChannelNotFound
	}
	if data.Domains == nil {
		data.Domains = map[string]DomainEntry{}
	}
	data.Domains[domain] = DomainEntry{
		Cookies:   cookies,
		UpdatedAt: time.Now().Unix(),
	}
	return s.writeChannelFile(file, data)
}
