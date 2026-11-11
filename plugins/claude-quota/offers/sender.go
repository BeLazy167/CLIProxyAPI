package offers

import (
	"context"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Claim outcomes, as claude_api.claim reports them.
const (
	OutcomeOK       = "ok"       // a reply with a known result
	OutcomeRejected = "rejected" // refused before anything was used: a 4xx, or not sent at all
	OutcomeUnknown  = "unknown"  // may have reached Claude: timeout, dropped connection, 5xx, or no known result
)

// ClaimReply is one claim attempt's outcome. Body is the reply when Outcome is ok; Reason says why otherwise.
type ClaimReply struct {
	Outcome string
	Body    map[string]any
	Reason  string
}

// SendConfig is where the senders send and the files that hold their keys. Keys are read at send time.
type SendConfig struct {
	APIBase       string
	UserAgent     string
	BarkBases     []string
	BarkKeyFile   string
	ResendBase    string
	ResendKeyFile string
	EmailFrom     string
	EmailTo       string
}

// Sender is every message the offers code sends out: the claim, Bark pushes and emails. NewSender returns
// the build's only implementation. Bark and Email report whether the message was delivered.
type Sender interface {
	Claim(ctx context.Context, acct gateway.Account, grantID, requestID string) ClaimReply
	Bark(ctx context.Context, title, body, link string) bool
	Email(ctx context.Context, subject, text string) bool
}
