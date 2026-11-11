package cliproxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

func TestServiceVersionUpdatersFollowConfig(t *testing.T) {
	catalogs := config.ModelCatalogs{}
	for name, target := range map[string]*string{
		"models.json":              &catalogs.Catalog,
		"codex_client_models.json": &catalogs.CodexCatalog,
		"devin_models.json":        &catalogs.DevinCatalog,
	} {
		path, errAbs := filepath.Abs(filepath.Join("..", "..", "internal", "registry", "models", name))
		if errAbs != nil {
			t.Fatal(errAbs)
		}
		*target = path
	}

	for _, tc := range []struct {
		name         string
		disable      bool
		wantRequests bool
		wantVersion  string
	}{
		{name: "unset fetches the xAI client version", disable: false, wantRequests: true, wantVersion: "1.0.99"},
		{name: "set keeps the built-in xAI client version", disable: true, wantRequests: false, wantVersion: helps.DefaultXAIFallbackClientVersion},
	} {
		t.Run(tc.name, func(t *testing.T) {
			restoreVersion := helps.SetXAIClientVersionForTest(helps.DefaultXAIFallbackClientVersion)
			defer restoreVersion()
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				_, _ = w.Write([]byte(`{"version":"1.0.99"}`))
			}))
			defer server.Close()
			defer helps.OverrideXAINPMRegistryURLForTest(server.URL)()
			refreshed := make(chan struct{}, 1)
			defer helps.SetXAIVersionRefreshedHookForTest(refreshed)()

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s := &Service{cfg: &config.Config{Models: catalogs, DisableVersionUpdaters: tc.disable}}
			s.startModelCatalogUpdaters(ctx)

			select {
			case <-refreshed:
			case <-time.After(500 * time.Millisecond):
			}
			if got := requests.Load() > 0; got != tc.wantRequests {
				t.Fatalf("version registry contacted = %v, want %v", got, tc.wantRequests)
			}
			if got := helps.GetXAIClientVersion(); got != tc.wantVersion {
				t.Fatalf("GetXAIClientVersion() = %q, want %q", got, tc.wantVersion)
			}
		})
	}
}
