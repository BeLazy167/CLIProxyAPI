package rpc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const mgmtKey = "FAKE-CPA-MANAGEMENT-KEY"

type acctSpec struct {
	weekly, fable float64
	excluded      []string
	cooldowns     []map[string]any
}

type world struct {
	t        *testing.T
	authDir  string
	stateDir string
	keyFile  string
	usage    *httptest.Server
	mgmt     *httptest.Server

	mu        sync.Mutex
	reads     map[string]int
	writes    []string
	logs      []string
	credsFail bool
}

func token(label string) string { return "sk-ant-oat-FAKE-" + label }

func newWorld(t *testing.T, accounts map[string]acctSpec) *world {
	t.Helper()
	w := &world{t: t, authDir: t.TempDir(), stateDir: t.TempDir(), reads: map[string]int{}}
	w.keyFile = filepath.Join(t.TempDir(), "cpa.key")
	if err := os.WriteFile(w.keyFile, []byte(mgmtKey+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bodies := map[string][]byte{}
	var files []map[string]any
	for label, a := range accounts {
		name := "claude-" + label + ".json"
		auth := map[string]any{"type": "claude", "email": label + "@example.com", "access_token": token(label),
			"organization_uuid": "org-" + label, "expired": time.Now().Add(5 * time.Hour).Format(time.RFC3339), "disabled": false}
		if a.excluded != nil {
			auth["excluded_models"] = a.excluded
		}
		raw, _ := json.Marshal(auth)
		if err := os.WriteFile(filepath.Join(w.authDir, name), raw, 0o600); err != nil {
			t.Fatal(err)
		}
		bodies[token(label)], _ = json.Marshal(map[string]any{"five_hour": nil, "limits": []any{
			map[string]any{"kind": "weekly_all", "percent": a.weekly, "resets_at": time.Now().Add(72 * time.Hour).Format(time.RFC3339Nano), "scope": nil},
			map[string]any{"kind": "weekly_scoped", "percent": a.fable, "resets_at": time.Now().Add(72 * time.Hour).Format(time.RFC3339Nano),
				"scope": map[string]any{"model": map[string]any{"display_name": "Fable"}}},
		}})
		cds := a.cooldowns
		if cds == nil {
			cds = []map[string]any{}
		}
		files = append(files, map[string]any{"name": name, "id": name, "auth_index": "idx-" + label, "cooldowns": cds})
	}
	w.usage = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		w.mu.Lock()
		w.reads[tok]++
		w.mu.Unlock()
		if r.URL.Path != "/api/oauth/usage" || r.URL.RawQuery != "cedar_ember=1&skip_spend=1" || r.Header.Get("anthropic-beta") != "oauth-2025-04-20" {
			http.Error(rw, "bad request shape", http.StatusBadRequest)
			return
		}
		_, _ = rw.Write(bodies[tok])
	}))
	t.Cleanup(w.usage.Close)
	credsReply, _ := json.Marshal(map[string]any{"files": files})
	w.mgmt = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+mgmtKey {
			http.Error(rw, "no key", http.StatusUnauthorized)
			return
		}
		w.mu.Lock()
		credsFail := w.credsFail
		if r.Method != http.MethodGet {
			w.writes = append(w.writes, r.Method+" "+r.URL.Path)
		}
		w.mu.Unlock()
		if credsFail {
			http.Error(rw, "gateway starting", http.StatusBadGateway)
			return
		}
		_, _ = rw.Write(credsReply)
	}))
	t.Cleanup(w.mgmt.Close)
	return w
}

func (w *world) config(extra string) string {
	return fmt.Sprintf("enabled: true\npriority: 0\nmode: shadow\ninterval: 1h\nmanagement_base: %s\nmanagement_key_file: %s\n"+
		"state_dir: %s\nauth_dir: %s\nusage_base: %s\nmin_read_gap: 300ms\nstale_after: 1h\nreset_grace: 0s\nlock_retry: 20ms\n%s",
		w.mgmt.URL, w.keyFile, w.stateDir, w.authDir, w.usage.URL, extra)
}

