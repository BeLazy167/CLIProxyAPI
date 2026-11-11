//go:build claude_quota_live

package engine

import (
	"context"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Mode is the mode a claude_quota_live build runs in.
const Mode = "live"

// NewWriter returns the writer that sends the field PATCH and the cooldown reset to the gateway.
func NewWriter(gw *gateway.Client, logf Logf) Writer {
	return liveWriter{gw: gw, logf: logf}
}

type liveWriter struct {
	gw   *gateway.Client
	logf Logf
}

func (l liveWriter) SetExcludedModels(ctx context.Context, acct gateway.Account, from, to []string) error {
	if err := l.gw.SetExcludedModels(ctx, acct.Name, to); err != nil {
		return err
	}
	l.logf("%s: excluded_models %s -> %s", acct.Label, models(from), models(to))
	return nil
}

func (l liveWriter) ResetCooldown(ctx context.Context, acct gateway.Account, authIndex, why string) error {
	if err := l.gw.ResetCooldown(ctx, authIndex); err != nil {
		return err
	}
	l.logf("%s: gateway cooldown cleared (%s)", acct.Label, why)
	return nil
}
