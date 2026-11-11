package rules

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

var (
	fab = []string{"claude-fable-*"}
	res = []string{"claude-opus-*", "claude-sonnet-*"}
	now = time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
)

func usage(weekly, fable any) map[string]any {
	return map[string]any{
		"five_hour": nil,
		"limits": []any{
			map[string]any{"kind": "weekly_all", "percent": weekly, "resets_at": "2026-11-14T20:59:59.591303+00:00", "scope": nil},
			map[string]any{"kind": "weekly_scoped", "percent": fable, "resets_at": "2026-11-16T22:59:59.745160+00:00",
				"scope": map[string]any{"model": map[string]any{"display_name": "Fable", "id": nil}, "surface": nil}},
		},
	}
}

func body(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func pct(v float64) *float64 { return &v }

func lim(weekly, fable float64, five *float64) Limits {
	return Limits{Weekly: weekly, Fable: fable, FiveHour: five}
}

func TestReadLimitsUnreadable(t *testing.T) {
	noWeekly := usage(50, 0)
	noWeekly["limits"] = noWeekly["limits"].([]any)[1:]
	noFable := usage(50, 0)
	noFable["limits"] = noFable["limits"].([]any)[:1]
	scopedWeekly := usage(50, 0)
	scopedWeekly["limits"].([]any)[0].(map[string]any)["scope"] = map[string]any{"model": map[string]any{"display_name": "Opus"}}
	lowerFable := usage(50, 0)
	lowerFable["limits"].([]any)[1].(map[string]any)["scope"] = map[string]any{"model": map[string]any{"display_name": "fable"}}
	idFable := usage(50, 0)
	idFable["limits"].([]any)[1].(map[string]any)["scope"] = map[string]any{"model": map[string]any{"id": "Fable"}}

	cases := []struct {
		name string
		raw  []byte
	}{
		{"1 limits missing", []byte(`{}`)},
		{"1 limits not a list", []byte(`{"limits":"x"}`)},
		{"1 limits of non-objects", []byte(`{"limits":["x",1,null]}`)},
		{"2 no weekly_all", body(t, noWeekly)},
		{"2 no Fable entry", body(t, noFable)},
		{"3 bool percent", body(t, usage(true, 0))},
		{"3 string percent", body(t, usage("50", 0))},
		{"3 null percent", body(t, usage(nil, 0))},
		{"3 out of float range", []byte(strings.Replace(string(body(t, usage(1, 0))), `"percent":1,`, `"percent":1e400,`, 1))},
		{"21 array body", []byte(`[]`)},
		{"21 string body", []byte(`"x"`)},
		{"21 invalid JSON", []byte(`{"limits":`)},
		{"22 weekly_all scoped to a model is not the weekly limit", body(t, scopedWeekly)},
		{"23 lowercase fable", body(t, lowerFable)},
		{"23 Fable in id only", body(t, idFable)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got, ok := ReadLimits(c.raw); ok {
				t.Fatalf("want unreadable, got %+v", got)
			}
		})
	}
}

