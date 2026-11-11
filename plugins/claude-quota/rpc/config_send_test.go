//go:build claude_quota_e2e || claude_quota_live

package rpc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/offers"
)

// Failure 20: a build that sends email starts without an explicit sender and recipient in its config, and so
// mails a built-in address.
func TestSendingBuildNeedsSenderAndRecipient(t *testing.T) {
	dir := t.TempDir()
	keys := map[string]string{}
	for _, k := range []string{"management_key_file", "bark_key_file", "resend_key_file"} {
		keys[k] = filepath.Join(dir, k)
		if err := os.WriteFile(keys[k], []byte("FAKE-KEY\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	base := fmt.Sprintf("mode: %s\nmanagement_base: http://127.0.0.1:1\nstate_dir: %s\nauth_dir: %s\n", offers.Mode, dir, dir)
	for k, v := range keys {
		base += fmt.Sprintf("%s: %s\n", k, v)
	}
	from, to := "email_from: alerts@example.com\n", "email_to: owner@example.com\n"
	for name, c := range map[string]struct {
		yaml, missing string
	}{"no recipient": {base + from, "email_to"}, "no sender": {base + to, "email_from"}} {
		if _, err := ParseConfig([]byte(c.yaml)); err == nil || !strings.Contains(err.Error(), c.missing) {
			t.Errorf("%s: config accepted or wrong error: %v", name, err)
		}
	}
	cfg, err := ParseConfig([]byte(base + from + to))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Engine.Send.EmailFrom != "alerts@example.com" || cfg.Engine.Send.EmailTo != "owner@example.com" {
		t.Fatalf("addresses not taken from the config: %+v", cfg.Engine.Send)
	}
}
