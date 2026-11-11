// Package gateway reads the local CLIProxyAPI: its management API over loopback, and the Claude auth files.
//
// The default build can only read. The write calls live in write_live.go behind the claude_quota_live
// build tag. Error messages never include the management key or an OAuth token.
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/rules"
)

// Client calls the gateway's management API with the management key.
type Client struct {
	Base string
	Key  string
	HTTP *http.Client
}

// Credential is one entry of GET /v8/management/credentials.
type Credential struct {
	Name      string
	ID        string
	AuthIndex string
	Cooldowns []rules.Cooldown
}

func (c *Client) request(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.Base+path, body)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", method, path, err)
	}
	req.Header.Set("Authorization", "Bearer "+c.Key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", method, path, cause(err))
	}
	if resp.StatusCode/100 != 2 {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%s %s: HTTP %d", method, path, resp.StatusCode)
	}
	return resp, nil
}

// Credentials maps auth file name to its gateway entry.
func (c *Client) Credentials(ctx context.Context) (map[string]Credential, error) {
	const path = "/v8/management/credentials"
	resp, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	var reply struct {
		Files []map[string]any `json:"files"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&reply); err != nil || reply.Files == nil {
		return nil, fmt.Errorf("GET %s: reply has no files list", path)
	}
	out := make(map[string]Credential, len(reply.Files))
	for _, f := range reply.Files {
		name, ok := f["name"].(string)
		if !ok {
			continue
		}
		cred := Credential{Name: name, Cooldowns: rules.ParseCooldowns(f["cooldowns"])}
		cred.ID, _ = f["id"].(string)
		cred.AuthIndex, _ = f["auth_index"].(string)
		out[name] = cred
	}
	return out, nil
}

// Account is one Claude auth file as the gateway stores it.
type Account struct {
	Name           string
	Label          string
	Token          string
	Org            string
	Expired        time.Time
	Disabled       bool
	ExcludedModels []string
}

// TokenFresh matches the Python service: the token must stay valid for at least another minute.
func (a Account) TokenFresh(now time.Time) bool {
	return a.Expired.After(now.Add(time.Minute))
}

// AuthFiles lists the claude-*.json auth file names in dir, sorted.
func AuthFiles(dir string) ([]string, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "claude-*.json"))
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(paths))
	for _, p := range paths {
		names = append(names, filepath.Base(p))
	}
	sort.Strings(names)
	return names, nil
}

// LoadAccount reads one auth file. An error means the account is unreadable and must be left out of routing.
func LoadAccount(dir, name string) (Account, error) {
	raw, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return Account{}, fmt.Errorf("read auth file: %w", cause(err))
	}
	var a map[string]any
	if err := json.Unmarshal(raw, &a); err != nil {
		return Account{}, errors.New("auth file is not a JSON object")
	}
	acct := Account{Name: name}
	for key, dst := range map[string]*string{"access_token": &acct.Token, "organization_uuid": &acct.Org, "email": &acct.Label} {
		s, _ := a[key].(string)
		if s == "" {
			return Account{}, fmt.Errorf("missing %s", key)
		}
		*dst = s
	}
	acct.Expired, _ = rules.ParseTime(a["expired"])
	acct.Disabled = truthy(a["disabled"])
	switch v := a["excluded_models"].(type) {
	case nil:
	case []any:
		for _, m := range v {
			s, ok := m.(string)
			if !ok {
				return Account{}, errors.New("excluded_models holds a value that is not a string")
			}
			acct.ExcludedModels = append(acct.ExcludedModels, s)
		}
	default:
		return Account{}, errors.New("excluded_models is not a list")
	}
	return acct, nil
}

// truthy follows Python's bool() for JSON values, as the Python service reads "disabled".
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x != ""
	case []any:
		return len(x) > 0
	case map[string]any:
		return len(x) > 0
	}
	return true
}

// cause drops the wrapper that repeats the URL or path, keeping the reason.
func cause(err error) error {
	if inner := errors.Unwrap(err); inner != nil {
		return inner
	}
	return err
}