func TestReadLimitsReadable(t *testing.T) {
	firstWins := usage(50, 0)
	firstWins["limits"] = append(firstWins["limits"].([]any),
		map[string]any{"kind": "weekly_all", "percent": 99, "scope": nil},
		map[string]any{"kind": "weekly_scoped", "percent": 99, "scope": map[string]any{"model": map[string]any{"display_name": "Fable"}}})
	nullModel := usage(50, 0)
	nullModel["limits"].([]any)[0].(map[string]any)["scope"] = map[string]any{"model": nil}
	fiveDict := usage(50, 0)
	fiveDict["five_hour"] = map[string]any{"utilization": 100.0, "resets_at": "2026-11-11T15:00:00Z"}
	fiveNoUtil := usage(50, 0)
	fiveNoUtil["five_hour"] = map[string]any{"resets_at": "2026-11-11T15:00:00Z"}
	fiveString := usage(50, 0)
	fiveString["five_hour"] = "x"
	fiveNumber := usage(50, 0)
	fiveNumber["five_hour"] = 5
	fiveMissing := usage(50, 0)
	delete(fiveMissing, "five_hour")
	badResets := usage(50, 0)
	badResets["limits"].([]any)[0].(map[string]any)["resets_at"] = "soon"
	delete(badResets["limits"].([]any)[1].(map[string]any), "resets_at")

	cases := []struct {
		name string
		raw  []byte
		want Limits
	}{
		{"15 null five_hour reads as 0", body(t, usage(50, 0)), lim(50, 0, pct(0))},
		{"15 missing five_hour reads as 0", body(t, fiveMissing), lim(50, 0, pct(0))},
		{"15 five_hour utilization 100", body(t, fiveDict), lim(50, 0, pct(100))},
		{"15 five_hour without utilization is unreadable", body(t, fiveNoUtil), lim(50, 0, nil)},
		{"15 five_hour string is unreadable", body(t, fiveString), lim(50, 0, nil)},
		{"15 five_hour number is unreadable", body(t, fiveNumber), lim(50, 0, nil)},
		{"22 first matching entry wins", body(t, firstWins), lim(50, 0, pct(0))},
		{"22 scope with null model is account-wide", body(t, nullModel), lim(50, 0, pct(0))},
		{"24 whole and fractional percents", body(t, usage(54.0, 90.5)), lim(54, 90.5, pct(0))},
		{"25 bad resets_at still readable", body(t, badResets), lim(50, 0, pct(0))},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := ReadLimits(c.raw)
			if !ok {
				t.Fatal("want readable")
			}
			got.ResetsAt = nil
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %+v five=%v, want %+v five=%v", got, deref(got.FiveHour), c.want, deref(c.want.FiveHour))
			}
		})
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestReadLimitsResetTimes(t *testing.T) {
	u := usage(50, 0)
	u["five_hour"] = map[string]any{"utilization": 10, "resets_at": "2026-11-11T15:00:00.123456789Z"}
	got, ok := ReadLimits(body(t, u))
	if !ok {
		t.Fatal("want readable")
	}
	want := []time.Time{
		time.Date(2026, 11, 14, 20, 59, 59, 591303000, time.UTC),
		time.Date(2026, 11, 16, 22, 59, 59, 745160000, time.UTC),
		time.Date(2026, 11, 11, 15, 0, 0, 123456000, time.UTC),
	}
	if len(got.ResetsAt) != len(want) {
		t.Fatalf("got %v", got.ResetsAt)
	}
	for i := range want {
		if !got.ResetsAt[i].Equal(want[i]) {
			t.Fatalf("reset %d: got %v want %v", i, got.ResetsAt[i], want[i])
		}
	}
}

func TestFableOut(t *testing.T) {
	if !lim(0, 100, pct(0)).FableOut() || !lim(100, 0, pct(0)).FableOut() || lim(99.9, 99.9, pct(0)).FableOut() {
		t.Fatal("4: Fable 100 or weekly 100 is out, 99.9 is not")
	}
}

