//go:build claude_quota_e2e || claude_quota_live

package offers

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// recordingSender answers every claim with "reset" and records the request IDs; pushes and emails succeed.
type recordingSender struct{ claims []string }

func (r *recordingSender) Claim(_ context.Context, _ gateway.Account, _, requestID string) ClaimReply {
	r.claims = append(r.claims, requestID)
	return ClaimReply{Outcome: OutcomeOK, Body: map[string]any{"result": "reset"}}
}
func (r *recordingSender) Bark(context.Context, string, string, string) bool { return true }
func (r *recordingSender) Email(context.Context, string, string) bool        { return true }

// Failure 59: the SENDING record and its request ID are durable before the claim POST: the state file and the
// directory entry of its rename are synced. When the directory cannot be synced, nothing is sent.
func TestNoClaimWhenTheStateDirCannotBeSynced(t *testing.T) {
	dir := t.TempDir()
	auth, stateDir := filepath.Join(dir, "auth"), filepath.Join(dir, "state")
	for _, d := range []string{auth, stateDir} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	af := filepath.Join(auth, "claude-a.json")
	raw := `{"email":"a@example.com","access_token":"FAKE","organization_uuid":"org-a","expired":"2030-01-01T00:00:00Z"}`
	if err := os.WriteFile(af, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(usageCase([]any{grantCase("g1", []string{"seven_day"}, 0, map[string]any{"ends_at": at(20), "resets_left": 2})}, 0, 0, at(72)))
	usage, err := ParseUsage(body)
	if err != nil {
		t.Fatal(err)
	}
	rules := Rules{ThresholdPct: 90, MinResetHours: 24, ExpiryAlertHours: []int{168, 24}}
	send := &recordingSender{}
	s := New(Config{AuthDir: auth, Rules: rules}, NewStore(filepath.Join(stateDir, "state.json")), send, Hooks{
		ReadUsage:  func(context.Context, gateway.Account) ([]byte, error) { return body, nil },
		AfterReset: func(context.Context, gateway.Account, any) string { return "gateway cooldown cleared" },
	}, t.Logf)
	s.now = func() time.Time { return caseNow }

	acct, err := gateway.LoadAccount(auth, "claude-a.json")
	if err != nil {
		t.Fatal(err)
	}
	cands, _ := Decide(acct.Label, usage, caseNow, rules)
	if len(cands) != 1 || cands[0].Kind != "expiring" {
		t.Fatalf("want one expiry candidate, got %+v", cands)
	}
	oid := OfferID(NewToken())
	if err := s.store.Update(func(st *State) { st.AddOffer(oid, cands[0].record(af, acct, caseNow)) }); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(stateDir, 0o300); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(stateDir, 0o700) })

	res := s.Claim(context.Background(), oid)
	if len(send.claims) != 0 || res.Code != 500 {
		t.Fatalf("a state dir that cannot be synced still sent %d claims (%d %s)", len(send.claims), res.Code, res.Message)
	}
}
