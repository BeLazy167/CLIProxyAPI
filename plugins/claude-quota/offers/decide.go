package offers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// FableWindow is the cedar_ember name of the Fable weekly window.
const FableWindow = "seven_day_overage_included"

// Rules are the alert thresholds; decide.py reads the same keys from its config.
type Rules struct {
	ThresholdPct     float64
	MinResetHours    int
	ExpiryAlertHours []int
}

// Candidate is one alert worth sending; Python's decide.Candidate.
type Candidate struct {
	Kind        string // "near_limit" or "expiring"
	Key         string // dedupe key, one alert per key
	GrantID     string
	Clears      []string
	Window      string
	WindowReset *string
	Pct         *int
	ExpiresAt   string // when an offer for this candidate stops being claimable
	Title       string
	Body        string
}

// ParseUsage decodes a usage body, keeping each number's int or float form as Python's json does.
func ParseUsage(body []byte) (any, error) {
	var v any
	if err := decodePy(body, &v); err != nil {
		return nil, err
	}
	return v, nil
}

// decodePy reads one JSON value into v, keeping each number's int or float form, and refuses anything but
// whitespace after it, as Python's json.loads does.
func decodePy(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("extra data after the JSON value")
	}
	return nil
}

func asObject(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// isInt is Python's isinstance(v, int) and not bool, for a JSON value or an int this code stored.
func isInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case json.Number:
		if strings.ContainsAny(string(n), ".eE") {
			return 0, false
		}
		i, err := strconv.Atoi(string(n))
		return i, err == nil
	}
	return 0, false
}

// isPct is decide.is_pct: a finite int or float, not a bool.
func isPct(v any) (float64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := strconv.ParseFloat(string(n), 64)
	return f, err == nil && !math.IsInf(f, 0) && !math.IsNaN(f)
}

func findLimit(usage map[string]any, kind string, model any) map[string]any {
	list, _ := usage["limits"].([]any)
	for _, item := range list {
		lim := asObject(item)
		if lim == nil || lim["kind"] != kind {
			continue
		}
		var name any
		if m := asObject(asObject(lim["scope"])["model"]); m != nil {
			name = m["display_name"]
		}
		if name == model {
			return lim
		}
	}
	return nil
}

// windowReset is the natural reset time of a window, or false when the window cannot be mapped.
func windowReset(usage map[string]any, window string) (time.Time, bool) {
	switch window {
	case FableWindow:
		if lim := findLimit(usage, "weekly_scoped", "Fable"); lim != nil {
			return parseTime(lim["resets_at"])
		}
	case "seven_day", "five_hour":
		if w := asObject(usage[window]); w != nil {
			return parseTime(w["resets_at"])
		}
	}
	return time.Time{}, false
}

func grants(usage map[string]any) []map[string]any {
	ce := asObject(usage["cedar_ember"])
	list, ok := ce["grants"].([]any)
	if ce == nil || ce["eligible"] != true || !ok {
		return nil
	}
	var out []map[string]any
	for _, g := range list {
		if m := asObject(g); m != nil {
			out = append(out, m)
		}
	}
	return out
}

func findGrant(usage map[string]any, id string) map[string]any {
	for _, g := range grants(usage) {
		if g["id"] == id {
			return g
		}
	}
	return nil
}

// wellFormed is true when every field the rules read has the expected type and every cleared window maps.
func wellFormed(usage, g map[string]any) bool {
	_, idOK := g["id"].(string)
	_, leftOK := isInt(g["resets_left"])
	_, usableOK := g["usable_now"].(bool)
	paused, hasPaused := g["paused"]
	_, pausedOK := paused.(bool)
	_, endsOK := parseTime(g["ends_at"])
	pct, pctOK := g["percent_used"].(map[string]any)
	clears, clearsOK := g["clears"].([]any)
	if !idOK || !leftOK || !usableOK || (hasPaused && !pausedOK) || !endsOK || !pctOK || !clearsOK || len(clears) == 0 {
		return false
	}
	for _, w := range clears {
		ws, ok := w.(string)
		if !ok {
			return false
		}
		if _, ok := windowReset(usage, ws); !ok {
			return false
		}
		if _, ok := isPct(pct[ws]); !ok {
			return false
		}
	}
	return true
}

func clearsOf(g map[string]any) []string {
	list, _ := g["clears"].([]any)
	out := make([]string, 0, len(list))
	for _, w := range list {
		s, _ := w.(string)
		out = append(out, s)
	}
	return out
}

// isLive is true when the grant has a reset left and is inside its start and end dates.
func isLive(g map[string]any, now time.Time) bool {
	left, ok := isInt(g["resets_left"])
	starts, hasStart := parseTime(g["starts_at"])
	ends, hasEnd := parseTime(g["ends_at"])
	return ok && left > 0 && !truthyPy(g["paused"]) && (!hasStart || !starts.After(now)) && hasEnd && now.Before(ends)
}

