package engine

import (
	"context"
	"encoding/json"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Writer is every side effect the engine can have on the gateway. NewWriter picks the build's only implementation.
type Writer interface {
	SetExcludedModels(ctx context.Context, acct gateway.Account, from, to []string) error
	// ResetCooldown clears every cooldown the gateway holds for one credential; why goes into the log line.
	ResetCooldown(ctx context.Context, acct gateway.Account, authIndex, why string) error
}

// Logf writes one log line.
type Logf func(format string, args ...any)

func models(m []string) string {
	raw, _ := json.Marshal(m)
	return string(raw)
}
