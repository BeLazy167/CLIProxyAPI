// Package rules holds the pure model-routing rules for the gateway's Claude accounts. No I/O.
//
// It ports routing.py from the Python claude-reset service. Input is the body of
// GET /api/oauth/usage?cedar_ember=1&skip_spend=1, one read per account. Output is each
// auth file's wanted excluded_models, and which gateway cooldowns that read proves stale.
package rules

import (
	"bytes"
	"encoding/json"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	Fable    = []string{"claude-fable-*"}
	Reserved = []string{"claude-opus-*", "claude-sonnet-*"}
)

const ReserveMinWeeklyLeft = 10

// Limits is one account's usage read, reduced to what routing needs.
type Limits struct {
	Weekly float64
	Fable  float64
	// FiveHour is nil when the window is unreadable, so no cooldown counts as stale.
	FiveHour *float64
	// ResetsAt lists the natural reset times the read reported, for the re-plan timer.
	ResetsAt []time.Time
}

// FableOut is true at a full Fable or weekly limit; Fable use also counts toward the weekly limit.
func (l Limits) FableOut() bool {
	return l.Fable >= 100 || l.Weekly >= 100
}

func (l Limits) isFallback() bool {
	return l.FableOut() && 100-l.Weekly >= ReserveMinWeeklyLeft && l.FiveHour != nil && *l.FiveHour < 100
}

// ReadLimits parses a usage body. It reports false when the weekly or Fable percent is missing or not a number.
func ReadLimits(body []byte) (Limits, bool) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var root any
	if dec.Decode(&root) != nil {
		return Limits{}, false
	}
	usage, ok := root.(map[string]any)
	if !ok {
		return Limits{}, false
	}
	weekly, fable := findLimit(usage, "weekly_all", nil), findLimit(usage, "weekly_scoped", "Fable")
	if weekly == nil || fable == nil {
		return Limits{}, false
	}
	w, okW := percent(weekly["percent"])
	f, okF := percent(fable["percent"])
	if !okW || !okF {
		return Limits{}, false
	}
	out := Limits{Weekly: w, Fable: f}
	resets := []any{weekly["resets_at"], fable["resets_at"]}
	switch fh := usage["five_hour"].(type) {
	case nil:
		out.FiveHour = new(float64)
	case map[string]any:
		if v, ok := percent(fh["utilization"]); ok {
			out.FiveHour = &v
		}
		resets = append(resets, fh["resets_at"])
	}
	for _, r := range resets {
		if t, ok := ParseTime(r); ok {
			out.ResetsAt = append(out.ResetsAt, t)
		}
	}
	return out, true
}

// findLimit returns the first limits[] entry of this kind whose scope model display name equals model
// (nil matches a missing or null display name).
func findLimit(usage map[string]any, kind string, model any) map[string]any {
	list, _ := usage["limits"].([]any)
	for _, item := range list {
		entry, ok := item.(map[string]any)
		if !ok || entry["kind"] != kind {
			continue
		}
		var name any
		if scope, ok := entry["scope"].(map[string]any); ok {
			if m, ok := scope["model"].(map[string]any); ok {
				name = m["display_name"]
			}
		}
		if name == model {
			return entry
		}
	}
	return nil
}

func percent(v any) (float64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := strconv.ParseFloat(string(n), 64)
	return f, err == nil
}

// ParseTime parses an RFC 3339 time with an offset; anything else is unreadable.
func ParseTime(v any) (time.Time, bool) {
	s, ok := v.(string)
	if !ok {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	return t, err == nil
}

// Plan maps each auth file name to its wanted excluded_models (nil clears it).
//
// Accounts that still have Fable keep it for Fable requests, but only while some account
// without Fable can serve Opus and Sonnet now, so they never lose every account.
func Plan(limits map[string]Limits) map[string][]string {
	reserve := false
	for _, l := range limits {
		reserve = reserve || l.isFallback()
	}
	out := make(map[string][]string, len(limits))
	for name, l := range limits {
		switch {
		case l.FableOut():
			out[name] = Fable
		case reserve:
			out[name] = Reserved
		default:
			out[name] = nil
		}
	}
	return out
}

// Changed compares two lists as sets; nil and empty are equal.
func Changed(current, wanted []string) bool {
	return !setEqual(current, wanted)
}

func setEqual(a, b []string) bool {
	for _, x := range a {
		if !slices.Contains(b, x) {
			return false
		}
	}
	for _, x := range b {
		if !slices.Contains(a, x) {
			return false
		}
	}
	return true
}

// AddsReserved is true when this change would newly exclude Opus or Sonnet.
func AddsReserved(current, wanted []string) bool {
	for _, r := range Reserved {
		if slices.Contains(wanted, r) && !slices.Contains(current, r) {
			return true
		}
	}
	return false
}

// WithoutReserved drops the Opus/Sonnet reservation and keeps every other entry, for fail-open.
func WithoutReserved(current []string) []string {
	var out []string
	for _, m := range current {
		if !slices.Contains(Reserved, m) {
			out = append(out, m)
		}
	}
	return out
}

// Change is one excluded_models write.
type Change struct {
	Name         string
	From, To     []string
	AddsReserved bool
}

// Changes lists the writes that move current to wanted: writes that free an account first, then
// writes that add the Opus/Sonnet reservation, each group in name order. Unchanged accounts are skipped.
func Changes(current, wanted map[string][]string) []Change {
	var out []Change
	for name, to := range wanted {
		from := current[name]
		if Changed(from, to) {
			out = append(out, Change{Name: name, From: from, To: to, AddsReserved: AddsReserved(from, to)})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].AddsReserved != out[j].AddsReserved {
			return !out[i].AddsReserved
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// Cooldown is one entry of a gateway credential's cooldowns list.
type Cooldown struct {
	// RetryAt is zero when retry_at is missing or unreadable, or the entry is not an object.
	RetryAt  time.Time
	Reason   string
	ModelKey string
}

// ParseCooldowns reads the cooldowns value of one GET /v8/management/credentials entry.
func ParseCooldowns(raw any) []Cooldown {
	list, _ := raw.([]any)
	out := make([]Cooldown, 0, len(list))
	for _, item := range list {
		var c Cooldown
		if entry, ok := item.(map[string]any); ok {
			c.RetryAt, _ = ParseTime(entry["retry_at"])
			c.Reason, _ = entry["reason"].(string)
			c.ModelKey, _ = entry["model_key"].(string)
		}
		out = append(out, c)
	}
	return out
}

// StaleCooldowns returns the credential's future cooldowns when this usage read proves every one of them stale.
//
// The gateway clears all of a credential's cooldowns at once, so one cooldown that may still be
// right (another reason, Fable at 100%, an unreadable entry) keeps them all.
func StaleCooldowns(l Limits, cooldowns []Cooldown, now time.Time) []Cooldown {
	if l.Weekly >= 100 || l.FiveHour == nil || *l.FiveHour >= 100 {
		return nil
	}
	var out []Cooldown
	for _, c := range cooldowns {
		if !c.RetryAt.IsZero() && !c.RetryAt.After(now) {
			continue
		}
		if c.RetryAt.IsZero() || !strings.Contains(c.Reason, "quota") ||
			(strings.HasPrefix(c.ModelKey, "claude-fable-") && l.Fable >= 100) {
			return nil
		}
		out = append(out, c)
	}
	return out
}