func truthyPy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f, _ := strconv.ParseFloat(string(x), 64)
		return f != 0
	case []any:
		return len(x) > 0
	case map[string]any:
		return len(x) > 0
	}
	return true
}

// windowOK checks the near-limit rule for one window of a well-formed grant: usable now, at the threshold,
// and more than MinResetHours from the natural reset. It also returns the percent cut to an int.
func windowOK(usage, g map[string]any, window string, now time.Time, r Rules) (bool, *int, time.Time) {
	reset, _ := windowReset(usage, window)
	pct, ok := isPct(asObject(g["percent_used"])[window])
	if !ok {
		return false, nil, reset
	}
	p := int(math.Trunc(pct))
	return truthyPy(g["usable_now"]) && pct >= r.ThresholdPct && reset.Sub(now) > time.Duration(r.MinResetHours)*time.Hour, &p, reset
}

// narrowKey orders grants for one window: fewer cleared windows first, then the earlier end.
type narrowKey struct {
	clears int
	ends   time.Time
}

func (a narrowKey) less(b narrowKey) bool {
	return a.clears < b.clears || (a.clears == b.clears && a.ends.Before(b.ends))
}

func keyOf(g map[string]any) narrowKey {
	ends, _ := parseTime(g["ends_at"])
	return narrowKey{len(clearsOf(g)), ends}
}

type nearPick struct {
	g     map[string]any
	pct   int
	reset time.Time
}

// Decide returns the candidates and the schema problems for one account's usage read, as decide.decide does.
// Dedupe is the caller's job.
func Decide(label string, usageV any, now time.Time, r Rules) ([]Candidate, []string) {
	usage := asObject(usageV)
	ce := asObject(usage["cedar_ember"])
	eligible, eligOK := ce["eligible"].(bool)
	if _, listOK := ce["grants"].([]any); ce == nil || !eligOK || (eligible && !listOK) {
		return nil, []string{label + ": usage response has no readable cedar_ember block"}
	}
	var out []Candidate
	var problems []string
	near := map[string]nearPick{}
	var order []string
	hours := append([]int(nil), r.ExpiryAlertHours...)
	sort.Ints(hours)
	for _, g := range grants(usage) {
		if !wellFormed(usage, g) {
			problems = append(problems, fmt.Sprintf("%s: grant %s has fields or windows the rules cannot read: clears=%s",
				label, reprPy(g["id"]), reprPy(g["clears"])))
			continue
		}
		if !isLive(g, now) {
			continue
		}
		gid, clears := g["id"].(string), clearsOf(g)
		ends, _ := parseTime(g["ends_at"])
		for _, w := range clears {
			ok, pct, reset := windowOK(usage, g, w, now, r)
			if !ok {
				continue
			}
			best, seen := near[w]
			if !seen {
				order = append(order, w)
			}
			// The grant that clears the fewest windows, then the one that ends first, so a Fable-only
			// limit never spends a grant that would also clear the weekly limit.
			if !seen || keyOf(g).less(keyOf(best.g)) {
				near[w] = nearPick{g, *pct, reset}
			}
		}
		for _, h := range hours { // only the nearest threshold that applies
			if ends.Sub(now) > time.Duration(h)*time.Hour {
				continue
			}
			blocked := ""
			if !truthyPy(g["usable_now"]) {
				blocked = " It is blocked right now."
			}
			label2, has := g["label"]
			if !has {
				label2 = ""
			}
			out = append(out, Candidate{
				Kind: "expiring", Key: fmt.Sprintf("%s|expiring-%dh|%s|%s", label, h, gid, g["ends_at"]), GrantID: gid,
				Clears: clears, Window: clears[0], ExpiresAt: isoformat(ends),
				Title: "Claude reset expires in " + human(ends.Sub(now)),
				Body: fmt.Sprintf("%s: grant %s (%s) expires %s UTC. Windows it clears: %s.%s", label, gid, strPy(label2),
					strftime(ends), WindowStatus(usage, g), blocked),
			})
			break
		}
	}
	for _, w := range order {
		p := near[w]
		ends, _ := parseTime(p.g["ends_at"])
		exp := p.reset.Add(-time.Duration(r.MinResetHours) * time.Hour)
		if ends.Before(exp) {
			exp = ends
		}
		reset, pct := isoformat(p.reset), p.pct
		gid := p.g["id"].(string)
		out = append(out, Candidate{
			Kind: "near_limit", Key: fmt.Sprintf("%s|near|%s|%s", label, w, isoformat(nearestHour(p.reset))), GrantID: gid,
			Clears: clearsOf(p.g), Window: w, WindowReset: &reset, Pct: &pct, ExpiresAt: isoformat(exp),
			Title: fmt.Sprintf("Claude %s limit %d%% used", windowName(w), pct),
			Body:  fmt.Sprintf("%s: tap to use reset %s. Normal reset in %s.", label, gid, human(p.reset.Sub(now))),
		})
	}
	return out, problems
}

