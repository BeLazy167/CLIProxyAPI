package offers

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"path/filepath"
	"slices"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Result is one tap's answer: the HTTP status and the message the page or panel shows.
type Result struct {
	Code    int
	Message string
}

func (s *Service) readStatus(ctx context.Context, acct gateway.Account) (any, error) {
	body, err := s.hooks.ReadUsage(ctx, acct)
	if err != nil {
		return nil, err
	}
	usage, err := ParseUsage(body)
	if _, ok := usage.(map[string]any); err != nil || !ok {
		return nil, fmt.Errorf("status body is not an object")
	}
	return usage, nil
}

func (s *Service) set(oid string, fields map[string]any) bool {
	return s.update("claim", func(st *State) { maps.Copy(st.Offers()[oid], fields) })
}

// Claim runs one tap on one offer: the guards, the before email, the claim and the after steps. The page and
// the panel both end here, on the engine goroutine, so taps never overlap.
func (s *Service) Claim(ctx context.Context, oid string) Result {
	if Mode == "shadow" {
		return Result{http.StatusServiceUnavailable, "This plugin build cannot claim (shadow mode). Nothing was claimed."}
	}
	now := s.now()
	st, err := s.store.Read()
	if err != nil {
		return Result{http.StatusInternalServerError, "Could not read the offer state. Nothing was claimed."}
	}
	offers := st.Offers()
	o, ok := offers[oid]
	switch {
	case !ok:
		return Result{http.StatusNotFound, "Unknown offer."}
	case o.Kind() == "test":
		return Result{http.StatusOK, "Test offer: the page works. Nothing was claimed."}
	case o.State() != "OFFERED" && o.State() != "UNKNOWN":
		return Result{http.StatusConflict, fmt.Sprintf("This offer is %s. Nothing was claimed.", strings.ToLower(o.State()))}
	}
	if exp, ok := o.ExpiresAt(); !ok || !exp.After(now) {
		if o.State() == "OFFERED" {
			s.set(oid, map[string]any{"state": "EXPIRED"})
		}
		return Result{http.StatusGone, "This offer expired. Nothing was claimed."}
	}
	for id, x := range offers {
		if id != oid && x.Label() == o.Label() && (x.State() == "SENDING" || x.State() == "UNKNOWN") {
			return Result{http.StatusConflict, "An earlier claim on this account has an unknown outcome. Nothing was claimed. " +
				"Wait for the next check, or open that earlier offer."}
		}
	}
	if cd, ok := parseTime(o["cooldown_until"]); ok && cd.After(now) {
		return Result{http.StatusConflict, fmt.Sprintf("Claude asked to wait until %s UTC. Nothing was claimed.", strftime(cd))}
	}
	acct, err := s.loadAuth(o.AuthFile())
	switch {
	case err != nil:
		return Result{http.StatusInternalServerError, "Could not read the account file. Nothing was claimed."}
	case acct.Disabled:
		return Result{http.StatusConflict, "This account is disabled in the gateway. Nothing was claimed."}
	case o.Org() != "" && acct.Org != o.Org():
		return Result{http.StatusConflict, fmt.Sprintf("The auth file for %s now holds another Claude organization than when this offer was made. Nothing was claimed.", o.Label())}
	case !acct.TokenFresh(now):
		return Result{http.StatusServiceUnavailable, "The gateway is refreshing this account's token. Try again in a few minutes."}
	}
	usage, err := s.readStatus(ctx, acct)
	if err != nil {
		return Result{http.StatusBadGateway, fmt.Sprintf("Could not read the grant status (%v). Nothing was claimed.", err)}
	}
	if o.State() == "UNKNOWN" && wentThrough(o, usage) {
		s.finish(ctx, oid, "reset", usage, "confirmed by a status read after a lost response", nil)
		return Result{http.StatusOK, "The earlier claim went through. Nothing more was sent."}
	}
	if ok, why := StillValid(o, usage, now, s.cfg.Rules); !ok {
		return Result{http.StatusOK, fmt.Sprintf("Not claimed: this reset is no longer worth using, because %s.", why)}
	}
	// A retry of an UNKNOWN claim re-sends the request decided earlier; a new attempt must still be the
	// narrowest grant for its window, and is refused rather than swapped when it is not.
	if o.Kind() == "near_limit" && o.State() == "OFFERED" {
		if other, found := NarrowerGrant(o, usage, now, s.cfg.Rules); found {
			return Result{http.StatusConflict, fmt.Sprintf("Not claimed: grant %s now clears the %s limit with fewer windows, so %s would waste a wider reset. "+
				"Claim %s from its own alert or the quota panel.", other, windowName(o.Window()), o.GrantID(), other)}
		}
	}
	if o.State() == "OFFERED" {
		o["request_id"] = newRequestID()
		o["snapshot"] = map[string]any{"resets_left": resetsLeft(usage, o.GrantID()), "pct": windowPct(usage, o.GrantID(), o.Window())}
	}
	snap := o.snapshot()
	if !s.send.Email(ctx, fmt.Sprintf("Claude reset: about to claim %s on %s", o.GrantID(), o.Label()),
		fmt.Sprintf("Before: claiming reset grant %s on %s.\n%s used now: %s%%\nResets left now: %s\nrequest_id: %s\n",
			o.GrantID(), o.Label(), o.Window(), strPy(snap["pct"]), strPy(snap["resets_left"]), strPy(o["request_id"]))) {
		return Result{http.StatusBadGateway, "The before email could not be sent, so nothing was claimed. Try again."}
	}
	if !s.set(oid, map[string]any{"state": "SENDING", "request_id": o["request_id"], "snapshot": snap}) {
		return Result{http.StatusInternalServerError, "The claim could not be saved before sending, so nothing was claimed."}
	}
	s.logf("%s: offer %s claiming %s", o.Label(), short(oid), o.GrantID())
	rid, _ := o["request_id"].(string)
	reply := s.send.Claim(context.WithoutCancel(ctx), acct, o.GrantID(), rid)
	subject := func(what string) string {
		return fmt.Sprintf("Claude reset: %s for %s on %s", what, o.GrantID(), o.Label())
	}
	switch reply.Outcome {
	case OutcomeUnknown:
		s.set(oid, map[string]any{"state": "UNKNOWN"})
		msg := fmt.Sprintf("Claim outcome unknown (%s). The service checks the grant every cycle and marks it done "+
			"if the count dropped. Tap again later only if the page still shows it unclaimed.", reply.Reason)
		s.tell(ctx, subject("outcome unknown"), msg)
		s.logf("%s: offer %s outcome unknown: %s", o.Label(), short(oid), reply.Reason)
		return Result{http.StatusBadGateway, msg}
	case OutcomeRejected:
		s.set(oid, map[string]any{"state": "OFFERED"})
		s.tell(ctx, subject("refused"), fmt.Sprintf("After: Claude refused the claim (%s). Nothing was used.\n", reply.Reason))
		return Result{http.StatusBadGateway, fmt.Sprintf("Claude refused the request (%s). Nothing was claimed.", reply.Reason)}
	}
	result := reply.Body["result"].(string)
	if result == "cooldown" || result == "unavailable" {
		s.set(oid, map[string]any{"state": "OFFERED", "cooldown_until": reply.Body["cooldown_until"]})
		s.tell(ctx, subject(result), fmt.Sprintf("After: Claude answered %s. Nothing was used. cooldown_until: %s\n", result, strPy(reply.Body["cooldown_until"])))
		return Result{http.StatusOK, fmt.Sprintf("Claude answered %s. Nothing was used; you can try again later.", result)}
	}
	after, err := s.readStatus(ctx, acct)
	if err != nil {
		after = nil
	}
	s.finish(ctx, oid, result, after, "", reply.Body)
	final, err := s.store.Read()
	if err != nil || final.Offers()[oid] == nil {
		return Result{http.StatusOK, fmt.Sprintf("Claude answered %s. The result could not be read back from the state file.", result)}
	}
	f := final.Offers()[oid]
	if result == "reset" {
		a, _ := f["after"].(map[string]any)
		return Result{http.StatusOK, fmt.Sprintf("Reset claimed. Resets left: %s. Verified: %s. %s.", strPy(a["resets_left"]), strPy(f["verified"]), strPy(orEmpty(f["gateway"])))}
	}
	return Result{http.StatusOK, fmt.Sprintf("Claude answered %s. Nothing more will be sent for this offer.", result)}
}

