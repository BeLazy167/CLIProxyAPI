package offers

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// counter is a reachable HTTP server that counts every request and answers like Anthropic, Bark and Resend.
type counter struct {
	srv *httptest.Server
	n   atomic.Int32
}

func newCounter(t *testing.T, addr string, h http.HandlerFunc) *counter {
	t.Helper()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("listen %s: %v", addr, err)
	}
	c := &counter{}
	c.srv = &httptest.Server{Listener: l, Config: &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.n.Add(1)
		if h != nil {
			h(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"reset","resets_left":0}`))
	})}}
	c.srv.Start()
	t.Cleanup(c.srv.Close)
	return c
}

// lanAddr is a non-loopback IPv4 address of this machine, so a test server on it is reachable but not loopback.
func lanAddr(t *testing.T) string {
	t.Helper()
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLoopback() && !ipn.IP.IsLinkLocalUnicast() {
			return ipn.IP.String()
		}
	}
	t.Fatal("this machine has no non-loopback IPv4 address to test against")
	return ""
}

func keyFiles(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	bark, resend := filepath.Join(dir, "bark.key"), filepath.Join(dir, "resend.key")
	for _, p := range []string{bark, resend} {
		if err := os.WriteFile(p, []byte("FAKE-KEY\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return bark, resend
}

// sendAll tries one claim, one Bark push and one email against base and reports what the sender said.
func sendAll(t *testing.T, base string) (ClaimReply, bool, bool) {
	t.Helper()
	bark, resend := keyFiles(t)
	s := NewSender(SendConfig{APIBase: base, UserAgent: "test", BarkBases: []string{base}, BarkKeyFile: bark,
		ResendBase: base, ResendKeyFile: resend, EmailFrom: "a@example.com", EmailTo: "b@example.com"}, t.Logf)
	acct := gateway.Account{Name: "claude-a.json", Label: "a@example.com", Token: "FAKE-TOKEN", Org: "org-a"}
	ctx := context.Background()
	return s.Claim(ctx, acct, "g1", "0123456789abcdef0123456789abcdef"), s.Bark(ctx, "t", "b", ""), s.Email(ctx, "s", "x")
}

// Failure 54: no build without claude_quota_live reaches a host that is not loopback, directly or through a
// redirect, though the host is reachable.
func TestNoSendToReachableNonLoopbackHost(t *testing.T) {
	far := newCounter(t, lanAddr(t)+":0", nil)
	claim, bark, email := sendAll(t, far.srv.URL)
	if n := far.n.Load(); n != 0 {
		t.Fatalf("a %s build sent %d requests to the reachable non-loopback host %s", Mode, n, far.srv.URL)
	}
	if claim.Outcome != OutcomeRejected || bark || email {
		t.Fatalf("refused sends must report nothing sent: claim %+v bark %v email %v", claim, bark, email)
	}

	redirect := newCounter(t, "127.0.0.1:0", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, far.srv.URL+r.URL.Path, http.StatusTemporaryRedirect)
	})
	sendAll(t, redirect.srv.URL)
	if n := far.n.Load(); n != 0 {
		t.Fatalf("a redirect from loopback carried %d requests to the non-loopback host", n)
	}
}