func (w *world) logf(format string, args ...any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.logs = append(w.logs, fmt.Sprintf(format, args...))
}

func (w *world) lines(substr string) []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []string
	for _, l := range w.logs {
		if strings.Contains(l, substr) {
			out = append(out, l)
		}
	}
	return out
}

func (w *world) readCount(label string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.reads[token(label)]
}

func (w *world) editAuth(label string, edit func(map[string]any)) {
	w.t.Helper()
	path := filepath.Join(w.authDir, "claude-"+label+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		w.t.Fatal(err)
	}
	auth := map[string]any{}
	if err := json.Unmarshal(raw, &auth); err != nil {
		w.t.Fatal(err)
	}
	edit(auth)
	if raw, err = json.Marshal(auth); err != nil {
		w.t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		w.t.Fatal(err)
	}
}

func (w *world) waitFor(what string, cond func() bool) {
	w.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			w.mu.Lock()
			defer w.mu.Unlock()
			w.t.Fatalf("timed out waiting for %s; log:\n%s", what, strings.Join(w.logs, "\n"))
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func call(t *testing.T, p *Plugin, method string, payload any) (json.RawMessage, string) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var env struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(p.Handle(method, raw), &env); err != nil {
		t.Fatal(err)
	}
	if !env.OK {
		return nil, env.Error.Message
	}
	return env.Result, ""
}

func register(t *testing.T, p *Plugin, cfg string) string {
	t.Helper()
	_, errMsg := call(t, p, "plugin.register", map[string]any{"config_yaml": []byte(cfg), "schema_version": 10})
	return errMsg
}

type health struct {
	Plugin     string    `json:"plugin"`
	Mode       string    `json:"mode"`
	State      string    `json:"state"`
	LastCycle  time.Time `json:"last_cycle"`
	Generation uint64    `json:"generation"`
	Accounts   map[string]struct {
		LimitsAgeSeconds *float64 `json:"limits_age_seconds"`
		InPlan           bool     `json:"in_plan"`
	} `json:"accounts"`
}

func getHealth(t *testing.T, p *Plugin, path string) (int, health, string) {
	t.Helper()
	res, errMsg := call(t, p, "management.handle", map[string]any{"Method": "GET", "Path": path})
	if errMsg != "" {
		t.Fatal(errMsg)
	}
	var resp struct {
		StatusCode int
		Body       []byte
	}
	if err := json.Unmarshal(res, &resp); err != nil {
		t.Fatal(err)
	}
	var h health
	_ = json.Unmarshal(resp.Body, &h)
	return resp.StatusCode, h, string(resp.Body)
}

var nov11 = map[string]acctSpec{
	"weeklyout": {weekly: 100, fable: 0},
	"fableout":  {weekly: 64, fable: 100},
	"fableleft": {weekly: 54, fable: 0},
}

