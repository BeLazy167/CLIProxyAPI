//go:build !claude_quota_live && !claude_quota_e2e

package offers

import (
	"context"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Mode is the build's mode. The default build cannot spend: its sender sends nothing to any host, and it never
// writes the state file, which the Python service owns until cutover.
const Mode = "shadow"

const writesState = false

// The default build carries no Bark or Resend host.
var (
	DefaultBarkBases  []string
	DefaultResendBase = ""
)

// NewSender returns the sender that logs what it would send and sends nothing.
func NewSender(_ SendConfig, logf func(string, ...any)) Sender {
	return noneSender{logf: logf}
}

type noneSender struct {
	logf func(string, ...any)
}

func (n noneSender) Claim(_ context.Context, acct gateway.Account, grantID, _ string) ClaimReply {
	n.logf("shadow offers: claim of %s on %s not sent", grantID, acct.Label)
	return ClaimReply{Outcome: OutcomeRejected, Reason: "not sent: this build cannot claim"}
}

func (n noneSender) Bark(_ context.Context, title, _, _ string) bool {
	n.logf("shadow offers: Bark push not sent: %s", title)
	return false
}

func (n noneSender) Email(_ context.Context, subject, _ string) bool {
	n.logf("shadow offers: email not sent: %s", subject)
	return false
}
