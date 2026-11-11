//go:build claude_quota_live

package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
)

// SetExcludedModels patches one field of one auth file; nil clears it.
func (c *Client) SetExcludedModels(ctx context.Context, name string, models []string) error {
	return c.send(ctx, http.MethodPatch, "/v8/management/credentials/fields", map[string]any{"name": name, "excluded_models": models})
}

// ResetCooldown clears every cooldown the gateway holds for one credential.
func (c *Client) ResetCooldown(ctx context.Context, authIndex string) error {
	return c.send(ctx, http.MethodPost, "/v8/management/routing/cooldown/reset", map[string]any{"auth_index": authIndex})
}

func (c *Client) send(ctx context.Context, method, path string, body any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	resp, err := c.request(ctx, method, path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	return resp.Body.Close()
}
