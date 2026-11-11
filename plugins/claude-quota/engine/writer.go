package engine

import (
	"context"
	"encoding/json"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Writer is every side effect the engine can have on the gateway. NewWriter picks the build's only implementation.
type Writer interface {
	SetExcludedModels(ctx context.Context, acct gateway.Account, from, to []string) error
	ResetCooldown(ctx context.Context, acct gateway.Account, authIndex string, staleUntil time.Time) error
}

// Logf writes one log line.
type Logf func(format string, args ...any)

func models(m []string) string {
	raw, _ := json.Marshal(m)
	return string(raw)
}