// StillValid re-checks an offer against a live read right before a claim, as decide.still_valid does.
func StillValid(o Offer, usageV any, now time.Time, r Rules) (bool, string) {
	usage := asObject(usageV)
	g := findGrant(usage, o.GrantID())
	if g == nil || !wellFormed(usage, g) || !isLive(g, now) {
		return false, "the grant is gone, used up or no longer readable"
	}
	if !truthyPy(g["usable_now"]) {
		why := "blocked"
		if truthyPy(g["unavailable_reason"]) {
			why = strPy(g["unavailable_reason"])
		}
		return false, fmt.Sprintf("the grant is not usable now (%s)", why)
	}
	if o.Kind() == "near_limit" {
		if ok, pct, _ := windowOK(usage, g, o.Window(), now, r); !ok {
			var p any
			if pct != nil {
				p = *pct
			}
			return false, fmt.Sprintf("the %s limit is at %s%% or resets soon", windowName(o.Window()), strPy(p))
		}
	}
	return true, ""
}

// NarrowerGrant names a grant that is eligible for the offer's window now and clears fewer windows (or ends
// earlier) than the offer's grant: the grant decide would pick today. Ties keep the offer's grant.
func NarrowerGrant(o Offer, usageV any, now time.Time, r Rules) (string, bool) {
	usage := asObject(usageV)
	mine := findGrant(usage, o.GrantID())
	if mine == nil {
		return "", false
	}
	best, found := keyOf(mine), ""
	for _, g := range grants(usage) {
		if !wellFormed(usage, g) || !isLive(g, now) {
			continue
		}
		if ok, _, _ := windowOK(usage, g, o.Window(), now, r); ok && keyOf(g).less(best) {
			best, found = keyOf(g), g["id"].(string)
		}
	}
	return found, found != ""
}

// WindowStatus describes each window a well-formed grant clears, with its percent used and natural reset.
func WindowStatus(usage, g map[string]any) string {
	pct := asObject(g["percent_used"])
	var parts []string
	for _, w := range clearsOf(g) {
		p, _ := isPct(pct[w])
		reset, _ := windowReset(usage, w)
		parts = append(parts, fmt.Sprintf("%s %d%% used, resets %s UTC", windowName(w), int(math.Trunc(p)), strftime(reset)))
	}
	return strings.Join(parts, "; ")
}

// windowPct is the grant's percent used for a window, cut to an int, or nil.
func windowPct(usageV any, grantID, window string) any {
	g := findGrant(asObject(usageV), grantID)
	if p, ok := isPct(asObject(asObject(g)["percent_used"])[window]); ok {
		return int(math.Trunc(p))
	}
	return nil
}

// resetsLeft is the grant's resets_left, or nil when the grant is missing or unreadable.
func resetsLeft(usageV any, grantID string) any {
	g := findGrant(asObject(usageV), grantID)
	if n, ok := isInt(asObject(g)["resets_left"]); ok {
		return n
	}
	return nil
}

func windowName(w string) string {
	switch w {
	case "seven_day":
		return "weekly"
	case "five_hour":
		return "session"
	case FableWindow:
		return "Fable weekly"
	}
	return w
}

// nearestHour rounds in the time's own offset. Claude reports one reset as 11:59:59.888, 11:59:59.925 or
// 12:00:00.073 on different reads.
func nearestHour(t time.Time) time.Time {
	t = t.Add(30 * time.Minute)
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location())
}

func human(d time.Duration) string {
	h := int(math.Floor(d.Seconds() / 3600))
	if h >= 24 {
		return fmt.Sprintf("%d d %d h", h/24, h%24)
	}
	return fmt.Sprintf("%d h", h)
}

// pythonFields is the candidate as Python's Candidate.__dict__, for the parity test and the offer record.
func (c Candidate) pythonFields() map[string]any {
	var reset, pct any
	if c.WindowReset != nil {
		reset = *c.WindowReset
	}
	if c.Pct != nil {
		pct = *c.Pct
	}
	return map[string]any{"kind": c.Kind, "key": c.Key, "grant_id": c.GrantID, "clears": c.Clears, "window": c.Window,
		"window_reset": reset, "pct": pct, "expires_at": c.ExpiresAt, "title": c.Title, "body": c.Body}
}
