package management

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

// Fork: the claude-quota plugin is the only sender of Claude reset claims, so the generic api-call tool refuses
// Anthropic's claim endpoint. A browser tab of an older panel could otherwise spend a reset outside the plugin's
// guards.
func TestAPICallRefusesClaudeResetClaims(t *testing.T) {
	t.Parallel()

	h := &Handler{cfg: &config.Config{}}
	router := gin.New()
	router.POST("/", h.APICall)

	refused := []string{
		"https://api.anthropic.com/api/organizations/11111111-2222-3333-4444-555555555555/reset_rate_limits",
		"https://API.ANTHROPIC.COM:443/api/organizations/x/reset_rate_limits/",
		"https://api.anthropic.com//api/organizations/x/../x/reset_rate_limits?a=1",
		"https://api.anthropic.com/api/organizations/x/RESET_RATE_LIMITS",
		"https://api.anthropic.com./api/organizations/x/reset_rate_limits",
		"https://api.anthropic.com/api/organizations/x/%72eset_rate_limits",
		"https://claude.ai/api/organizations/x/reset_rate_limits",
		"https://console.anthropic.com/api/organizations/x/reset_rate_limits",
		"https://api.anthropic。com/api/organizations/x/reset_rate_limits",
		"https://api．anthropic.com/api/organizations/x/reset_rate_limits",
		"https://API.Ａnthropic.com/api/organizations/x/reset_rate_limits",
	}
	for _, target := range refused {
		body := `{"method":"POST","url":"` + target + `","data":"{}"}`
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want %d; body = %s", target, recorder.Code, http.StatusForbidden, recorder.Body.String())
		}
	}

	// A Host header override that names Anthropic counts as Anthropic, whatever the URL's host is.
	{
		body := `{"method":"POST","url":"http://127.0.0.1:1/api/organizations/x/reset_rate_limits","header":{"Host":"API.Anthropic.com."},"data":"{}"}`
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusForbidden {
			t.Errorf("Host override: status = %d, want %d", recorder.Code, http.StatusForbidden)
		}
	}

	// Usage and profile reads stay allowed: the guard must not reach the upstream for them either way, so point
	// them at a host that cannot resolve and expect anything but 403.
	for _, target := range []string{
		"http://upstream.invalid/api/oauth/usage?cedar_ember=1",
		"http://upstream.invalid/api/organizations/x/reset_rate_limits",
	} {
		body := `{"method":"GET","url":"` + target + `"}`
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, req)
		if recorder.Code == http.StatusForbidden {
			t.Errorf("%s: refused, but it is not Anthropic's claim endpoint", target)
		}
	}
}
