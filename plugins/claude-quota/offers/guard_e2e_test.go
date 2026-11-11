//go:build claude_quota_e2e && !claude_quota_live

package offers

import "testing"

// The e2e build reaches loopback test servers, and only them.
func TestE2EBuildSendsToLoopback(t *testing.T) {
	if Mode != "e2e" || !writesState {
		t.Fatalf("e2e build: mode %q, writes state %v", Mode, writesState)
	}
	near := newCounter(t, "127.0.0.1:0", nil)
	claim, bark, email := sendAll(t, near.srv.URL)
	if n := near.n.Load(); n != 3 || claim.Outcome != OutcomeOK || !bark || !email {
		t.Fatalf("e2e build to loopback: %d requests, claim %+v bark %v email %v", n, claim, bark, email)
	}
}
