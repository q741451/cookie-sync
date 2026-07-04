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

// DomainEntry 是某个频道下、某个域名对应的 cookie 数据
type DomainEntry struct {
	Cookies   []map[string]interface{} `json:"cookies"`
	UpdatedAt int64                     `json:"updated_at"`
}

// ChannelData 是一个频道文件的完整内容
type ChannelData struct {
	ChannelName string                 `json:"channel_name"`
	KeyHash     string                 `json:"key_hash"`
	CreatedAt   int64                  `json:"created_at"`
	Domains     map[string]DomainEntry `json:"domains"`
}

var (
	ErrChannelExists   = errors.New("channel already exists")
	ErrChannelNotFound = errors.New("channel not found")
)

// Store 负责频道数据的读写。
//
// 注意：这里的并发安全依赖"同一份数据目录只被一个 Store 实例（也就是一个
// 运行中的进程）访问"这个前提，用的是进程内互斥锁，而不是跨进程文件锁。
// 正常使用场景下你只会启动一个 cookie-sync-go 进程，这个前提天然成立；
// 千万不要用同一个 data 目录同时跑两个实例（比如手滑开了两个），
// 否则并发写入依然可能冲突。
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
	// 显式修正权限，不依赖系统 umask
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

// channelFile 用频道名的 SHA256 哈希作为文件名，而不是原始频道名：
// 1. 防止路径穿越（比如频道名里塞 ../../ 之类的字符）
// 2. 防止别人靠遍历 data 目录的文件名反推出频道名
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

// writeChannelFile 用"写临时文件 + 原子 rename"的方式落盘，
// 避免进程崩溃或掉电导致文件写到一半而损坏。
func (s *Store) writeChannelFile(file string, data *ChannelData) error {
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	// 显式修正权限，不依赖 umask：这个文件存着 bcrypt 密钥哈希和所有 cookie 数据
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

// CreateChannel 创建新频道。用互斥锁 + 创建前二次检查存在性来避免竞态：
// 同一进程内对同一频道名的并发创建请求会被锁串行化，不会出现互相覆盖。
func (s *Store) CreateChannel(name, key string, bcryptCost int) (*ChannelData, error) {
	lock := s.lockFor(name)
	lock.Lock()
	defer lock.Unlock()

	file := s.channelFile(name)
	if _, err := os.Stat(file); err == nil {
		return nil, ErrChannelExists
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(key), bcryptCost)
	if err != nil {
		return nil, err
	}

	data := &ChannelData{
		ChannelName: name,
		KeyHash:     string(hash),
		CreatedAt:   time.Now().Unix(),
		Domains:     map[string]DomainEntry{},
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

// UpsertDomain 覆盖式写入某个域名下的 cookie 数据（同频道内后写覆盖前写，不做合并）
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
