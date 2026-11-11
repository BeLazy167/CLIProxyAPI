//go:build e2e

// Package e2e runs claude-quota inside a real CLIProxyAPI process built from this tree.
//
// Run from plugins/claude-quota: go test -tags e2e -count=1 -v -timeout 30m ./test/
// It writes its report to $E2E_REPORT (default: test/e2e-report.txt).
package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

const (
	mgmtKey   = "FAKE-CPA-MANAGEMENT-KEY-e2e"
	tokenBase = "sk-ant-oat-FAKE-E2E-"
)

var labels = []string{"weekly-out", "fable-out", "fable-left"}

type check struct {
	name   string
	ok     bool
	detail string
}

type run struct {
	t       *testing.T
	tmp     string
	repo    string
	plugins string
	cfgPath string
	logPath string
	port    int
	gw      *exec.Cmd

	usage *httptest.Server
	proxy *httptest.Server

	mu       sync.Mutex
	reads    map[string][]time.Time
	override map[string]func(time.Time) []byte
	mgmt     []string
	checks   []check
}

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func (r *run) add(name string, ok bool, detail string) {
	r.mu.Lock()
	r.checks = append(r.checks, check{name, ok, detail})
	r.mu.Unlock()
	if !ok {
		r.t.Errorf("FAIL %s: %s", name, detail)
	}
}

func (r *run) sh(dir string, env []string, name string, args ...string) string {
	r.t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		r.t.Fatalf("%s %v: %v\n%s", name, args, err, out)
	}
	return string(out)
}

func fixture(t *testing.T, label string) map[string]any {
	raw, err := os.ReadFile(filepath.Join("fixtures", "nov11-"+label+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func (r *run) startUsage() {
	bodies := map[string][]byte{}
	for _, l := range labels {
		bodies[tokenBase+l], _ = json.Marshal(fixture(r.t, l))
	}
	r.usage = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		tok := strings.TrimPrefix(req.Header.Get("Authorization"), "Bearer ")
		now := time.Now()
		r.mu.Lock()
		r.reads[tok] = append(r.reads[tok], now)
		body, override := bodies[tok], r.override[tok]
		r.mu.Unlock()
		if req.URL.Path != "/api/oauth/usage" || req.URL.RawQuery != "cedar_ember=1&skip_spend=1" ||
			req.Header.Get("anthropic-beta") != "oauth-2025-04-20" || body == nil {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if override != nil {
			body = override(now)
		}
		_, _ = w.Write(body)
	}))
}

func (r *run) startProxy() {
	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", r.port))
	rp := httputil.NewSingleHostReverseProxy(target)
	r.proxy = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.mu.Lock()
		r.mgmt = append(r.mgmt, req.Method+" "+req.URL.Path)
		r.mu.Unlock()
		rp.ServeHTTP(w, req)
	}))
}

func (r *run) writeAuth(label string, excluded []string) {
	a := map[string]any{"type": "claude", "email": label + "@example.com", "access_token": tokenBase + label,
		"refresh_token": "FAKE-REFRESH-" + label, "organization_uuid": "org-" + label,
		"expired": time.Now().Add(120 * time.Hour).UTC().Format(time.RFC3339), "disabled": false}
	if excluded != nil {
		a["excluded_models"] = excluded
	}
	raw, _ := json.Marshal(a)
	if err := os.WriteFile(filepath.Join(r.tmp, "auth", "claude-"+label+".json"), raw, 0o600); err != nil {
		r.t.Fatal(err)
	}
}

func (r *run) authExcluded(label string) any {
	raw, err := os.ReadFile(filepath.Join(r.tmp, "auth", "claude-"+label+".json"))
	if err != nil {
		return err.Error()
	}
	var a map[string]any
	_ = json.Unmarshal(raw, &a)
	return a["excluded_models"]
}

