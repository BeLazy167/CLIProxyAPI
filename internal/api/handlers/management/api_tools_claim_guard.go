package management

import (
	"net"
	"net/url"
	"path"
	"strings"
)

// isClaudeResetClaim reports whether an api-call request targets Anthropic's reset-claim endpoint,
// /api/organizations/<org>/reset_rate_limits, on any Anthropic or Claude host, named by the URL or by a Host header
// override. Fork: the claude-quota plugin is the only sender of these claims, so the generic api-call tool refuses
// them.
func isClaudeResetClaim(u *url.URL, headers map[string]string) bool {
	anthropic := isAnthropicHost(u.Hostname())
	for key, value := range headers {
		if strings.EqualFold(key, "host") && isAnthropicHost(value) {
			anthropic = true
		}
	}
	if !anthropic {
		return false
	}
	parts := strings.Split(strings.Trim(path.Clean("/"+u.Path), "/"), "/")
	return len(parts) == 4 && strings.EqualFold(parts[0], "api") && strings.EqualFold(parts[1], "organizations") &&
		strings.EqualFold(parts[3], "reset_rate_limits")
}

func isAnthropicHost(host string) bool {
	host = strings.TrimSpace(host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.TrimRight(strings.ToLower(host), ".")
	for _, domain := range []string{"anthropic.com", "claude.ai", "claude.com"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}
