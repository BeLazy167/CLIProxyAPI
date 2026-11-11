//go:build !claude_quota_live

package engine

import (
	"context"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Mode is the only mode this build supports. The live writer needs the claude_quota_live build tag.
const Mode = "shadow"

// NewWriter returns a writer that logs each write it skips and sends nothing.
func NewWriter(_ *gateway.Client, logf Logf) Writer {
	return shadowWriter{logf: logf}
}

type shadowWriter struct {
	logf Logf
}

func (s shadowWriter) SetExcludedModels(_ context.Context, acct gateway.Account, from, to []string) error {
	s.logf("shadow: %s excluded_models %s -> %s", acct.Label, models(from), models(to))
	return nil
}

func (s shadowWriter) ResetCooldown(_ context.Context, acct gateway.Account, _, why string) error {
	s.logf("shadow: %s cooldown reset (%s)", acct.Label, why)
	return nil
}