func TestShadowCycleHealthAndNoWrites(t *testing.T) {
	accts := map[string]acctSpec{}
	for k, v := range nov11 {
		accts[k] = v
	}
	stale := accts["fableleft"]
	stale.cooldowns = []map[string]any{{"scope": "credential", "reason": "credential_quota", "retry_at": "2099-01-01T00:00:00.123456789Z"}}
	accts["fableleft"] = stale
	w := newWorld(t, accts)
	p := New(w.logf)
	defer p.Shutdown()
	if errMsg := register(t, p, w.config("")); errMsg != "" {
		t.Fatal(errMsg)
	}
	w.waitFor("first plan", func() bool { return len(w.lines("plan 1 ")) == 1 })

	want := []string{
		`shadow: fableout@example.com excluded_models null -> ["claude-fable-*"]`,
		`shadow: weeklyout@example.com excluded_models null -> ["claude-fable-*"]`,
		`shadow: fableleft@example.com excluded_models null -> ["claude-opus-*","claude-sonnet-*"]`,
		`shadow: fableleft@example.com cooldown reset (stale until 2099-01-01T00:00:00Z)`,
	}
	if got := w.lines("shadow: "); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("15: shadow lines\n got %q\nwant %q", got, want)
	}
	for label := range nov11 {
		if n := w.readCount(label); n != 1 {
			t.Fatalf("one usage read per account in a cycle: %s read %d times", label, n)
		}
	}
	if len(w.writes) != 0 {
		t.Fatalf("15: shadow sent writes to the management API: %v", w.writes)
	}

	code, h, raw := getHealth(t, p, healthPath)
	if code != 200 || h.Plugin != "claude-quota" || h.Mode != "shadow" || h.State != "running" || h.Generation != 1 ||
		h.LastCycle.IsZero() || len(h.Accounts) != 3 {
		t.Fatalf("14: health reply %d %s", code, raw)
	}
	for name, a := range h.Accounts {
		if a.LimitsAgeSeconds == nil || *a.LimitsAgeSeconds < 0 || *a.LimitsAgeSeconds > 5 || !a.InPlan {
			t.Fatalf("14: account %s health %s", name, raw)
		}
	}
	if code, _, _ := getHealth(t, p, "/v0/management/plugins/claude-quota/other"); code != http.StatusNotFound {
		t.Fatalf("14: other path answered %d", code)
	}
	w.mu.Lock()
	all := strings.Join(w.logs, "\n") + raw
	w.mu.Unlock()
	if strings.Contains(all, mgmtKey) || strings.Contains(all, "sk-ant-oat") {
		t.Fatal("16: a secret reached the log or the health reply")
	}
}

func TestSecondCopyWaitsForLockAndRollback(t *testing.T) {
	w := newWorld(t, nov11)
	cfg := w.config("")
	first, second := New(w.logf), New(w.logf)
	defer first.Shutdown()
	defer second.Shutdown()
	if errMsg := register(t, first, cfg); errMsg != "" {
		t.Fatal(errMsg)
	}
	w.waitFor("first copy's plan", func() bool { return len(w.lines("plan 1 ")) == 1 })
	if errMsg := register(t, second, cfg); errMsg != "" {
		t.Fatal(errMsg)
	}
	w.waitFor("second copy waiting", func() bool { _, h, _ := getHealth(t, second, healthPath); return h.State == "waiting for lock" })
	time.Sleep(100 * time.Millisecond)
	if n := w.readCount("fableleft"); n != 1 {
		t.Fatalf("1: the waiting copy read usage (%d reads)", n)
	}

	if _, errMsg := call(t, first, "plugin.quiesce", map[string]any{}); errMsg != "" {
		t.Fatal(errMsg)
	}
	if _, h, _ := getHealth(t, first, healthPath); h.State != "stopped" {
		t.Fatalf("3: first copy after quiesce is %q", h.State)
	}
	w.waitFor("2: second copy takes over", func() bool { return w.readCount("fableleft") == 2 })
	_, h, _ := getHealth(t, second, healthPath)
	if h.State != "running" {
		t.Fatalf("2: second copy is %q", h.State)
	}

	if errMsg := register(t, first, cfg); errMsg != "" {
		t.Fatal(errMsg)
	}
	w.waitFor("4: first copy restarted and waiting", func() bool { _, h, _ := getHealth(t, first, healthPath); return h.State == "waiting for lock" })
	call(t, second, "plugin.shutdown", map[string]any{})
	w.waitFor("4: first copy runs again after the second stops", func() bool { return w.readCount("fableleft") == 3 })
	if running := len(w.lines("running (mode shadow)")) - len(w.lines("stopped")); running != 1 {
		t.Fatalf("1: %d engines running", running)
	}
}

