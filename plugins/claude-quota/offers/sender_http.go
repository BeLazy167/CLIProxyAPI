//go:build claude_quota_live || claude_quota_e2e

package offers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// claimResults are the results claude_api.RESULTS knows.
var claimResults = []string{"reset", "already_used", "not_limited", "cooldown", "ineligible", "unavailable"}

// NewSender returns the sender that sends over HTTP. Each request's host passes allowHost before any network call.
func NewSender(cfg SendConfig, logf func(string, ...any)) Sender {
	return &httpSender{cfg: cfg, logf: logf, client: &http.Client{
		// A redirect could carry a request past allowHost, so none is followed.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

type httpSender struct {
	cfg    SendConfig
	logf   func(string, ...any)
	client *http.Client
}

func isLoopback(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || (ip != nil && ip.IsLoopback())
}

// post sends one JSON POST and returns the status and body. Errors never include the URL, which can hold a key.
func (h *httpSender) post(ctx context.Context, rawURL string, body any, header http.Header, timeout time.Duration) (int, []byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return 0, nil, errors.New("bad URL")
	}
	if err := allowHost(u); err != nil {
		return 0, nil, notSent{err}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, errors.New("bad request")
	}
	req.Header = header
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		var uerr *url.Error
		if errors.As(err, &uerr) {
			err = uerr.Err
		}
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, data, err
}

// notSent marks a request allowHost stopped before any network call.
type notSent struct{ error }

func readKey(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", errors.New("key file cannot be read")
	}
	key := strings.TrimSpace(string(raw))
	if key == "" {
		return "", errors.New("key file is empty")
	}
	return key, nil
}

// Claim posts the claim. A request that may have reached Claude is never reported as rejected.
func (h *httpSender) Claim(ctx context.Context, acct gateway.Account, grantID, requestID string) ClaimReply {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+acct.Token)
	header.Set("anthropic-beta", "oauth-2025-04-20")
	header.Set("User-Agent", h.cfg.UserAgent)
	status, data, err := h.post(ctx, h.cfg.APIBase+"/api/organizations/"+url.PathEscape(acct.Org)+"/reset_rate_limits",
		map[string]any{"program": "cedar_ember", "grant_id": grantID, "request_id": requestID}, header, 25*time.Second)
	switch {
	case errors.As(err, new(notSent)):
		return ClaimReply{Outcome: OutcomeRejected, Reason: err.Error()}
	case err != nil:
		return ClaimReply{Outcome: OutcomeUnknown, Reason: errName(err)}
	case status >= 500:
		return ClaimReply{Outcome: OutcomeUnknown, Reason: fmt.Sprintf("HTTP %d", status)}
	case status >= 300:
		return ClaimReply{Outcome: OutcomeRejected, Reason: fmt.Sprintf("HTTP %d", status)}
	}
	if len(bytes.TrimSpace(data)) == 0 {
		data = []byte("{}")
	}
	v, err := ParseUsage(data)
	body, ok := v.(map[string]any)
	if result, _ := body["result"].(string); err != nil || !ok || !slices.Contains(claimResults, result) {
		return ClaimReply{Outcome: OutcomeUnknown, Reason: "reply has no known result"}
	}
	return ClaimReply{Outcome: OutcomeOK, Body: body}
}

func errName(err error) string {
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return "timeout"
	}
	return err.Error()
}

// Bark pushes through each Bark base in turn until one takes it.
func (h *httpSender) Bark(ctx context.Context, title, body, link string) bool {
	key, err := readKey(h.cfg.BarkKeyFile)
	if err != nil {
		h.logf("Bark push not sent: %v", err)
		return false
	}
	payload := map[string]any{"title": title, "body": body, "group": "claude-reset"}
	if link != "" {
		payload["url"] = link
	}
	for _, base := range h.cfg.BarkBases {
		status, _, err := h.post(ctx, base+"/"+key, payload, userAgent(), 15*time.Second)
		if err == nil && status/100 == 2 {
			return true
		}
		if errors.As(err, new(notSent)) {
			h.logf("Bark push %v", err)
		}
	}
	return false
}

// Email sends one email through Resend.
func (h *httpSender) Email(ctx context.Context, subject, text string) bool {
	key, err := readKey(h.cfg.ResendKeyFile)
	if err != nil {
		h.logf("email not sent: %v", err)
		return false
	}
	header := userAgent()
	header.Set("Authorization", "Bearer "+key)
	status, _, err := h.post(ctx, h.cfg.ResendBase+"/emails", map[string]any{
		"from": "claude-reset <" + h.cfg.EmailFrom + ">", "to": []string{h.cfg.EmailTo}, "subject": subject, "text": text,
	}, header, 15*time.Second)
	if errors.As(err, new(notSent)) {
		h.logf("email %v", err)
	}
	return err == nil && status/100 == 2
}

// userAgent is the header Resend's front needs; it rejects a default library agent.
func userAgent() http.Header {
	h := http.Header{}
	h.Set("User-Agent", "claude-reset/1.0")
	return h
}
