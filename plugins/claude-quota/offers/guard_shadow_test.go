//go:build !claude_quota_live && !claude_quota_e2e

package offers

import (
	"reflect"
	"testing"
)

// Failure 54: the default build sends to no host at all, loopback included, and links no real sender.
func TestDefaultBuildSendsNothing(t *testing.T) {
	if Mode != "shadow" || writesState {
		t.Fatalf("default build: mode %q, writes state %v; want shadow and false", Mode, writesState)
	}
	if s := NewSender(SendConfig{}, t.Logf); reflect.TypeOf(s) != reflect.TypeOf(noneSender{}) {
		t.Fatalf("the default build links the sender %T", s)
	}
	near := newCounter(t, "127.0.0.1:0", nil)
	claim, bark, email := sendAll(t, near.srv.URL)
	if n := near.n.Load(); n != 0 || claim.Outcome != OutcomeRejected || bark || email {
		t.Fatalf("default build sent %d requests to loopback (claim %+v bark %v email %v)", n, claim, bark, email)
	}
	if len(DefaultBarkBases) != 0 || DefaultResendBase != "" {
		t.Fatalf("default build carries send hosts: %v %q", DefaultBarkBases, DefaultResendBase)
	}
}