func TestReconfigure(t *testing.T) {
	w := newWorld(t, nov11)
	p := New(w.logf)
	defer p.Shutdown()
	cfg := w.config("")
	register(t, p, cfg)
	w.waitFor("plan", func() bool { return len(w.lines("plan 1 ")) == 1 })
	if _, errMsg := call(t, p, "plugin.reconfigure", map[string]any{"config_yaml": []byte(cfg)}); errMsg != "" {
		t.Fatal(errMsg)
	}
	if n := len(w.lines("running (mode shadow)")); n != 1 {
		t.Fatalf("5: same config restarted the engine (%d starts)", n)
	}
	if _, errMsg := call(t, p, "plugin.reconfigure", map[string]any{"config_yaml": []byte(strings.Replace(cfg, "interval: 1h", "interval: 2h", 1))}); errMsg != "" {
		t.Fatal(errMsg)
	}
	w.waitFor("5: changed config restarts the engine", func() bool { return len(w.lines("running (mode shadow)")) == 2 })
	if n := len(w.lines("stopped")); n != 1 {
		t.Fatalf("5: %d stops", n)
	}
}

func TestStopReleasesOnlyReservations(t *testing.T) {
	w := newWorld(t, map[string]acctSpec{
		"a": {weekly: 64, fable: 100, excluded: []string{"claude-fable-*"}},
		"b": {weekly: 54, fable: 0, excluded: []string{"claude-opus-*", "claude-sonnet-*"}},
	})
	p := New(w.logf)
	register(t, p, w.config(""))
	w.waitFor("plan", func() bool { return len(w.lines("plan 1 ")) == 1 })
	if got := w.lines("shadow: "); len(got) != 0 {
		t.Fatalf("plan matches the files, want no writes: %q", got)
	}
	call(t, p, "plugin.quiesce", map[string]any{})
	want := []string{`shadow: b@example.com excluded_models ["claude-opus-*","claude-sonnet-*"] -> null`}
	if got := w.lines("shadow: "); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("6: release on quiesce\n got %q\nwant %q", got, want)
	}
	if len(w.lines("fail-open: engine stopping")) != 1 {
		t.Fatal("6: fail-open line missing")
	}
	p.Shutdown()
	if len(w.lines("running (mode shadow)")) != 1 {
		t.Fatal("6: shutdown after quiesce restarted the engine")
	}
}

func TestConfigRejected(t *testing.T) {
	w := newWorld(t, nov11)
	empty := filepath.Join(t.TempDir(), "empty.key")
	if err := os.WriteFile(empty, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, from, to string
	}{
		{"7 live mode", "mode: shadow", "mode: live"},
		{"8 management base not loopback", "management_base: " + w.mgmt.URL, "management_base: http://10.0.0.5:8317"},
		{"9 short gap against Anthropic", "usage_base: " + w.usage.URL, "usage_base: https://api.anthropic.com"},
		{"9 short gap against Anthropic with a port", "usage_base: " + w.usage.URL, "usage_base: https://api.anthropic.com:443"},
		{"9 short gap against Anthropic in upper case", "usage_base: " + w.usage.URL, "usage_base: https://API.ANTHROPIC.COM"},
		{"9 short gap against a host off loopback", "usage_base: " + w.usage.URL, "usage_base: http://10.0.0.5:9000"},
		{"10 unknown key", "interval: 1h", "intervall: 1h"},
		{"11 missing key file", "management_key_file: " + w.keyFile, "management_key_file: /nonexistent/key"},
		{"11 empty key file", "management_key_file: " + w.keyFile, "management_key_file: " + empty},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := w.config("")
			if !strings.Contains(cfg, c.from) {
				t.Fatalf("test config has no %q", c.from)
			}
			p := New(w.logf)
			defer p.Shutdown()
			if errMsg := register(t, p, strings.Replace(cfg, c.from, c.to, 1)); errMsg == "" {
				t.Fatal("register accepted the config")
			}
			if _, h, _ := getHealth(t, p, healthPath); h.State != "stopped" {
				t.Fatalf("engine state %q", h.State)
			}
		})
	}
	time.Sleep(50 * time.Millisecond)
	if n := w.readCount("fableleft"); n != 0 {
		t.Fatalf("a rejected config read usage %d times", n)
	}
}

