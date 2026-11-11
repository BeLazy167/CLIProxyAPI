// Package offers ports the alert and claim half of the Python claude-reset service: it decides which reset
// grants are worth an alert, keeps the offers in the shared state file, and is the only code that can send a
// claim. Every method that changes state runs on the engine's goroutine, which serializes claims as the
// Python service's CLAIM_LOCK did; the page renderer only reads.
package offers

import (
	"context"
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Config is the offers settings, validated by the caller.
type Config struct {
	AuthDir              string
	PublicBase           string // https://gw.blzy.app/reset: Bark links and the page's form action
	Origin               string // the only Origin a claim POST may carry
	Rules                Rules
	StaleTokenAlertHours int
}

// Hooks are what the offers code needs from the engine.
type Hooks struct {
	// ReadUsage reads one account's usage with cedar_ember, as the routing reads do.
	ReadUsage func(ctx context.Context, acct gateway.Account) ([]byte, error)
	// AfterReset runs after a claim result "reset": the gateway cooldown reset and the routing re-plan from
	// the post-claim read (nil when that read failed). It returns the line the page and email show.
	AfterReset func(ctx context.Context, acct gateway.Account, usageAfter any) string
}

// Service is the offers half of the engine.
type Service struct {
	cfg   Config
	store *Store
	send  Sender
	hooks Hooks
	logf  func(string, ...any)
	now   func() time.Time
}

// New returns the offers service for one engine.
func New(cfg Config, store *Store, send Sender, hooks Hooks, logf func(string, ...any)) *Service {
	return &Service{cfg: cfg, store: store, send: send, hooks: hooks, logf: logf, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) update(what string, fn func(*State)) bool {
	if err := s.store.Update(fn); err != nil {
		s.logf("state not saved (%s): %v", what, err)
		return false
	}
	return true
}

// loadAuth reads an offer's auth file, which must be a claude-*.json file directly in the auth dir.
func (s *Service) loadAuth(path string) (gateway.Account, error) {
	dir, name := filepath.Split(path)
	if filepath.Clean(dir) != filepath.Clean(s.cfg.AuthDir) || !strings.HasPrefix(name, "claude-") || !strings.HasSuffix(name, ".json") {
		return gateway.Account{}, fmt.Errorf("auth file %s is not in the auth dir", name)
	}
	return gateway.LoadAccount(s.cfg.AuthDir, name)
}

// Recover runs once when this copy's engine starts, before any claim. A SENDING offer was saved right before
// its POST, so the POST may have reached Claude: it becomes UNKNOWN. An open offer made before offers were
// bound to an organization is bound to the one its auth file holds now.
func (s *Service) Recover() {
	if !writesState {
		s.logf("shadow offers: state.json is read only in this build; offer changes are not saved")
	}
	s.update("recover", func(st *State) {
		for id, o := range st.Offers() {
			if o.State() == "SENDING" {
				o["state"] = "UNKNOWN"
				s.logf("%s: offer %s was SENDING at start and is now UNKNOWN", o.Label(), short(id))
			}
			if o.Org() != "" || o.Kind() == "test" || (o.State() != "OFFERED" && o.State() != "UNKNOWN") {
				continue
			}
			if acct, err := s.loadAuth(o.AuthFile()); err == nil {
				o["org"] = acct.Org
				s.logf("%s: offer %s bound to the organization its auth file holds now", o.Label(), short(id))
			}
		}
	})
}

// ExpireOffered marks open offers past their expiry EXPIRED, at the start of each cycle.
func (s *Service) ExpireOffered(now time.Time) {
	s.update("expire", func(st *State) {
		for _, o := range st.Offers() {
			if exp, ok := o.ExpiresAt(); o.State() == "OFFERED" && ok && !exp.After(now) {
				o["state"] = "EXPIRED"
			}
		}
	})
}

// Observe acts on one account's successful usage read: it settles lost claims, sends schema alerts and
// sends new offers. It reports false when the body is not a JSON object, which counts as a failed read.
func (s *Service) Observe(ctx context.Context, acct gateway.Account, body []byte, now time.Time) bool {
	usage, err := ParseUsage(body)
	if _, ok := usage.(map[string]any); err != nil || !ok {
		s.logf("%s: status read failed: status body is not an object", acct.Label)
		return false
	}
	s.update("stale", func(st *State) { delete(st.Stale(), acct.Label) })
	s.reconcile(ctx, acct, usage)
	cands, problems := Decide(acct.Label, usage, now, s.cfg.Rules)
	for _, p := range problems {
		s.sendOnce(ctx, "problem|"+p, "Claude reset: schema changed", p)
	}
	for _, c := range cands {
		s.offer(ctx, acct, c, now)
	}
	return true
}

// TokenStale records an account whose token is expired or rejected, and alerts once it has been so for
// longer than StaleTokenAlertHours.
func (s *Service) TokenStale(ctx context.Context, acct gateway.Account, now time.Time) {
	first := isoformat(now)
	s.update("stale", func(st *State) {
		m := st.Stale()
		if v, ok := m[acct.Label].(string); ok {
			first = v
		} else {
			m[acct.Label] = first
		}
	})
	if t, ok := parseTime(first); ok && now.Sub(t) > time.Duration(s.cfg.StaleTokenAlertHours)*time.Hour {
		s.sendOnce(ctx, fmt.Sprintf("stale|%s|%s", acct.Label, first), "Claude reset: token not refreshed",
			fmt.Sprintf("%s: the token is expired or rejected for over %d h.", acct.Label, s.cfg.StaleTokenAlertHours))
	}
}

func (s *Service) sendOnce(ctx context.Context, key, title, body string) {
	st, err := s.store.Read()
	if err != nil {
		s.logf("alert skipped: %v", err)
		return
	}
	if _, sent := st.Sent()[key]; sent {
		return
	}
	if s.send.Bark(ctx, title, body, "") && s.update("sent", func(st *State) { st.Sent()[key] = isoformat(s.now()) }) {
		s.logf("alert sent: %s", title)
	}
}

func (s *Service) offer(ctx context.Context, acct gateway.Account, c Candidate, now time.Time) {
	st, err := s.store.Read()
	if err != nil {
		s.logf("%s: offer skipped: %v", acct.Label, err)
		return
	}
	if _, done := used(st, acct, filepath.Join(s.cfg.AuthDir, acct.Name), c); done {
		return
	}
	token := NewToken()
	oid := OfferID(token)
	if !s.send.Bark(ctx, c.Title, c.Body, s.cfg.PublicBase+"/offer/"+token) {
		s.logf("%s: bark failed for %s; retry next cycle", acct.Label, c.GrantID)
		return
	}
	if s.update("offer", func(st *State) {
		st.Sent()[c.Key] = isoformat(now)
		st.AddOffer(oid, c.record(filepath.Join(s.cfg.AuthDir, acct.Name), acct, now))
	}) {
		s.logf("%s: offer %s sent for %s (%s)", acct.Label, short(oid), c.GrantID, c.Kind)
	}
}

// used reports whether candidate c was already acted on for this account, and names the settled offer that did,
// when there is one. It was when its alert was sent; when a settled offer for the account has its dedupe key,
// apart from the email the key starts with; or, for an expiry reminder, when a claim on the grant went through
// after the reminder's threshold began. A new offer needs eligibility that came later.
func used(st *State, acct gateway.Account, authFile string, c Candidate) (string, bool) {
	_, sent := st.Sent()[c.Key]
	pick, at := "", time.Time{}
	for id, o := range st.Offers() {
		if !o.isFor(acct, authFile) || o.State() == "OFFERED" || o.State() == "UNKNOWN" || o.State() == "SENDING" {
			continue
		}
		done, _ := parseTime(asObject(o["after"])["at"])
		sameKey := keyTail(o.str("key")) != "" && keyTail(o.str("key")) == keyTail(c.Key)
		claimedSince := c.Kind == "expiring" && o.State() == "DONE" && o.GrantID() == c.GrantID && !done.Before(c.since)
		if (sameKey || claimedSince) && (pick == "" || done.After(at)) {
			pick, at = id, done
		}
	}
	return pick, sent || pick != ""
}

// keyTail is a dedupe key without the email it starts with.
func keyTail(key string) string {
	_, tail, _ := strings.Cut(key, "|")
	return tail
}

// reconcile settles claims whose reply was lost, from a read-only status read.
func (s *Service) reconcile(ctx context.Context, acct gateway.Account, usage any) {
	st, err := s.store.Read()
	if err != nil {
		return
	}
	path := filepath.Join(s.cfg.AuthDir, acct.Name)
	for _, oid := range slices.Sorted(maps.Keys(st.Offers())) {
		o := st.Offers()[oid]
		if o.State() == "UNKNOWN" && o.isFor(acct, path) && wentThrough(o, usage) {
			s.finish(ctx, oid, "reset", usage, "confirmed by a status read after a lost response", nil)
		}
	}
}

// wentThrough is true only when the grant is still listed and its count dropped since the snapshot. Used
// grants stay listed with resets_left 0, so a missing grant proves nothing, and a falling percent can be the
// window's own reset.
func wentThrough(o Offer, usage any) bool {
	before, okB := isInt(o.snapshot()["resets_left"])
	left, okL := isInt(resetsLeft(usage, o.GrantID()))
	return okB && okL && left < before
}

// finish records a final claim result, expires sibling offers, runs the after-reset steps and sends the
// after email.
func (s *Service) finish(ctx context.Context, oid, result string, after any, note string, raw map[string]any) {
	var o Offer
	s.update("finish", func(st *State) {
		cur := st.Offers()[oid]
		var left, pct any
		if after != nil {
			left, pct = resetsLeft(after, cur.GrantID()), windowPct(after, cur.GrantID(), cur.Window())
		}
		if result == "reset" {
			cur["state"] = "DONE"
			before, okB := 0, true
			if v, has := cur.snapshot()["resets_left"]; has {
				before, okB = isInt(v)
			}
			l, okL := isInt(left)
			p, okP := isInt(pct)
			cur["verified"] = okB && okL && l == before-1 && okP && p < 10
			cleared := cur.Clears()
			for id, other := range st.Offers() {
				if id != oid && other.State() == "OFFERED" && other.sameAccount(cur) &&
					(other.GrantID() == cur.GrantID() || slices.ContainsFunc(other.Clears(), func(w string) bool { return slices.Contains(cleared, w) })) {
					other["state"] = "EXPIRED"
				}
			}
		} else {
			cur["state"] = "CLOSED"
		}
		cur["result"] = result
		cur["after"] = map[string]any{"resets_left": left, "pct": pct, "at": isoformat(s.now())}
		if raw != nil {
			cur["response"] = raw
		}
		o = maps.Clone(cur)
	})
	if result == "reset" {
		line := s.hooks.AfterReset(ctx, gateway.Account{Name: filepath.Base(o.AuthFile()), Label: o.Label()}, after)
		o["gateway"] = line
		s.update("gateway", func(st *State) { st.Offers()[oid]["gateway"] = line })
		s.logf("%s: offer %s %s", o.Label(), short(oid), line)
	}
	snap := o.snapshot()
	a, _ := o["after"].(map[string]any)
	verified, has := o["verified"]
	if !has {
		verified = false
	}
	gw, _ := o["gateway"].(string)
	text := fmt.Sprintf("After: claim result %s for grant %s on %s.\nResets left: %s -> %s\n%s used: %s%% -> %s%%\nVerified: %s\n%s\n%s\nrequest_id: %s\n",
		result, o.GrantID(), o.Label(), strPy(snap["resets_left"]), strPy(a["resets_left"]), o.Window(), strPy(snap["pct"]),
		strPy(a["pct"]), strPy(verified), gw, note, strPy(o["request_id"]))
	s.tell(ctx, fmt.Sprintf("Claude reset: %s for %s on %s", result, o.GrantID(), o.Label()), text)
	s.logf("%s: offer %s finished: %s, verified=%s", o.Label(), short(oid), result, strPy(o["verified"]))
}

// tell emails the user, and falls back to Bark when the email fails.
func (s *Service) tell(ctx context.Context, subject, text string) {
	if !s.send.Email(ctx, subject, text) {
		s.send.Bark(ctx, subject, text, "")
	}
}
