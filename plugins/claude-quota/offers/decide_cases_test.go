package offers

import (
	"encoding/json"
	"time"
)

var caseNow = time.Date(2026, 11, 11, 14, 7, 31, 482113000, time.UTC)

func at(h float64) string {
	return isoformat(caseNow.Add(time.Duration(h * float64(time.Hour))))
}

func grantCase(id string, clears []string, pct any, mods map[string]any) map[string]any {
	pu := map[string]any{}
	for _, w := range clears {
		pu[w] = pct
	}
	cl := make([]any, len(clears))
	for i, w := range clears {
		cl[i] = w
	}
	g := map[string]any{"id": id, "label": id, "resets_total": 1, "resets_left": 1, "starts_at": at(-24), "ends_at": at(24 * 90),
		"clears": cl, "paused": false, "usable_now": true, "use_requires_limit": false, "percent_used": pu, "blocking": []any{},
		"type": "full", "unavailable_reason": nil, "gives_back_weekly": true}
	for k, v := range mods {
		g[k] = v
	}
	return g
}

func usageCase(grants []any, seven, fable any, reset string) map[string]any {
	return map[string]any{
		"five_hour": nil,
		"seven_day": map[string]any{"utilization": seven, "resets_at": reset},
		"limits": []any{
			map[string]any{"kind": "weekly_all", "percent": seven, "resets_at": reset, "scope": nil},
			map[string]any{"kind": "weekly_scoped", "percent": fable, "resets_at": reset,
				"scope": map[string]any{"model": map[string]any{"id": nil, "display_name": "Fable"}, "surface": nil}},
		},
		"cedar_ember": map[string]any{"eligible": true, "ineligible_reason": nil, "grants": grants},
	}
}

