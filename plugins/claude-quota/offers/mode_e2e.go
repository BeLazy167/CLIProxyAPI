//go:build claude_quota_e2e && !claude_quota_live

package offers

import (
	"fmt"
	"net/url"
)

// Mode is the e2e build's mode: the full offer flow, sending only to loopback test servers.
const Mode = "e2e"

const writesState = true

// The e2e build carries no Bark or Resend host; the test config names its fake servers.
var (
	DefaultBarkBases  []string
	DefaultResendBase = ""
)

// allowHost lets a request through only to a loopback IP or localhost, checked before any network call.
func allowHost(u *url.URL) error {
	if !isLoopback(u.Hostname()) {
		return fmt.Errorf("not sent: this build sends only to loopback, not %s", u.Hostname())
	}
	return nil
}
