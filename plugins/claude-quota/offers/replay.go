package offers

import (
	"fmt"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/rules"
)

// DefaultRules are the Python service's defaults: threshold 90%, 24 h to the natural reset, expiry alerts at
// 7 days and 24 hours.
var DefaultRules = Rules{ThresholdPct: 90, MinResetHours: 24, ExpiryAlertHours: []int{168, 24}}

// Replay runs the alert and routing rules over saved usage reads and returns the lines the Python service's
// `claude_reset.py replay` printed for them, so both can be compared line for line.
func Replay(labels []string, bodies [][]byte, now time.Time) ([]string, error) {
	var out []string
	limits := map[string]rules.Limits{}
	var routed []string
	raw := map[string][2]any{}
	for i, label := range labels {
		usage, err := ParseUsage(bodies[i])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", label, err)
		}
		cands, problems := Decide(label, usage, now, DefaultRules)
		n := len(out)
		for _, c := range cands {
			f := c.pythonFields()
			out = append(out, fmt.Sprintf("%s: %s %s %s %s", label, c.Kind, c.GrantID, c.Window, strPy(f["pct"])))
		}
		for _, p := range problems {
			out = append(out, fmt.Sprintf("%s: problem %s", label, p))
		}
		if len(out) == n {
			out = append(out, label+": none")
		}
		if lim, ok := rules.ReadLimits(bodies[i]); ok {
			limits[label] = lim
			routed = append(routed, label)
			u := asObject(usage)
			raw[label] = [2]any{findLimit(u, "weekly_all", nil)["percent"], findLimit(u, "weekly_scoped", "Fable")["percent"]}
		}
	}
	plan := rules.Plan(limits)
	for _, label := range routed {
		want, verb := plan[label], "routing unchanged"
		if rules.Changed(nil, want) {
			verb = "WOULD ROUTE"
		}
		var w any
		if want != nil {
			w = want
		}
		out = append(out, fmt.Sprintf("%s: %s weekly=%s%% fable=%s%% excluded_models None -> %s", label, verb, strPy(raw[label][0]), strPy(raw[label][1]), reprPy(w)))
	}
	return out, nil
}
