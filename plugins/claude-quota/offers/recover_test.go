package offers

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Failures 44, 55, 58: at start SENDING becomes UNKNOWN and a legacy offer is bound to the organization in its
// auth file. A build that writes state saves both; the default build leaves the Python-owned file untouched.
func TestRecoverAndBindLegacyOffers(t *testing.T) {
	dir := t.TempDir()
	auth := filepath.Join(dir, "auth")
	if err := os.MkdirAll(auth, 0o700); err != nil {
		t.Fatal(err)
	}
	af := filepath.Join(auth, "claude-a.json")
	acct := `{"email":"a@example.com","access_token":"FAKE","organization_uuid":"org-a","expired":"2030-01-01T00:00:00Z"}`
	if err := os.WriteFile(af, []byte(acct), 0o600); err != nil {
		t.Fatal(err)
	}
	state := map[string]any{"csrf_key": "00", "sent": map[string]any{}, "offers": map[string]any{
		"legacy":  map[string]any{"label": "a@example.com", "auth_file": af, "state": "OFFERED", "kind": "near_limit"},
		"sending": map[string]any{"label": "a@example.com", "auth_file": af, "state": "SENDING", "kind": "near_limit", "org": "org-a"},
		"gone":    map[string]any{"label": "b@example.com", "auth_file": filepath.Join(auth, "claude-b.json"), "state": "OFFERED", "kind": "near_limit"},
		"done":    map[string]any{"label": "a@example.com", "auth_file": af, "state": "DONE", "kind": "near_limit"},
	}}
	raw, _ := json.Marshal(state)
	path := filepath.Join(dir, "state", "state.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	s := &Service{cfg: Config{AuthDir: auth}, store: NewStore(path), logf: t.Logf, now: time.Now}
	s.Recover()
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !writesState {
		if !bytes.Equal(after, raw) {
			t.Fatal("the default build wrote state.json")
		}
		return
	}
	st, err := s.store.Read()
	if err != nil {
		t.Fatal(err)
	}
	o := st.Offers()
	if o["sending"].State() != "UNKNOWN" || o["legacy"]["org"] != "org-a" || o["gone"]["org"] != nil ||
		o["done"]["org"] != nil || o["legacy"].State() != "OFFERED" {
		t.Fatalf("after recover: %v", o)
	}
}
