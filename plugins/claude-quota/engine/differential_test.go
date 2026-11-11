package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/rules"
)

type diffAccount struct {
	Name           string          `json:"name"`
	ReadOK         bool            `json:"read_ok"`
	Usage          json.RawMessage `json:"usage"`
	AuthOK         bool            `json:"auth_ok"`
	Disabled       bool            `json:"disabled"`
	ExcludedModels []string        `json:"excluded_models"`
	PatchFails     bool            `json:"patch_fails"`
	Cred           *struct {
		AuthIndex string `json:"auth_index"`
		Cooldowns any    `json:"cooldowns"`
	} `json:"cred"`
}

type diffCase struct {
	ID        int           `json:"id"`
	Now       string        `json:"now"`
	Accounts  []diffAccount `json:"accounts"`
	CredsFail bool          `json:"creds_fail"`
	Pairs     [][2][]string `json:"pairs"`
}

type diffOut struct {
	Limits  map[string]any      `json:"limits"`
	Plan    map[string][]string `json:"plan"`
	Stale   map[string][]string `json:"stale"`
	Writes  [][2]any            `json:"writes"`
	Skipped []string            `json:"skipped"`
	Resets  []string            `json:"resets"`
	Pairs   [][2]bool           `json:"pairs"`
}

type recordingWriter struct {
	out   *diffOut
	fails map[string]bool
}

func (r recordingWriter) SetExcludedModels(_ context.Context, acct gateway.Account, _, to []string) error {
	r.out.Writes = append(r.out.Writes, [2]any{acct.Name, to})
	if r.fails[acct.Name] {
		return errors.New("HTTP 500")
	}
	return nil
}

func (r recordingWriter) ResetCooldown(_ context.Context, _ gateway.Account, authIndex string, _ time.Time) error {
	r.out.Resets = append(r.out.Resets, authIndex)
	return nil
}

// TestDifferential runs the cases test/differential.py generates and writes what the Go port decides.
// The script compares that with the Python service and fails on any difference.
func TestDifferential(t *testing.T) {
	in, outPath := os.Getenv("DIFF_CASES"), os.Getenv("DIFF_OUT")
	if in == "" || outPath == "" {
		t.Skip("run through test/differential.py")
	}
	raw, err := os.ReadFile(in)
	if err != nil {
		t.Fatal(err)
	}
	var cases []diffCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	results := make([]diffOut, 0, len(cases))
	for _, c := range cases {
		results = append(results, runDiffCase(t, c))
	}
	encoded, err := json.Marshal(results)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outPath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
}

func runDiffCase(t *testing.T, c diffCase) diffOut {
	now, err := time.Parse(time.RFC3339Nano, c.Now)
	if err != nil {
		t.Fatalf("case %d: %v", c.ID, err)
	}
	out := diffOut{Limits: map[string]any{}, Stale: map[string][]string{}, Writes: [][2]any{}, Skipped: []string{}, Resets: []string{}}
	sort.Slice(c.Accounts, func(i, j int) bool { return c.Accounts[i].Name < c.Accounts[j].Name })
	limits := map[string]rules.Limits{}
	accounts := map[string]loaded{}
	creds := map[string]gateway.Credential{}
	fails := map[string]bool{}
	var readNow []string
	for _, a := range c.Accounts {
		fails[a.Name] = a.PatchFails
		if a.AuthOK {
			accounts[a.Name] = loaded{acct: gateway.Account{Name: a.Name, Label: a.Name, Disabled: a.Disabled, ExcludedModels: a.ExcludedModels}}
		} else {
			accounts[a.Name] = loaded{err: errors.New("unreadable")}
		}
		var cooldowns []rules.Cooldown
		if a.Cred != nil {
			cooldowns = rules.ParseCooldowns(a.Cred.Cooldowns)
			creds[a.Name] = gateway.Credential{Name: a.Name, AuthIndex: a.Cred.AuthIndex, Cooldowns: cooldowns}
		}
		if !a.ReadOK {
			continue
		}
		lim, ok := rules.ReadLimits(a.Usage)
		if !ok {
			out.Limits[a.Name] = nil
			continue
		}
		var five any
		if lim.FiveHour != nil {
			five = *lim.FiveHour
		}
		out.Limits[a.Name] = []any{lim.Weekly, lim.Fable, five}
		limits[a.Name] = lim
		readNow = append(readNow, a.Name)
		stale := []string{}
		for _, cd := range rules.StaleCooldowns(lim, cooldowns, now) {
			stale = append(stale, cd.RetryAt.UTC().Format(time.RFC3339Nano))
		}
		out.Stale[a.Name] = stale
	}
	out.Plan = rules.Plan(limits)
	logf := func(format string, args ...any) {
		if line := fmt.Sprintf(format, args...); strings.Contains(line, "not added") {
			out.Skipped = append(out.Skipped, strings.SplitN(line, ":", 2)[0])
		}
	}
	w := recordingWriter{out: &out, fails: fails}
	var credErr error
	if c.CredsFail {
		credErr = errors.New("HTTP 500")
	}
	planned := applyRouting(context.Background(), w, logf, limits, accounts, nil)
	healCooldowns(context.Background(), w, logf, creds, credErr, planned, accounts, readNow, now)
	for _, p := range c.Pairs {
		out.Pairs = append(out.Pairs, [2]bool{rules.Changed(p[0], p[1]), rules.AddsReserved(p[0], p[1])})
	}
	return out
}
