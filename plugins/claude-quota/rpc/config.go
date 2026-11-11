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
	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/offers"
)

const (
	anthropicBase = "https://api.anthropic.com"
	minRemoteGap  = 5 * time.Minute
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

	PublicBase           string   `yaml:"public_base"`
	BarkBases            []string `yaml:"bark_bases"`
	BarkKeyFile          string   `yaml:"bark_key_file"`
	ResendBase           string   `yaml:"resend_base"`
	ResendKeyFile        string   `yaml:"resend_key_file"`
	EmailFrom            string   `yaml:"email_from"`
	EmailTo              string   `yaml:"email_to"`
	ThresholdPct         float64  `yaml:"threshold_pct"`
	MinResetHours        int      `yaml:"min_reset_hours"`
	ExpiryAlertHours     []int    `yaml:"expiry_alert_hours"`
	StaleTokenAlertHours int      `yaml:"stale_token_alert_hours"`
}

func defaults() rawConfig {
	return rawConfig{
		Mode:              offers.Mode,
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

		PublicBase:           "https://gw.blzy.app/reset",
		BarkBases:            offers.DefaultBarkBases,
		BarkKeyFile:          "~/.config/bark/key",
		ResendBase:           offers.DefaultResendBase,
		ResendKeyFile:        "~/.config/claude-reset/resend.key",
		EmailFrom:            "claude-reset@blzy.app",
		EmailTo:              "dhruvkhara167@gmail.com",
		ThresholdPct:         90,
		MinResetHours:        24,
		ExpiryAlertHours:     []int{168, 24},
		StaleTokenAlertHours: 2,
	}
}

// ParseConfig reads the plugin's YAML block and the management key file. It rejects unknown keys,
// a mode this build does not support, a management base off loopback, and a short read gap
// against a usage host off loopback.
func ParseConfig(raw []byte) (Config, error) {
	rc := defaults()
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	if err := dec.Decode(&rc); err != nil && !errors.Is(err, io.EOF) {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	if rc.Mode != offers.Mode {
		return Config{}, fmt.Errorf("config: mode %q is not supported by this build, which supports only %q", rc.Mode, offers.Mode)
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
	if cfg.Engine.MinReadGap < minRemoteGap && !onLoopback(cfg.Engine.UsageBase) {
		return Config{}, fmt.Errorf("config: min_read_gap below %s is allowed only against a usage server on loopback", minRemoteGap)
	}
	cfg.Engine.UserAgent = rc.UserAgent
	var err error
	if cfg.Engine.AuthDir, err = expand(rc.AuthDir); err != nil {
		return Config{}, err
	}
	if cfg.StateDir, err = expand(rc.StateDir); err != nil {
		return Config{}, err
	}
	cfg.Engine.LastTryFile = filepath.Join(cfg.StateDir, pluginID+".last-try.json")
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
	if err := offersConfig(rc, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// offersConfig fills the offers and sender settings. A build that can send needs its Bark and Resend key
// files now, so a missing key stops the plugin at load instead of at the first alert.
func offersConfig(rc rawConfig, cfg *Config) error {
	u, err := url.Parse(rc.PublicBase)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("config: public_base %q must be an absolute http(s) URL", rc.PublicBase)
	}
	if rc.ThresholdPct <= 0 || rc.MinResetHours < 0 || rc.StaleTokenAlertHours < 0 || len(rc.ExpiryAlertHours) == 0 {
		return fmt.Errorf("config: threshold_pct, min_reset_hours, expiry_alert_hours and stale_token_alert_hours must be set and not negative")
	}
	e := &cfg.Engine
	e.StateFile = filepath.Join(cfg.StateDir, "state.json")
	e.Offers = offers.Config{AuthDir: e.AuthDir, PublicBase: strings.TrimRight(rc.PublicBase, "/"), Origin: u.Scheme + "://" + u.Host,
		Rules:                offers.Rules{ThresholdPct: rc.ThresholdPct, MinResetHours: rc.MinResetHours, ExpiryAlertHours: rc.ExpiryAlertHours},
		StaleTokenAlertHours: rc.StaleTokenAlertHours}
	e.Send = offers.SendConfig{APIBase: e.UsageBase, UserAgent: e.UserAgent, BarkBases: rc.BarkBases,
		ResendBase: strings.TrimRight(rc.ResendBase, "/"), EmailFrom: rc.EmailFrom, EmailTo: rc.EmailTo}
	for _, k := range []struct {
		name string
		raw  string
		dst  *string
	}{{"bark_key_file", rc.BarkKeyFile, &e.Send.BarkKeyFile}, {"resend_key_file", rc.ResendKeyFile, &e.Send.ResendKeyFile}} {
		if *k.dst, err = expand(k.raw); err != nil {
			return err
		}
		if offers.Mode == "shadow" {
			continue
		}
		if raw, err := os.ReadFile(*k.dst); err != nil || strings.TrimSpace(string(raw)) == "" {
			return fmt.Errorf("config: %s %s cannot be read or is empty", k.name, *k.dst)
		}
	}
	return nil
}

func loopback(base string) error {
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" {
		return fmt.Errorf("config: management_base %q must be an http URL on loopback", base)
	}
	if !onLoopback(base) {
		return fmt.Errorf("config: management_base %q must be on loopback, since it receives the management key", base)
	}
	return nil
}

func onLoopback(base string) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	return host == "localhost" || (ip != nil && ip.IsLoopback())
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
