// Package rpc answers the gateway plugin host's RPC methods for claude-quota and owns the engine's lifecycle.
//
// Each loaded copy of the plugin runs at most one engine. Before an engine runs it takes an exclusive flock
// on claude-quota.lock in the state dir, so when the host keeps an old copy loaded after a hot reload, only
// one engine in the process can read and plan.
package rpc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/engine"
	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/offers"
)

const (
	pluginID   = "claude-quota"
	version    = "0.1.0"
	routeBase  = "/v0/management/plugins/" + pluginID
	healthPath = routeBase + "/health"

	stateWaiting = "waiting for lock"
	stateRunning = "running"
	stateStopped = "stopped"
)

var registration = map[string]any{
	"schema_version": 6,
	"metadata": map[string]any{
		"Name": pluginID, "Version": version, "Author": "belazy", "Logo": "", "ConfigFields": []any{},
		"GitHubRepository": "https://github.com/BeLazy167/CLIProxyAPI",
	},
	"capabilities": map[string]any{"management_api": true, "usage_plugin": true},
}

// Plugin is one loaded copy of claude-quota.
type Plugin struct {
	logf engine.Logf
	copy string

	mu  sync.Mutex
	seq int
	cur atomic.Pointer[runner]
}

// New returns a plugin copy that logs through logf.
func New(logf engine.Logf) *Plugin {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return &Plugin{logf: logf, copy: hex.EncodeToString(b)}
}

type envelope struct {
	OK     bool  `json:"ok"`
	Result any   `json:"result,omitempty"`
	Error  *fail `json:"error,omitempty"`
}

type fail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Handle answers one RPC call with a JSON envelope.
func (p *Plugin) Handle(method string, request []byte) []byte {
	result, err := p.handle(method, request)
	env := envelope{OK: err == nil, Result: result}
	if err != nil {
		env = envelope{Error: &fail{Code: "plugin_error", Message: err.Error()}}
	}
	raw, _ := json.Marshal(env)
	return raw
}

func (p *Plugin) handle(method string, request []byte) (any, error) {
	switch method {
	case "plugin.register", "plugin.reconfigure":
		var req struct {
			ConfigYAML []byte `json:"config_yaml"`
		}
		if err := json.Unmarshal(request, &req); err != nil {
			return nil, fmt.Errorf("decode %s: %w", method, err)
		}
		cfg, err := ParseConfig(req.ConfigYAML)
		if err != nil {
			p.Shutdown()
			return nil, err
		}
		p.apply(cfg)
		return registration, nil
	case "plugin.quiesce", "plugin.shutdown":
		p.Shutdown()
		return struct{}{}, nil
	case "management.register":
		routes := make([]any, 0, len(managementRoutes))
		for _, r := range managementRoutes {
			routes = append(routes, map[string]any{"Method": r.method, "Path": "/plugins/" + pluginID + r.path, "Description": r.description})
		}
		return map[string]any{"routes": routes}, nil
	case "management.handle":
		var req managementRequest
		if err := json.Unmarshal(request, &req); err != nil {
			return nil, fmt.Errorf("decode %s: %w", method, err)
		}
		return p.serve(req), nil
	case "usage.handle":
		var rec struct {
			AuthID, AuthIndex string
			Failure           struct{ StatusCode int }
		}
		if err := json.Unmarshal(request, &rec); err != nil {
			return nil, fmt.Errorf("decode %s: %w", method, err)
		}
		if r := p.cur.Load(); r != nil && rec.Failure.StatusCode == http.StatusTooManyRequests {
			for _, id := range []string{rec.AuthID, rec.AuthIndex} {
				if id != "" {
					r.eng.QuotaHit(id)
				}
			}
		}
		return struct{}{}, nil
	}
	return nil, fmt.Errorf("unknown method %s", method)
}

func reply(status int, body any) map[string]any {
	raw, _ := json.Marshal(body)
	return map[string]any{"StatusCode": status, "Headers": map[string][]string{"Content-Type": {"application/json"}}, "Body": raw}
}

