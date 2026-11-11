package offers

import (
	"context"
	"crypto/hmac"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// TokenPattern is the token shape in an offer link, as the Python page and the Caddy rewrite accept it.
var TokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{20,100}$`)

// PageHeaders are sent with every page. A form POST under no-referrer carries "Origin: null", which the
// Origin check refuses, so the referrer policy is same-origin.
var PageHeaders = map[string][]string{
	"Content-Type":            {"text/html; charset=utf-8"},
	"Cache-Control":           {"no-store"},
	"Referrer-Policy":         {"same-origin"},
	"X-Frame-Options":         {"DENY"},
	"Content-Security-Policy": {"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'"},
}

const pageTemplate = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude reset</title><style>body{font:16px system-ui;margin:24px;max-width:560px}td{padding:4px 8px}
button{font-size:18px;padding:12px 20px}.msg{padding:12px;background:#eef}</style></head><body>
<h2>%s</h2>%s<table>%s</table>%s</body></html>`

// Page renders the offer page with a live status read. It changes nothing.
func (s *Service) Page(ctx context.Context, token string) (int, string) {
	st, oid, o := s.lookup(token)
	if o == nil {
		return http.StatusNotFound, "Not found"
	}
	var live any = "test offer"
	if o.Kind() != "test" {
		acct, err := s.loadAuth(o.AuthFile())
		if err == nil {
			live, err = s.readStatus(ctx, acct)
		}
		if err != nil {
			live = "unavailable (status read failed)"
		}
	}
	return http.StatusOK, s.render(st, oid, token, o, live, "")
}

// CheckPost checks a claim POST before it is queued: a known token, the configured Origin, and the nonce.
func (s *Service) CheckPost(token, nonce, origin string) (string, *Result) {
	st, oid, o := s.lookup(token)
	if o == nil {
		return "", &Result{http.StatusNotFound, "Not found"}
	}
	if origin != s.cfg.Origin || !hmac.Equal([]byte(nonce), []byte(Nonce(st.CSRFKey(), oid))) {
		return "", &Result{http.StatusForbidden, "Forbidden: reload the offer page and tap again."}
	}
	return oid, nil
}

// AfterPost renders the page with a claim's answer.
func (s *Service) AfterPost(token string, res Result) string {
	st, oid, o := s.lookup(token)
	if o == nil {
		return html.EscapeString(res.Message)
	}
	return s.render(st, oid, token, o, "see below", res.Message)
}

func (s *Service) lookup(token string) (*State, string, Offer) {
	if !TokenPattern.MatchString(token) {
		return nil, "", nil
	}
	st, err := s.store.Read()
	if err != nil {
		return nil, "", nil
	}
	oid := OfferID(token)
	return st, oid, st.Offers()[oid]
}

func (s *Service) render(st *State, oid, token string, o Offer, live any, msg string) string {
	rows := [][2]any{{"Account", o["label"]}, {"Grant", o["grant_id"]}, {"Kind", o["kind"]}, {"Window", o["window"]},
		{"Offer state", o["state"]}, {"Offer expires", o["expires_at"]}}
	if usage, ok := live.(map[string]any); ok {
		g := findGrant(usage, o.GrantID())
		if g == nil {
			g = map[string]any{}
		}
		rows = append(rows, [2]any{"Resets left", g["resets_left"]}, [2]any{"Usable now", g["usable_now"]},
			[2]any{"Percent used", g["percent_used"]}, [2]any{"Clears", g["clears"]}, [2]any{"Blocking", g["blocking"]},
			[2]any{"Unavailable reason", g["unavailable_reason"]}, [2]any{"Grant ends", g["ends_at"]})
		if len(g) > 0 && wellFormed(usage, g) {
			rows = append(rows, [2]any{"Cleared windows now", WindowStatus(usage, g)})
		}
	} else {
		rows = append(rows, [2]any{"Live status", live})
	}
	var body strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&body, "<tr><td>%s</td><td>%s</td></tr>", html.EscapeString(strPy(r[0])), html.EscapeString(strPy(r[1])))
	}
	form := ""
	if o.State() == "OFFERED" || o.State() == "UNKNOWN" {
		action := s.actionBase() + "/offer/" + token + "/claim"
		form = fmt.Sprintf(`<form method="post" action="%s"><input type="hidden" name="token" value="%s">`+
			`<input type="hidden" name="nonce" value="%s"><button type="submit">Claim this reset</button></form>`,
			html.EscapeString(action), html.EscapeString(token), Nonce(st.CSRFKey(), oid))
	}
	title := o.str("title")
	if title == "" {
		title = "Claude reset"
	}
	note := ""
	if msg != "" {
		note = `<p class="msg">` + html.EscapeString(msg) + `</p>`
	}
	return fmt.Sprintf(pageTemplate, html.EscapeString(title), note, body.String(), form)
}

// actionBase is the path of the public base, so the form posts back through the same public route.
func (s *Service) actionBase() string {
	u, err := url.Parse(s.cfg.PublicBase)
	if err != nil {
		return ""
	}
	return u.Path
}