func syntheticCases() []decideCase {
	fw := "seven_day_overage_included"
	r72 := at(72)
	jitter := caseNow.Add(72 * time.Hour).Truncate(time.Hour).Add(-111498 * time.Microsecond).In(time.FixedZone("", -6*3600))
	wide := grantCase("full-reset", []string{"seven_day", fw}, 100, map[string]any{"ends_at": at(24 * 30)})
	wide["percent_used"] = map[string]any{"seven_day": 64, fw: 100}
	expiring := grantCase("g1", []string{"seven_day", fw}, 0, map[string]any{"ends_at": at(20)})
	expiring["percent_used"] = map[string]any{"seven_day": 40, fw: 12}
	emptyPct := grantCase("nopct", []string{fw}, 99, map[string]any{"ends_at": at(20)})
	emptyPct["percent_used"] = map[string]any{}
	noElig := usageCase([]any{grantCase("g", []string{fw}, 99, nil)}, 99, 99, r72)
	delete(noElig["cedar_ember"].(map[string]any), "eligible")
	noBlock := usageCase(nil, 40, 99, r72)
	delete(noBlock, "cedar_ember")
	badWindow := usageCase([]any{grantCase("g", []string{"seven_day"}, 99, nil)}, 99, 99, r72)
	badWindow["seven_day"] = "unreadable"
	stringElig := usageCase([]any{grantCase("g1", []string{fw}, 95, nil)}, 40, 95, r72)
	stringElig["cedar_ember"].(map[string]any)["eligible"] = "false"
	ints := []decideCase{
		{"near", "", usageCase([]any{grantCase("g1", []string{fw}, 95, nil)}, 40, 95, r72)},
		{"low", "", usageCase([]any{grantCase("g1", []string{fw}, 80, nil)}, 40, 80, r72)},
		{"soon", "", usageCase([]any{grantCase("g1", []string{fw}, 99, nil)}, 40, 99, at(6))},
		{"day", "", usageCase([]any{grantCase("g1", []string{fw}, 99, nil)}, 40, 99, at(20))},
		{"blocked", "", usageCase([]any{grantCase("g1", []string{fw}, 99, map[string]any{"usable_now": false, "unavailable_reason": "blocked_seven_day"})}, 40, 99, r72)},
		{"notstarted", "", usageCase([]any{grantCase("g1", []string{fw}, 99, map[string]any{"starts_at": at(5)})}, 40, 99, r72)},
		{"used", "", usageCase([]any{grantCase("g1", []string{fw}, 99, map[string]any{"resets_left": 0})}, 40, 99, r72)},
		{"two", "", usageCase([]any{grantCase("late", []string{fw}, 95, map[string]any{"ends_at": at(24 * 100)}),
			grantCase("early", []string{fw}, 95, map[string]any{"ends_at": at(24 * 30)})}, 40, 95, r72)},
		{"narrow", "", usageCase([]any{wide, grantCase("fable-only", []string{fw}, 100, map[string]any{"ends_at": at(24 * 120)})}, 64, 100, r72)},
		{"wideonly", "", usageCase([]any{wide}, 64, 100, r72)},
		{"e7", "", usageCase([]any{grantCase("g7", []string{fw}, 5, map[string]any{"ends_at": at(24 * 5)})}, 40, 5, r72)},
		{"e1", "", usageCase([]any{grantCase("g1", []string{fw}, 5, map[string]any{"ends_at": at(20)})}, 40, 5, r72)},
		{"expwin", "", usageCase([]any{expiring}, 40, 12, isoformat(caseNow.Add(72*time.Hour).Truncate(time.Hour)))},
		{"siblings", "", usageCase([]any{grantCase("g1", []string{fw}, 95, map[string]any{"resets_left": 2, "ends_at": at(20)})}, 40, 95, r72)},
		{"multi", "", usageCase([]any{grantCase("g1", []string{"seven_day", fw}, 95, map[string]any{"resets_left": 2})}, 95, 95, r72)},
		{"jitter", "", usageCase([]any{grantCase("g1", []string{fw}, 95.5, nil)}, 40, 95, isoformat(jitter))},
		{"odd", "", usageCase([]any{grantCase("odd", []string{"five_hour_weird_window"}, 99, map[string]any{"ends_at": at(20)})}, 40, 99, r72)},
		{"noblock", "", noBlock},
		{"nopct", "", usageCase([]any{emptyPct}, 40, 99, r72)},
		{"strbool", "", usageCase([]any{grantCase("strbool", []string{fw}, 99, map[string]any{"ends_at": at(20), "usable_now": "false"})}, 40, 99, r72)},
		{"noelig", "", noElig},
		{"badwin", "", badWindow},
		{"boolpct", "", usageCase([]any{grantCase("boolpct", []string{fw}, true, map[string]any{"ends_at": at(20)})}, 40, 99, r72)},
		{"bigpct", "", usageCase([]any{grantCase("bigpct", []string{fw}, json.Number("1e400"), map[string]any{"ends_at": at(20)})}, 40, 99, r72)},
		{"floatleft", "", usageCase([]any{grantCase("fl", []string{fw}, 99, map[string]any{"resets_left": json.Number("1.0")})}, 40, 99, r72)},
		{"nullid", "", usageCase([]any{grantCase("x", []string{fw}, 99, map[string]any{"id": nil, "label": nil})}, 40, 99, r72)},
		{"stringelig", "", stringElig},
		{"fivehour", "", usageCase([]any{grantCase("s", []string{"five_hour"}, 97, nil)}, 40, 0, r72)},
		{"offset", "", usageCase([]any{grantCase("g1", []string{"seven_day"}, 92, map[string]any{"ends_at": "2026-12-01T00:00:00-06:00"})}, 92, 0, "2026-11-15T03:30:00.5+05:30")},
	}
	ints[len(ints)-3].Usage.(map[string]any)["five_hour"] = map[string]any{"utilization": 97.0, "resets_at": at(30)}
	for i := range ints {
		ints[i].Now = isoformat(caseNow)
	}
	return ints
}