func (r *run) writeConfig(apiKeys []string) {
	keys, _ := json.Marshal(apiKeys)
	cfg := fmt.Sprintf(`config-version: 8
server:
  host: "127.0.0.1"
  port: %d
management:
  allow-remote: false
  secret-key: %q
  disable-control-panel: true
access:
  api-keys: %s
oauth:
  auth-dir: %q
observability:
  logs:
    debug: false
    logging-to-file: false
plugins:
  enabled: true
  dir: %q
  configs:
    claude-quota:
      enabled: true
      mode: shadow
      interval: 3s
      management_base: %q
      management_key_file: %q
      state_dir: %q
      auth_dir: %q
      usage_base: %q
      min_read_gap: 1s
      stale_after: 8s
      reset_grace: 0s
      lock_retry: 200ms
`, r.port, mgmtKey, keys, filepath.Join(r.tmp, "auth"), r.plugins, r.proxy.URL, filepath.Join(r.tmp, "cpa.key"),
		filepath.Join(r.tmp, "state"), filepath.Join(r.tmp, "auth"), r.usage.URL)
	if err := os.WriteFile(r.cfgPath, []byte(cfg), 0o600); err != nil {
		r.t.Fatal(err)
	}
}

var unescape = strings.NewReplacer(`\"`, `"`)

// pluginLines returns the plugin's log lines in the gateway log, after the "claude-quota: " prefix.
func (r *run) pluginLines() []string {
	raw, _ := os.ReadFile(r.logPath)
	var out []string
	for _, line := range strings.Split(string(raw), "\n") {
		if i := strings.Index(line, "claude-quota: "); i >= 0 {
			msg := unescape.Replace(line[i+len("claude-quota: "):])
			out = append(out, strings.TrimRight(msg, `"`))
		}
	}
	return out
}

func (r *run) count(substr string) int {
	n := 0
	for _, l := range r.pluginLines() {
		if strings.Contains(l, substr) {
			n++
		}
	}
	return n
}

func (r *run) waitFor(what string, timeout time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			r.add("wait: "+what, false, "timed out")
			return false
		}
		time.Sleep(50 * time.Millisecond)
	}
	return true
}

func (r *run) readCount(label string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.reads[tokenBase+label])
}

func (r *run) health() (int, map[string]any) {
	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/v0/management/plugins/claude-quota/health", r.port), nil)
	req.Header.Set("Authorization", "Bearer "+mgmtKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil
	}
	defer resp.Body.Close()
	var h map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&h)
	return resp.StatusCode, h
}

var engineLine = regexp.MustCompile(`^engine (\S+) (running|stopped)`)

// runningEngines lists the engines whose last lifecycle line says running.
func (r *run) runningEngines() []string {
	last := map[string]string{}
	var order []string
	for _, l := range r.pluginLines() {
		if m := engineLine.FindStringSubmatch(l); m != nil {
			if _, seen := last[m[1]]; !seen {
				order = append(order, m[1])
			}
			last[m[1]] = m[2]
		}
	}
	var out []string
	for _, id := range order {
		if last[id] == "running" {
			out = append(out, id)
		}
	}
	return out
}

func (r *run) nonGetMgmt() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, m := range r.mgmt {
		if !strings.HasPrefix(m, "GET ") {
			out = append(out, m)
		}
	}
	return out
}

func (r *run) buildPlugin(out, buildID string) {
	r.sh(".", []string{"CGO_ENABLED=1"}, "go", "build", "-buildmode=c-shared", "-trimpath", "-ldflags=-buildid="+buildID, "-o", out, "..")
	_ = os.Remove(strings.TrimSuffix(out, ".so") + ".h")
}