// apply starts the engine for cfg, restarting it only when the config changed.
func (p *Plugin) apply(cfg Config) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if r := p.cur.Load(); r != nil && reflect.DeepEqual(r.cfg, cfg) {
		return
	}
	p.stopLocked()
	p.seq++
	gw := &gateway.Client{Base: cfg.ManagementBase, Key: cfg.ManagementKey, HTTP: &http.Client{Timeout: 10 * time.Second}}
	r := &runner{
		cfg:  cfg,
		id:   fmt.Sprintf("%s/%d", p.copy, p.seq),
		eng:  engine.New(cfg.Engine, gw, engine.NewWriter(gw, p.logf), p.logf),
		done: make(chan struct{}),
	}
	r.state.Store(stateWaiting)
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	p.cur.Store(r)
	go r.run(ctx, p.logf)
}

// Shutdown stops the engine, which releases its Opus/Sonnet reservations, and waits for it to exit.
func (p *Plugin) Shutdown() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stopLocked()
}

func (p *Plugin) stopLocked() {
	r := p.cur.Swap(nil)
	if r == nil {
		return
	}
	r.cancel()
	select {
	case <-r.done:
	case <-time.After(30 * time.Second):
		p.logf("engine %s did not stop within 30s; it keeps the lock until it does", r.id)
	}
}

type runner struct {
	cfg    Config
	id     string
	eng    *engine.Engine
	cancel context.CancelFunc
	done   chan struct{}
	state  atomic.Value
}

func (r *runner) run(ctx context.Context, logf engine.Logf) {
	defer close(r.done)
	defer r.eng.Close()
	defer r.state.Store(stateStopped)
	lock, err := r.waitForLock(ctx, logf)
	if err != nil {
		if ctx.Err() == nil {
			logf("engine %s not started: %v", r.id, err)
		}
		return
	}
	defer func() { _ = lock.Close() }()
	r.state.Store(stateRunning)
	logf("engine %s running (mode %s)", r.id, offers.Mode)
	r.eng.Run(ctx)
	logf("engine %s stopped", r.id)
}

// waitForLock takes the state dir's lock file, retrying while another loaded copy holds it.
func (r *runner) waitForLock(ctx context.Context, logf engine.Logf) (*os.File, error) {
	if err := os.MkdirAll(r.cfg.StateDir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(r.cfg.StateDir, pluginID+".lock")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	for logged := false; ; logged = true {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return f, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			_ = f.Close()
			return nil, fmt.Errorf("lock %s: %w", path, err)
		}
		if !logged {
			logf("engine %s waiting: another loaded copy holds %s", r.id, path)
		}
		select {
		case <-ctx.Done():
			_ = f.Close()
			return nil, ctx.Err()
		case <-time.After(r.cfg.LockRetry):
		}
	}
}

type accountHealth struct {
	LastGoodRead     *time.Time `json:"last_good_read"`
	LimitsAgeSeconds *float64   `json:"limits_age_seconds"`
	InPlan           bool       `json:"in_plan"`
}

func (p *Plugin) health(now time.Time) map[string]any {
	h := map[string]any{"plugin": pluginID, "version": version, "mode": offers.Mode, "copy": p.copy, "state": stateStopped}
	r := p.cur.Load()
	if r == nil {
		return h
	}
	st := r.eng.Status()
	h["state"], h["engine"], h["generation"] = r.state.Load(), r.id, st.Generation
	if !st.LastCycle.IsZero() {
		h["last_cycle"] = st.LastCycle.UTC()
	}
	accounts := map[string]accountHealth{}
	names := make([]string, 0, len(st.LastGoodRead))
	for name := range st.LastGoodRead {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		var a accountHealth
		if t := st.LastGoodRead[name]; !t.IsZero() {
			age := now.Sub(t).Seconds()
			a.LastGoodRead, a.LimitsAgeSeconds = &t, &age
		}
		a.InPlan = slices.Contains(st.Planned, name)
		accounts[name] = a
	}
	h["accounts"] = accounts
	return h
}