func orEmpty(v any) any {
	if v == nil {
		return ""
	}
	return v
}

// PanelClaim claims grantID on the account in auth file name, for the quota panel. It goes through an offer,
// so the panel and the page share the request ID, the UNKNOWN state and every guard: an open offer for the
// grant is used (an UNKNOWN one first); otherwise an offer is made now from a fresh read, without an alert,
// only when the grant is what an alert would offer (the narrowest grant for a full window, or one about to
// expire). It returns the offer ID it used, or "" when none.
func (s *Service) PanelClaim(ctx context.Context, name, grantID string) (Result, string) {
	if Mode == "shadow" {
		return Result{http.StatusServiceUnavailable, "This plugin build cannot claim (shadow mode). Nothing was claimed."}, ""
	}
	acct, err := gateway.LoadAccount(s.cfg.AuthDir, name)
	if err != nil {
		return Result{http.StatusNotFound, "Could not read the account file. Nothing was claimed."}, ""
	}
	st, err := s.store.Read()
	if err != nil {
		return Result{http.StatusInternalServerError, "Could not read the offer state. Nothing was claimed."}, ""
	}
	rank := map[string]int{"UNKNOWN": 0, "SENDING": 0, "OFFERED": 2}
	pick, best := "", 0
	for _, id := range slices.Sorted(maps.Keys(st.Offers())) {
		o := st.Offers()[id]
		r, open := rank[o.State()]
		if !open || o.Label() != acct.Label || o.GrantID() != grantID || (o.Org() != "" && o.Org() != acct.Org) {
			continue
		}
		if o.Kind() != "near_limit" {
			r++
		}
		if pick == "" || r < best {
			pick, best = id, r
		}
	}
	if pick != "" {
		return s.Claim(ctx, pick), pick
	}
	if !acct.TokenFresh(s.now()) {
		return Result{http.StatusServiceUnavailable, "The gateway is refreshing this account's token. Try again in a few minutes."}, ""
	}
	usage, err := s.readStatus(ctx, acct)
	if err != nil {
		return Result{http.StatusBadGateway, fmt.Sprintf("Could not read the grant status (%v). Nothing was claimed.", err)}, ""
	}
	now := s.now()
	cands, _ := Decide(acct.Label, usage, now, s.cfg.Rules)
	var cand *Candidate
	for i := range cands {
		if cands[i].GrantID == grantID && (cand == nil || cands[i].Kind == "near_limit") {
			cand = &cands[i]
		}
	}
	if cand == nil {
		msg := fmt.Sprintf("Not claimed: grant %s is not worth using now. No window it clears is at %s%% with more than %d h to its own reset "+
			"for which it is the narrowest grant, and it does not expire within %d h.", grantID, reprFloat(s.cfg.Rules.ThresholdPct), s.cfg.Rules.MinResetHours,
			slices.Max(append([]int{0}, s.cfg.Rules.ExpiryAlertHours...)))
		last := lastSettled(st, acct.Label, grantID)
		if last != "" {
			msg += fmt.Sprintf(" Its last offer is %s (result %s).", st.Offers()[last].State(), strPy(st.Offers()[last]["result"]))
		}
		return Result{http.StatusOK, msg}, last
	}
	oid := OfferID(NewToken())
	if !s.update("panel offer", func(st *State) { st.AddOffer(oid, cand.record(filepath.Join(s.cfg.AuthDir, name), acct, now)) }) {
		return Result{http.StatusInternalServerError, "The offer could not be saved, so nothing was claimed."}, ""
	}
	s.logf("%s: offer %s made from the quota panel for %s (%s)", acct.Label, short(oid), grantID, cand.Kind)
	return s.Claim(ctx, oid), oid
}

// lastSettled is the account's most recently settled offer for a grant, so a panel tap that lost the race to
// the page can say the grant was just claimed.
func lastSettled(st *State, label, grantID string) string {
	pick, at := "", ""
	for id, o := range st.Offers() {
		a, _ := o["after"].(map[string]any)
		t, _ := a["at"].(string)
		if o.Label() == label && o.GrantID() == grantID && t != "" && (pick == "" || t > at) {
			pick, at = id, t
		}
	}
	return pick
}

// OfferState is the state an offer is in now, or "" when it is unknown.
func (s *Service) OfferState(oid string) string {
	st, err := s.store.Read()
	if err != nil || oid == "" {
		return ""
	}
	return st.Offers()[oid].State()
}
