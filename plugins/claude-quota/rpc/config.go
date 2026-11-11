package rpc

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/engine"
)

const (
	anthropicBase   = "https://api.anthropic.com"
	minAnthropicGap = 5 * time.Minute
)

// Config is the validated plugins.configs.claude-quota block.
type Config struct {
	ManagementBase string
	ManagementKey  string
	StateDir       string
	LockRetry      time.Duration
	Engine         engine.Config
}

type rawConfig struct {
	Enabled           bool      `yaml:"enabled"`
	Priority          int       `yaml:"priority"`
	Store             yaml.Node `yaml:"store"`
	Mode              string    `yaml:"mode"`
	Interval          string    `yaml:"interval"`
	ManagementBase    string    `yaml:"management_base"`
	ManagementKeyFile string    `yaml:"management_key_file"`
	StateDir          string    `yaml:"state_dir"`
	AuthDir           string    `yaml:"auth_dir"`
	UsageBase         string    `yaml:"usage_base"`
	UserAgent         string    `yaml:"user_agent"`
	StaleAfter        string    `yaml:"stale_after"`
	MinReadGap        string    `yaml:"min_read_gap"`
	ResetGrace        string    `yaml:"reset_grace"`
	LockRetry         string    `yaml:"lock_retry"`
}

func defaults() rawConfig {
	return rawConfig{
		Mode:              engine.Mode,
		Interval:          "15m",
		ManagementBase:    "http://127.0.0.1:8317",
		ManagementKeyFile: "~/.config/claude-reset/cpa-mgmt.key",
		StateDir:          "~/.local/state/claude-reset",
		AuthDir:           "~/.cli-proxy-api",
		UsageBase:         anthropicBase,
		UserAgent:         "claude-cli/2.1.321 (external, cli)",
		StaleAfter:        "45m",
		MinReadGap:        "5m",
		ResetGrace:        "1m",
		LockRetry:         "10s",
	}
}

// ParseConfig reads the plugin's YAML block and the management key file. It rejects unknown keys,
// a mode this build does not support, a management base off loopback, and a short read gap
// against the real Anthropic host.
func ParseConfig(raw []byte) (Config, error) {
	rc := defaults()
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	if err := dec.Decode(&rc); err != nil && !errors.Is(err, io.EOF) {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	if rc.Mode != engine.Mode {
		return Config{}, fmt.Errorf("config: mode %q is not supported by this build, which supports only %q", rc.Mode, engine.Mode)
	}
	if err := loopback(rc.ManagementBase); err != nil {
		return Config{}, err
	}
	cfg := Config{ManagementBase: strings.TrimRight(rc.ManagementBase, "/")}
	durations := map[string]struct {
		raw string
		dst *time.Duration
		min time.Duration
	}{
		"interval":     {rc.Interval, &cfg.Engine.Interval, time.Millisecond},
		"stale_after":  {rc.StaleAfter, &cfg.Engine.StaleAfter, time.Millisecond},
		"min_read_gap": {rc.MinReadGap, &cfg.Engine.MinReadGap, time.Millisecond},
		"reset_grace":  {rc.ResetGrace, &cfg.Engine.ResetGrace, 0},
		"lock_retry":   {rc.LockRetry, &cfg.LockRetry, time.Millisecond},
	}
	for key, d := range durations {
		v, err := time.ParseDuration(d.raw)
		if err != nil || v < d.min {
			return Config{}, fmt.Errorf("config: %s %q is not a duration of at least %s", key, d.raw, d.min)
		}
		*d.dst = v
	}
	cfg.Engine.UsageBase = strings.TrimRight(rc.UsageBase, "/")
	if cfg.Engine.UsageBase == anthropicBase && cfg.Engine.MinReadGap < minAnthropicGap {
		return Config{}, fmt.Errorf("config: min_read_gap below %s is allowed only against a test usage server", minAnthropicGap)
	}
	cfg.Engine.UserAgent = rc.UserAgent
	var err error
	if cfg.Engine.AuthDir, err = expand(rc.AuthDir); err != nil {
		return Config{}, err
	}
	if cfg.StateDir, err = expand(rc.StateDir); err != nil {
		return Config{}, err
	}
	keyFile, err := expand(rc.ManagementKeyFile)
	if err != nil {
		return Config{}, err
	}
	key, err := os.ReadFile(keyFile)
	if err != nil {
		return Config{}, fmt.Errorf("config: management key file %s cannot be read", keyFile)
	}
	if cfg.ManagementKey = strings.TrimSpace(string(key)); cfg.ManagementKey == "" {
		return Config{}, fmt.Errorf("config: management key file %s is empty", keyFile)
	}
	return cfg, nil
}

func loopback(base string) error {
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" {
		return fmt.Errorf("config: management_base %q must be an http URL on loopback", base)
	}
	host := u.Hostname()
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("config: management_base %q must be on loopback, since it receives the management key", base)
	}
	return nil
}

func expand(path string) (string, error) {
	if path != "~" && !strings.HasPrefix(path, "~/") {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("config: %s: %w", path, err)
	}
	return filepath.Join(home, strings.TrimPrefix(path, "~")), nil
}
