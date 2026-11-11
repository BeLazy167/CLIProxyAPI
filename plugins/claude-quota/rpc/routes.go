package rpc

import (
	"context"
	"encoding/json"
	"html"
	"net/http"
	"net/url"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/offers"
)

const (
	maxBody = 4096
	// claimWait is how long a tap waits for the engine to take it: a claim in progress, a cycle, or a copy
	// that waits for the state lock during a hot reload.
	claimWait = 90 * time.Second
)

type route struct {
	method, path, description string
	serve                     func(p *Plugin, req managementRequest) map[string]any
}

// managementRoutes are the plugin's management API routes. The gateway checks the management key on each;
// Caddy adds it for the two offer routes only (caddy/reset.caddy).
var managementRoutes = []route{
	{http.MethodGet, "/health", "claude-quota engine health", func(p *Plugin, _ managementRequest) map[string]any {
		return reply(http.StatusOK, p.health(time.Now()))
	}},
	{http.MethodGet, "/offer", "claude-quota offer page (Bark link, through Caddy)", (*Plugin).offerPage},
	{http.MethodPost, "/offer/claim", "claude-quota offer page claim (form: nonce; token in the query)", (*Plugin).offerClaim},
	{http.MethodPost, "/claim", "claude-quota claim for the quota panel (JSON: auth_index, grant_id)", (*Plugin).panelClaim},
}

type managementRequest struct {
	Method  string
	Path    string
	Headers http.Header
	Query   url.Values
	Body    []byte
}

func (p *Plugin) serve(req managementRequest) map[string]any {
	for _, r := range managementRoutes {
		if req.Method == r.method && req.Path == routeBase+r.path {
			return r.serve(p, req)
		}
	}
	return reply(http.StatusNotFound, map[string]string{"error": "not found"})
}

func page(code int, body string) map[string]any {
	return map[string]any{"StatusCode": code, "Headers": offers.PageHeaders, "Body": []byte(body)}
}

func (p *Plugin) offerPage(req managementRequest) map[string]any {
	r := p.cur.Load()
	if r == nil {
		return page(http.StatusServiceUnavailable, "claude-quota is stopped.")
	}
	token := ""
	if t := req.Query["token"]; len(t) == 1 {
		token = t[0]
	}
	code, body := r.eng.Offers().Page(context.Background(), token)
	return page(code, body)
}

// offerClaim is the Claim button. The token comes from the query (the Caddy rewrite) or the form; when both
// are present they must agree.
func (p *Plugin) offerClaim(req managementRequest) map[string]any {
	if len(req.Body) > maxBody {
		return page(http.StatusRequestEntityTooLarge, "Request too large.")
	}
	form, err := url.ParseQuery(string(req.Body))
	q, f := req.Query["token"], form["token"]
	if err != nil || len(q) > 1 || len(f) > 1 || (len(q) == 1 && len(f) == 1 && q[0] != f[0]) {
		return page(http.StatusBadRequest, "Bad request.")
	}
	token := ""
	switch {
	case len(q) == 1:
		token = q[0]
	case len(f) == 1:
		token = f[0]
	}
	r := p.cur.Load()
	if r == nil {
		return page(http.StatusServiceUnavailable, "claude-quota is stopped. Nothing was claimed.")
	}
	svc := r.eng.Offers()
	origin := ""
	if o := req.Headers.Values("Origin"); len(o) == 1 {
		origin = o[0]
	}
	oid, bad := svc.CheckPost(token, form.Get("nonce"), origin)
	if bad != nil {
		return page(bad.Code, html.EscapeString(bad.Message))
	}
	res := busy
	r.eng.Do(func() { res = svc.Claim(context.Background(), oid) }, claimWait)
	return page(res.Code, svc.AfterPost(token, res))
}

var busy = offers.Result{Code: http.StatusServiceUnavailable, Message: "claude-quota is busy or restarting. Nothing was claimed. Try again in a minute."}

// panelClaim is the quota panel's claim. The management key is its only credential.
func (p *Plugin) panelClaim(req managementRequest) map[string]any {
	var body struct {
		AuthIndex string `json:"auth_index"`
		GrantID   string `json:"grant_id"`
	}
	if len(req.Body) > maxBody {
		return reply(http.StatusRequestEntityTooLarge, map[string]string{"message": "Request too large."})
	}
	if err := json.Unmarshal(req.Body, &body); err != nil || body.AuthIndex == "" || body.GrantID == "" {
		return reply(http.StatusBadRequest, map[string]string{"message": "Send JSON with auth_index and grant_id."})
	}
	r := p.cur.Load()
	if r == nil {
		return reply(busy.Code, map[string]string{"message": busy.Message})
	}
	res, oid := busy, ""
	r.eng.Do(func() { res, oid = r.eng.PanelClaim(body.AuthIndex, body.GrantID) }, claimWait)
	return reply(res.Code, map[string]string{"message": res.Message, "offer_id": oid, "state": r.eng.Offers().OfferState(oid)})
}
