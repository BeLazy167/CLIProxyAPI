package offers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Review round 3: only a claim uses an alert. An offer that expired because a claim on its grant, or on a grant
// clearing one of its windows, went through counts as used; an offer that expired on its own (its grant ended)
// does not, so another grant can still make the window's first claim.
func TestOnlyAClaimUsesAnAlert(t *testing.T) {
	const fable, reset = "seven_day_overage_included", "2026-11-16T23:00:00.081406+00:00"
	near := func(state, grant, window, created string, clears ...string) map[string]any {
		return map[string]any{"label": "old@example.com", "auth_file": "/auth/claude-a.json", "kind": "near_limit",
			"state": state, "grant_id": grant, "window": window, "window_reset": reset, "clears": clears,
			"created_at": created, "expires_at": "2026-11-16T11:00:00+00:00"}
	}
	acct := gateway.Account{Name: "claude-a.json", Label: "new@example.com", Org: "org-a"}
	c := Candidate{Kind: "near_limit", Key: "new@example.com|near|" + fable + "|2026-11-16T23:00:00+00:00",
		GrantID: "fable-only", Window: fable}
	cases := []struct {
		name   string
		offers map[string]any
		used   string
	}{
		{"expired on its own", map[string]any{
			"wide": near("EXPIRED", "wide", fable, "2026-11-11T10:00:00+00:00", "seven_day", fable),
		}, ""},
		{"expired by a claim on a grant that clears its window", map[string]any{
			"sib": near("EXPIRED", "wide", fable, "2026-11-11T10:00:00+00:00", "seven_day", fable),
			"claim": func() map[string]any {
				o := near("DONE", "full", "seven_day", "2026-11-11T11:00:00+00:00", "seven_day", fable)
				o["after"] = map[string]any{"at": "2026-11-11T11:05:00+00:00"}
				return o
			}(),
		}, "sib"},
		{"marked by the claim that expired it, even with the clock moved back", map[string]any{
			"sib": func() map[string]any {
				o := near("EXPIRED", "wide", fable, "2026-11-11T12:00:00+00:00", "seven_day", fable)
				o["expired_by"] = "claim"
				return o
			}(),
			"claim": func() map[string]any {
				o := near("DONE", "full", "seven_day", "2026-11-11T11:00:00+00:00", "seven_day", fable)
				o["after"] = map[string]any{"at": "2026-11-11T11:05:00+00:00"}
				return o
			}(),
		}, "sib"},
		{"legacy sibling of a claim with no settle time counts", map[string]any{
			"sib":   near("EXPIRED", "wide", fable, "2026-11-11T10:00:00+00:00", "seven_day", fable),
			"claim": near("DONE", "full", "seven_day", "2026-11-11T11:00:00+00:00", "seven_day", fable),
		}, "sib"},
		{"expired on its own, made after an unrelated claim", map[string]any{
			"later": near("EXPIRED", "wide", fable, "2026-11-11T12:00:00+00:00", "seven_day", fable),
			"claim": func() map[string]any {
				o := near("DONE", "other", "five_hour", "2026-11-11T11:00:00+00:00", "five_hour")
				o["after"] = map[string]any{"at": "2026-11-11T11:05:00+00:00"}
				return o
			}(),
		}, ""},
	}
	for _, tc := range cases {
		dir := t.TempDir()
		for id := range tc.offers {
			tc.offers[id].(map[string]any)["org"] = "org-a"
		}
		path := filepath.Join(dir, "state.json")
		raw, _ := json.Marshal(map[string]any{"csrf_key": "00", "sent": map[string]any{}, "offers": tc.offers})
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		st, err := NewStore(path).Read()
		if err != nil {
			t.Fatal(err)
		}
		if got := usedBy(st, acct, "/auth/claude-a.json", c, DefaultRules); got != tc.used {
			t.Errorf("%s: usedBy = %q, want %q", tc.name, got, tc.used)
		}
	}
}