func TestQuota429TriggersOneRead(t *testing.T) {
	w := newWorld(t, nov11)
	p := New(w.logf)
	defer p.Shutdown()
	register(t, p, w.config(""))
	w.waitFor("plan", func() bool { return len(w.lines("plan 1 ")) == 1 })
	hit := func(authIndex string, status int) {
		call(t, p, "usage.handle", map[string]any{"Provider": "claude", "AuthID": "", "AuthIndex": authIndex, "Failed": true,
			"Failure": map[string]any{"StatusCode": status, "Body": ""}})
	}
	for range 5 {
		hit("idx-fableleft", http.StatusTooManyRequests)
	}
	hit("idx-unknown", http.StatusTooManyRequests)
	hit("idx-fableout", http.StatusInternalServerError)
	w.waitFor("12: read after a 429", func() bool { return w.readCount("fableleft") == 2 })
	w.waitFor("12: re-plan after a 429", func() bool { return len(w.lines("(window reset or quota 429)")) == 1 })
	time.Sleep(700 * time.Millisecond)
	if n := w.readCount("fableleft"); n != 2 {
		t.Fatalf("12: five 429s gave %d extra reads", n-1)
	}
	if a, b := w.readCount("fableout"), w.readCount("weeklyout"); a != 1 || b != 1 {
		t.Fatalf("13: other accounts read again (%d, %d)", a, b)
	}
}

func TestQuota429ByAuthIDWithoutCredentials(t *testing.T) {
	w := newWorld(t, nov11)
	w.credsFail = true
	p := New(w.logf)
	defer p.Shutdown()
	register(t, p, w.config(""))
	w.waitFor("plan", func() bool { return len(w.lines("plan 1 ")) == 1 })
	if len(w.lines("cooldown check skipped")) != 1 {
		t.Fatal("the credentials read should have failed")
	}
	call(t, p, "usage.handle", map[string]any{"AuthID": "claude-fableout.json", "AuthIndex": "idx-fableout",
		"Failure": map[string]any{"StatusCode": http.StatusTooManyRequests}})
	w.waitFor("12: a 429 maps by auth ID (the auth file name) before any credentials read", func() bool { return w.readCount("fableout") == 2 })
}

func plans(w *world) int { return len(w.lines(" accounts planned")) }

func TestQuota429ForSkippedAccountPlansOnce(t *testing.T) {
	edits := map[string]func(*world){
		"unreadable": func(w *world) {
			if err := os.WriteFile(filepath.Join(w.authDir, "claude-fableout.json"), []byte("not json"), 0o600); err != nil {
				t.Fatal(err)
			}
		},
		"disabled": func(w *world) { w.editAuth("fableout", func(a map[string]any) { a["disabled"] = true }) },
		"token expired": func(w *world) {
			w.editAuth("fableout", func(a map[string]any) { a["expired"] = time.Now().Add(-time.Hour).Format(time.RFC3339) })
		},
	}
	for name, edit := range edits {
		t.Run(name, func(t *testing.T) {
			w := newWorld(t, nov11)
			p := New(w.logf)
			defer p.Shutdown()
			register(t, p, w.config(""))
			w.waitFor("plan", func() bool { return plans(w) == 1 })
			edit(w)
			call(t, p, "usage.handle", map[string]any{"AuthID": "claude-fableout.json", "Failure": map[string]any{"StatusCode": http.StatusTooManyRequests}})
			w.waitFor("12: re-plan after a 429", func() bool { return plans(w) >= 2 })
			time.Sleep(700 * time.Millisecond)
			if n := plans(w); n != 2 {
				t.Fatalf("12: one 429 for an account the engine skips gave %d re-plans, want 1", n-1)
			}
		})
	}
}