func TestPlan(t *testing.T) {
	ok := lim(50, 0, pct(0))
	cases := []struct {
		name   string
		limits map[string]Limits
		want   map[string][]string
	}{
		{"5 reserve at exactly 10% weekly left", map[string]Limits{"out": lim(90, 100, pct(0)), "x": ok}, map[string][]string{"out": fab, "x": res}},
		{"5 no reserve at 9.5% left", map[string]Limits{"out": lim(90.5, 100, pct(0)), "x": ok}, map[string][]string{"out": fab, "x": nil}},
		{"6 no Fable-out account with room", map[string]Limits{"a": lim(100, 0, pct(0)), "b": ok}, map[string][]string{"a": fab, "b": nil}},
		{"7 every account Fable-out", map[string]Limits{"a": lim(60, 100, pct(0)), "b": lim(100, 0, pct(0))}, map[string][]string{"a": fab, "b": fab}},
		{"8 single account", map[string]Limits{"a": ok}, map[string][]string{"a": nil}},
		{"19 fallback at five-hour 100 is no fallback", map[string]Limits{"out": lim(60, 100, pct(100)), "x": ok}, map[string][]string{"out": fab, "x": nil}},
		{"19 fallback with unreadable five-hour is no fallback", map[string]Limits{"out": lim(60, 100, nil), "x": ok}, map[string][]string{"out": fab, "x": nil}},
		{"19 fallback at five-hour 99.9 counts", map[string]Limits{"out": lim(60, 100, pct(99.9)), "x": ok}, map[string][]string{"out": fab, "x": res}},
		{"26 empty input", map[string]Limits{}, map[string][]string{}},
		{"27 weekly above 100 is out and has no room", map[string]Limits{"out": lim(150, 0, pct(0)), "x": ok}, map[string][]string{"out": fab, "x": nil}},
		{"27 negative weekly has room", map[string]Limits{"out": lim(-5, 100, pct(0)), "x": ok}, map[string][]string{"out": fab, "x": res}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Plan(c.limits)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v want %v", got, c.want)
			}
			for _, models := range got {
				for _, m := range models {
					if strings.Contains(m, "haiku") {
						t.Fatal("9: Haiku excluded")
					}
				}
			}
		})
	}
}

func TestChanged(t *testing.T) {
	cases := []struct {
		name      string
		cur, want []string
		changed   bool
	}{
		{"10 same set another order", []string{"claude-sonnet-*", "claude-opus-*"}, res, false},
		{"10 repeat is no change", []string{"claude-fable-*", "claude-fable-*"}, fab, false},
		{"10 empty list equals null", []string{}, nil, false},
		{"10 null to Fable", nil, fab, true},
		{"10 reserved to null", res, nil, true},
		{"10 Fable to reserved", fab, res, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Changed(c.cur, c.want); got != c.changed {
				t.Fatalf("got %v", got)
			}
		})
	}
}

func TestAddsReserved(t *testing.T) {
	cases := []struct {
		name      string
		cur, want []string
		adds      bool
	}{
		{"28 null to reserved adds", nil, res, true},
		{"28 Opus only to reserved adds Sonnet", []string{"claude-opus-*"}, res, true},
		{"28 Fable to reserved adds", fab, res, true},
		{"28 reserved kept is no add", res, []string{"claude-sonnet-*", "claude-opus-*"}, false},
		{"28 reserved to Fable removes", res, fab, false},
		{"28 reserved to null removes", res, nil, false},
		{"28 null to Fable adds no reservation", nil, fab, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := AddsReserved(c.cur, c.want); got != c.adds {
				t.Fatalf("got %v", got)
			}
		})
	}
}

func TestWithoutReserved(t *testing.T) {
	cases := []struct {
		name     string
		cur, out []string
	}{
		{"29 null stays null", nil, nil},
		{"29 reserved only becomes null", res, nil},
		{"29 Fable kept", []string{"claude-fable-*", "claude-opus-*", "claude-sonnet-*"}, fab},
		{"29 other entries kept in order", []string{"x-*", "claude-sonnet-*", "claude-fable-*"}, []string{"x-*", "claude-fable-*"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := WithoutReserved(c.cur); !reflect.DeepEqual(got, c.out) {
				t.Fatalf("got %#v want %#v", got, c.out)
			}
		})
	}
}

func cd(retry any, reason any, model any) map[string]any {
	c := map[string]any{"scope": "credential", "reason": reason, "retry_at": retry}
	if model != nil {
		c["scope"], c["model_key"] = "model", model
	}
	return c
}

func at(d time.Duration) string { return now.Add(d).Format(time.RFC3339Nano) }

