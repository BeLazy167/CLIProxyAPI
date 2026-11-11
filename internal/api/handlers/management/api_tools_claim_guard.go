package management

import (
	"net/url"
	"path"
	"strings"
)

// isClaudeResetClaim reports whether u is Anthropic's reset-claim endpoint, POST
// /api/organizations/<org>/reset_rate_limits. Fork: the claude-quota plugin is the only sender of these claims,
// so the generic api-call tool refuses them.
func isClaudeResetClaim(u *url.URL) bool {
	if !strings.EqualFold(u.Hostname(), "api.anthropic.com") {
		return false
	}
	parts := strings.Split(strings.Trim(path.Clean("/"+u.EscapedPath()), "/"), "/")
	return len(parts) == 4 && strings.EqualFold(parts[0], "api") && strings.EqualFold(parts[1], "organizations") &&
		strings.EqualFold(parts[3], "reset_rate_limits")
}