func TestExpiredFallbackDoesNotHoldReservation(t *testing.T) {
	w := newWorld(t, map[string]acctSpec{
		"fableout":  {weekly: 64, fable: 100, excluded: []string{"claude-fable-*"}},
		"fableleft": {weekly: 54, fable: 0, excluded: []string{"claude-opus-*", "claude-sonnet-*"}},
	})
	p := New(w.logf)
	defer p.Shutdown()
	register(t, p, w.config(""))
	w.waitFor("plan", func() bool { return plans(w) == 1 })
	if got := w.lines("shadow: "); len(got) != 0 {
		t.Fatalf("plan matches the files, want no writes: %q", got)
	}
	w.editAuth("fableout", func(a map[string]any) { a["expired"] = time.Now().Add(-time.Hour).Format(time.RFC3339) })
	call(t, p, "usage.handle", map[string]any{"AuthID": "claude-fableleft.json", "Failure": map[string]any{"StatusCode": http.StatusTooManyRequests}})
	w.waitFor("re-plan after a 429", func() bool { return plans(w) == 2 })
	want := []string{`shadow: fableleft@example.com excluded_models ["claude-opus-*","claude-sonnet-*"] -> null`}
	if got := w.lines("shadow: "); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("17: an account with an expired token still counts as the Fable-out fallback\n got %q\nwant %q", got, want)
	}
}

func TestRestartKeepsReadGap(t *testing.T) {
	w := newWorld(t, nov11)
	cfg := strings.Replace(w.config(""), "min_read_gap: 300ms", "min_read_gap: 1500ms", 1)
	first, second := New(w.logf), New(w.logf)
	defer first.Shutdown()
	defer second.Shutdown()
	register(t, first, cfg)
	w.waitFor("plan", func() bool { return plans(w) == 1 })
	if _, errMsg := call(t, first, "plugin.reconfigure", map[string]any{"config_yaml": []byte(strings.Replace(cfg, "interval: 1h", "interval: 2h", 1))}); errMsg != "" {
		t.Fatal(errMsg)
	}
	w.waitFor("plan after reconfigure", func() bool { return plans(w) == 2 })
	register(t, second, cfg)
	call(t, first, "plugin.shutdown", map[string]any{})
	w.waitFor("plan after the lock handoff", func() bool { return plans(w) == 3 })
	for label := range nov11 {
		if n := w.readCount(label); n != 1 {
			t.Fatalf("18: %s read %d times across a reconfigure and a lock handoff inside min_read_gap", label, n)
		}
	}
	w.waitFor("18: each account read again once the gap passes", func() bool {
		return w.readCount("weeklyout") == 2 && w.readCount("fableout") == 2 && w.readCount("fableleft") == 2
	})
	time.Sleep(500 * time.Millisecond)
	for label := range nov11 {
		if n := w.readCount(label); n != 2 {
			t.Fatalf("18: %s read %d times, want 2", label, n)
		}
	}
}

func TestFutureReadTimesAreClampedOnLoad(t *testing.T) {
	w := newWorld(t, nov11)
	ahead := time.Now().Add(time.Hour).UTC()
	saved := map[string]time.Time{}
	for label := range nov11 {
		saved["claude-"+label+".json"] = ahead
	}
	raw, _ := json.Marshal(saved)
	if err := os.WriteFile(filepath.Join(w.stateDir, pluginID+".last-try.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	p := New(w.logf)
	defer p.Shutdown()
	register(t, p, w.config(""))
	w.waitFor("19: a read time saved an hour ahead (clock moved back) delays a read by at most one gap", func() bool {
		return w.readCount("weeklyout") == 1 && w.readCount("fableout") == 1 && w.readCount("fableleft") == 1
	})
}

func TestNoUsageReadWhenTheReadGapCannotBeSaved(t *testing.T) {
	w := newWorld(t, nov11)
	if err := os.Mkdir(filepath.Join(w.stateDir, pluginID+".last-try.json"), 0o700); err != nil {
		t.Fatal(err)
	}
	p := New(w.logf)
	defer p.Shutdown()
	register(t, p, w.config(""))
	w.waitFor("20: the failed save is logged", func() bool { return len(w.lines("read gap state not saved")) >= 1 })
	time.Sleep(time.Second)
	for label := range nov11 {
		if n := w.readCount(label); n != 0 {
			t.Fatalf("20: %s read %d times while its read time could not be saved", label, n)
		}
	}
}