func TestStaleCooldowns(t *testing.T) {
	ok := lim(50, 0, pct(0))
	future := at(5 * time.Hour)
	nano := now.Add(5*time.Hour).Format("2006-01-02T15:04:05") + ".001273778Z"
	offset := now.Add(5*time.Hour).In(time.FixedZone("", -6*3600)).Format("2006-01-02T15:04:05") + ".001273778-06:00"
	cases := []struct {
		name  string
		lim   Limits
		raw   any
		stale int
	}{
		{"12 past retry_at is not stale", ok, []any{cd(at(-time.Hour), "quota", nil)}, 0},
		{"13 nanoseconds with Z", ok, []any{cd(nano, "quota", nil)}, 1},
		{"13 nanoseconds with offset", ok, []any{cd(offset, "quota", nil)}, 1},
		{"14 weekly at 100 keeps", lim(100, 0, pct(0)), []any{cd(future, "quota", nil)}, 0},
		{"15 five-hour at 100 keeps", lim(50, 0, pct(100)), []any{cd(future, "quota", nil)}, 0},
		{"15 unreadable five-hour keeps", lim(50, 0, nil), []any{cd(future, "quota", nil)}, 0},
		{"16 Fable cooldown kept at Fable 100", lim(50, 100, pct(0)), []any{cd(future, "quota", "claude-fable-5-2")}, 0},
		{"16 Opus cooldown cleared at Fable 100", lim(50, 100, pct(0)), []any{cd(future, "quota", "claude-opus-5-5")}, 1},
		{"17 empty list", ok, []any{}, 0},
		{"17 null", ok, nil, 0},
		{"17 not a list", ok, "x", 0},
		{"18 non-quota reason keeps", ok, []any{cd(future, "unauthorized", nil)}, 0},
		{"20 one valid cooldown keeps all", ok, []any{cd(future, "quota", nil), cd(future, "unauthorized", nil)}, 0},
		{"20 Fable cooldown at Fable 100 keeps the quota one", lim(50, 100, pct(0)), []any{cd(future, "credential_quota", nil), cd(future, "quota", "claude-fable-5-2")}, 0},
		{"20 past non-quota does not count", ok, []any{cd(future, "credential_quota", nil), cd(at(-time.Hour), "unauthorized", nil)}, 1},
		{"30 entry not an object keeps all", ok, []any{cd(future, "quota", nil), "x"}, 0},
		{"30 missing retry_at keeps all", ok, []any{map[string]any{"reason": "quota"}}, 0},
		{"30 numeric retry_at keeps all", ok, []any{cd(5, "quota", nil)}, 0},
		{"30 naive retry_at keeps all", ok, []any{cd("2026-11-11T18:00:00", "quota", nil)}, 0},
		{"30 garbage retry_at keeps all", ok, []any{cd("soon", "quota", nil)}, 0},
		{"31 retry_at equal to now is past", ok, []any{cd(at(0), "quota", nil)}, 0},
		{"32 credential_quota counts", ok, []any{cd(future, "credential_quota", nil)}, 1},
		{"32 numeric reason keeps", ok, []any{cd(future, 5, nil)}, 0},
		{"32 null reason keeps", ok, []any{cd(future, nil, nil)}, 0},
		{"33 claude-fable without dash is not Fable", lim(50, 100, pct(0)), []any{cd(future, "quota", "claude-fable")}, 1},
		{"33 numeric model key is not Fable", lim(50, 100, pct(0)), []any{cd(future, "quota", 5)}, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw := body(t, c.raw)
			var decoded any
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			if got := StaleCooldowns(c.lim, ParseCooldowns(decoded), now); len(got) != c.stale {
				t.Fatalf("got %d stale, want %d: %+v", len(got), c.stale, got)
			}
		})
	}
}

func TestChanges(t *testing.T) {
	current := map[string][]string{"a": res, "b": fab, "c": nil, "d": nil}
	want := map[string][]string{"a": fab, "b": res, "c": nil, "d": res}
	got := Changes(current, want)
	names := make([]string, 0, len(got))
	for _, c := range got {
		names = append(names, c.Name)
	}
	if !reflect.DeepEqual(names, []string{"a", "b", "d"}) {
		t.Fatalf("freeing writes first, then reserving writes, each in name order, unchanged skipped: got %v", names)
	}
	if got[0].AddsReserved || !got[1].AddsReserved || !got[2].AddsReserved {
		t.Fatalf("adds flags wrong: %+v", got)
	}
}
