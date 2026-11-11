//go:build claude_quota_live

package offers

import (
	"fmt"
	"net/url"
)

// Mode is the live build's mode: it claims, pushes and emails.
const Mode = "live"

const writesState = true

// Bark goes through the local relay first, then the public Bark server; email goes through Resend.
var (
	DefaultBarkBases  = []string{"http://127.0.0.1:8099", "https://api.day.app"}
	DefaultResendBase = "https://api.resend.com"
)

// allowHost lets HTTPS through to any host and plain HTTP only to loopback, so no key crosses a network unencrypted.
func allowHost(u *url.URL) error {
	if u.Scheme == "https" || (u.Scheme == "http" && isLoopback(u.Hostname())) {
		return nil
	}
	return fmt.Errorf("not sent: %s://%s is neither HTTPS nor loopback", u.Scheme, u.Hostname())
}