func TestGatewayE2E(t *testing.T) {
	r := &run{t: t, reads: map[string][]time.Time{}, override: map[string]func(time.Time) []byte{}}
	r.tmp = t.TempDir()
	r.repo, _ = filepath.Abs("../../..")
	r.plugins = filepath.Join(r.tmp, "plugins")
	r.cfgPath = filepath.Join(r.tmp, "config.yaml")
	r.logPath = filepath.Join(r.tmp, "gateway.log")
	r.port = freePort(t)
	for _, d := range []string{"auth", "state", "plugins", "tmp"} {
		if err := os.MkdirAll(filepath.Join(r.tmp, d), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	defer r.writeReport()

	t.Log("building the gateway and the plugin")
	gwBin := filepath.Join(r.tmp, "cli-proxy-api")
	r.sh(r.repo, nil, "go", "build", "-o", gwBin, "./cmd/server")
	built := strings.TrimSpace(r.sh("..", nil, "./build.sh", filepath.Join(r.plugins, "claude-quota.so")))
	r.add("build.sh builds the shadow plugin and finds no write path in it", strings.HasSuffix(built, "claude-quota.so"), built)

	r.startUsage()
	defer func() {
		if r.usage != nil {
			r.usage.Close()
		}
	}()
	r.startProxy()
	defer r.proxy.Close()
	if err := os.WriteFile(filepath.Join(r.tmp, "cpa.key"), []byte(mgmtKey+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, l := range labels {
		r.writeAuth(l, nil)
	}
	r.writeConfig([]string{"e2e-client-key"})

	logFile, err := os.Create(r.logPath)
	if err != nil {
		t.Fatal(err)
	}
	defer logFile.Close()
	r.gw = exec.Command(gwBin, "--config", r.cfgPath, "--local-model")
	r.gw.Dir = r.tmp
	r.gw.Env = append(os.Environ(), "TMPDIR="+filepath.Join(r.tmp, "tmp"))
	r.gw.Stdout, r.gw.Stderr = logFile, logFile
	if err := r.gw.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = r.gw.Process.Signal(syscall.SIGTERM)
		done := make(chan struct{})
		go func() { _ = r.gw.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			_ = r.gw.Process.Kill()
			<-done
		}
		r.add("gateway process exited at the end", r.gw.ProcessState != nil, fmt.Sprint(r.gw.ProcessState))
		r.add("on gateway shutdown the host stops the engine, which runs its fail-open step",
			len(r.runningEngines()) == 0 && r.count("fail-open: engine stopping") == 2,
			fmt.Sprintf("running=%v fail-open lines=%d", r.runningEngines(), r.count("fail-open: engine stopping")))
	}()

	// Registration and the first plan.
	if !r.waitFor("plugin health route answers with a plan", 90*time.Second, func() bool {
		code, h := r.health()
		return code == 200 && h["state"] == "running" && h["generation"] != nil && h["generation"].(float64) >= 1
	}) {
		raw, _ := os.ReadFile(r.logPath)
		t.Fatalf("gateway log tail:\n%s", tail(string(raw), 4000))
	}
	raw, _ := os.ReadFile(r.logPath)
	r.add("the host loaded and registered claude-quota",
		strings.Contains(string(raw), "plugin registered") && strings.Contains(string(raw), "claude-quota"), "")
	code, h := r.health()
	hj, _ := json.Marshal(h)
	r.add("health route: mode shadow, state, last cycle, generation and per-account limit age", code == 200 &&
		h["mode"] == "shadow" && h["last_cycle"] != nil && len(h["accounts"].(map[string]any)) == 3, string(hj))

	want := []string{
		`shadow: fable-out@example.com excluded_models null -> ["claude-fable-*"]`,
		`shadow: weekly-out@example.com excluded_models null -> ["claude-fable-*"]`,
		`shadow: fable-left@example.com excluded_models null -> ["claude-opus-*","claude-sonnet-*"]`,
	}
	r.waitFor("three shadow decisions", 10*time.Second, func() bool { return r.count("shadow: ") >= 3 })
	var got []string
	for _, l := range r.pluginLines() {
		if strings.HasPrefix(l, "shadow: ") {
			got = append(got, l)
		}
	}
	r.add("the shadow log shows the three decisions the Python dry-run printed on 2026-11-11",
		len(got) >= 3 && fmt.Sprint(got[:3]) == fmt.Sprint(want), strings.Join(got, " | "))

	// One usage read per account per cycle. A credentials retry at boot plans without reading usage.
	readingPlans := func() int { return r.count("plan ") - r.count("(credentials retry)") }
	r.waitFor("three plans that read usage", 20*time.Second, func() bool { return readingPlans() >= 3 })
	counts := map[string]int{}
	for _, l := range labels {
		counts[l] = r.readCount(l)
	}
	r.add("one usage read per account per cycle (3 cycles, 3 reads each)",
		counts["weekly-out"] == 3 && counts["fable-out"] == 3 && counts["fable-left"] == 3, fmt.Sprint(counts))
	lines, startFailed := r.pluginLines(), false
	for i, l := range lines {
		if strings.HasPrefix(l, "plan 1 (start)") {
			startFailed = i > 0 && strings.HasPrefix(lines[i-1], "cooldown check skipped")
			break
		}
	}
	r.add("when the start cycle cannot read the gateway's credentials (not listening yet), the plugin reads them again within seconds",
		!startFailed || r.count("plan 2 (credentials retry)") == 1, fmt.Sprintf("start read failed: %v, retry plans: %d", startFailed, r.count("(credentials retry)")))

	// Hot reload by config change only: same plugin file, same plugin config.
	r.writeConfig([]string{"e2e-client-key", "e2e-client-key-2"})
	time.Sleep(4 * time.Second)
	engines := r.runningEngines()
	r.add("config reload with the same plugin config: one engine, not restarted",
		len(engines) == 1 && r.count("running (mode shadow)") == 1, fmt.Sprint(engines))

	// Hot reload to a new plugin build: the host quiesces the old copy and keeps it loaded.
	r.buildPlugin(filepath.Join(r.plugins, "claude-quota-v0.1.1.so"), "claude-quota-e2e-reload")
	r.writeConfig([]string{"e2e-client-key", "e2e-client-key-3"})
	r.waitFor("hot reload to v0.1.1", 30*time.Second, func() bool {
		b, _ := os.ReadFile(r.logPath)
		return strings.Contains(string(b), "plugin hot reloaded") && r.count("running (mode shadow)") >= 2
	})
	time.Sleep(time.Second)
	before := map[string]int{}
	for _, l := range labels {
		before[l] = r.readCount(l)
	}
	time.Sleep(9500 * time.Millisecond)
	delta := map[string]int{}
	for _, l := range labels {
		delta[l] = r.readCount(l) - before[l]
	}
	engines = r.runningEngines()
	_, h = r.health()
	r.add("after a hot reload to a new build exactly one engine runs (old copy stopped, new copy running)",
		len(engines) == 1 && r.count("running (mode shadow)") == 2 && r.count(" stopped") == 1,
		fmt.Sprintf("running=%v starts=%d stops=%d health engine=%v", engines, r.count("running (mode shadow)"), r.count(" stopped"), h["engine"]))
	r.add("after the hot reload each account is read about once per 3 s poll, not twice (9.5 s window)",
		delta["fable-out"] >= 2 && delta["fable-out"] <= 4 && delta["fable-left"] <= 4 && delta["weekly-out"] <= 4, fmt.Sprint(delta))

	// A window's reset time in the near future triggers a re-plan at that time.
	resetAt := time.Now().Add(6 * time.Second).UTC()
	r.mu.Lock()
	r.override[tokenBase+"fable-out"] = func(now time.Time) []byte {
		v := fixture(t, "fable-out")
		next := resetAt
		if !now.Before(resetAt) {
			next = resetAt.Add(7 * 24 * time.Hour)
		}
		v["limits"].([]any)[1].(map[string]any)["resets_at"] = next.Format(time.RFC3339Nano)
		b, _ := json.Marshal(v)
		return b
	}
	r.mu.Unlock()
	reasonBefore := r.count("(window reset or quota 429)")
	time.Sleep(time.Until(resetAt) + 2*time.Second)
	r.mu.Lock()
	var atReset []string
	for _, ts := range r.reads[tokenBase+"fable-out"] {
		if d := ts.Sub(resetAt); d >= 0 && d <= 1500*time.Millisecond {
			atReset = append(atReset, d.String())
		}
	}
	r.mu.Unlock()
	r.add("a window reset 6 s ahead triggers a usage read and a re-plan within 1.5 s of the reset",
		len(atReset) >= 1 && r.count("(window reset or quota 429)") > reasonBefore,
		fmt.Sprintf("reads after reset: %v, reason lines %d -> %d", atReset, reasonBefore, r.count("(window reset or quota 429)")))

	// Limits go stale when the usage server dies; the reservation is released, Fable stays.
	r.writeAuth("fable-left", []string{"claude-opus-*", "claude-sonnet-*"})
	r.writeAuth("fable-out", []string{"claude-fable-*"})
	time.Sleep(4 * time.Second)
	shadowBefore := r.count("shadow: ")
	r.usage.Close()
	r.usage = nil
	failOpen := "fail-open: fable-left@example.com has no usage read newer than 8s; releasing its Opus/Sonnet reservation"
	release := `shadow: fable-left@example.com excluded_models ["claude-opus-*","claude-sonnet-*"] -> null`
	r.waitFor("fail-open after limits go stale", 25*time.Second, func() bool { return r.count(failOpen) >= 1 && r.count(release) >= 1 })
	var after []string
	for _, l := range r.pluginLines() {
		if strings.HasPrefix(l, "shadow: ") {
			after = append(after, l)
		}
	}
	fableKept := true
	for _, l := range after[shadowBefore:] {
		if strings.Contains(l, "fable-out@") {
			fableKept = false
		}
	}
	r.add("usage server down: limits go stale, the fail-open line appears and only the Opus/Sonnet reservation is released",
		r.count(failOpen) >= 1 && r.count(release) >= 1 && fableKept, strings.Join(after[shadowBefore:], " | "))

	// Nothing was written to the gateway.
	writes := r.nonGetMgmt()
	r.mu.Lock()
	gets := len(r.mgmt)
	r.mu.Unlock()
	r.add("no PATCH or reset request reached the management API from the plugin", len(writes) == 0 && gets > 0,
		fmt.Sprintf("%d GET, other: %v", gets-len(writes), writes))
	r.add("the auth files still hold what the test wrote", fmt.Sprint(r.authExcluded("fable-left")) == "[claude-opus-* claude-sonnet-*]" &&
		r.authExcluded("weekly-out") == nil && fmt.Sprint(r.authExcluded("fable-out")) == "[claude-fable-*]",
		fmt.Sprint(r.authExcluded("fable-left"), r.authExcluded("weekly-out"), r.authExcluded("fable-out")))
	all, _ := os.ReadFile(r.logPath)
	r.add("no management key or OAuth token in the gateway log", !bytes.Contains(all, []byte(mgmtKey)) && !bytes.Contains(all, []byte(tokenBase)), "")
}

func tail(s string, n int) string {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}

func (r *run) writeReport() {
	path := os.Getenv("E2E_REPORT")
	if path == "" {
		path = "e2e-report.txt"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "claude-quota e2e run %s\ngateway built from %s, plugin from plugins/claude-quota\n\n", time.Now().UTC().Format(time.RFC3339), r.repo)
	passed := 0
	for _, c := range r.checks {
		status := "FAIL"
		if c.ok {
			status, passed = "PASS", passed+1
		}
		fmt.Fprintf(&b, "  %s  %s", status, c.name)
		if c.detail != "" {
			fmt.Fprintf(&b, "\n        %s", c.detail)
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "\n%d of %d checks passed\n\nplugin log lines from the gateway log:\n", passed, len(r.checks))
	for _, l := range r.pluginLines() {
		fmt.Fprintf(&b, "  %s\n", l)
	}
	_ = os.WriteFile(path, []byte(b.String()), 0o644)
	if raw, err := os.ReadFile(r.logPath); err == nil {
		_ = os.WriteFile(strings.TrimSuffix(path, ".txt")+"-gateway.log", raw, 0o644)
	}
	r.t.Log(b.String())
}
