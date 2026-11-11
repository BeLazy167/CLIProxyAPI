//go:build !claude_quota_live

package engine

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

func TestShadowBuildCannotWrite(t *testing.T) {
	if Mode != "shadow" {
		t.Fatalf("default build runs in mode %q, want shadow", Mode)
	}
	type gatewayWriter interface {
		SetExcludedModels(context.Context, string, []string) error
		ResetCooldown(context.Context, string) error
	}
	if _, linked := any(&gateway.Client{}).(gatewayWriter); linked {
		t.Fatal("the gateway write calls are linked into a shadow build")
	}

	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
	}))
	defer srv.Close()
	var lines []string
	w := NewWriter(&gateway.Client{Base: srv.URL, Key: "k", HTTP: srv.Client()}, func(format string, args ...any) {
		lines = append(lines, fmt.Sprintf(format, args...))
	})
	acct := gateway.Account{Name: "claude-a.json", Label: "a@example.com"}
	if err := w.SetExcludedModels(context.Background(), acct, nil, []string{"claude-fable-*"}); err != nil {
		t.Fatal(err)
	}
	until := time.Date(2026, 11, 11, 18, 0, 0, 0, time.UTC)
	if err := w.ResetCooldown(context.Background(), acct, "idx-a", until); err != nil {
		t.Fatal(err)
	}
	if n := requests.Load(); n != 0 {
		t.Fatalf("shadow writer sent %d requests to the gateway", n)
	}
	want := []string{
		`shadow: a@example.com excluded_models null -> ["claude-fable-*"]`,
		`shadow: a@example.com cooldown reset (stale until 2026-11-11T18:00:00Z)`,
	}
	if fmt.Sprint(lines) != fmt.Sprint(want) {
		t.Fatalf("got %q want %q", lines, want)
	}
}
