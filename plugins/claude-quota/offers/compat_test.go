package offers

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// reference is the Python service's own code (store.py, decide.py), kept beside the moved e2e.
var reference, _ = filepath.Abs("../test/claim/reference")

// python runs a script with the reference modules importable and returns its stdout.
func python(t *testing.T, script string, args ...string) []byte {
	t.Helper()
	cmd := exec.Command("python3", append([]string{"-I", "-B", "-c", "import sys; sys.path.insert(0, sys.argv[1]); del sys.argv[1]\n" + script, reference}, args...)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("python: %v\n%s", err, stderr.String())
	}
	return out
}

// pythonResave loads path with store.py and saves it again, as every Python transaction does.
func pythonResave(t *testing.T, path string) []byte {
	t.Helper()
	python(t, "from store import Store\ns = Store(sys.argv[1])\nwith s.tx():\n    pass\n", path)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	raw, err := os.ReadFile(from)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

// Failure 41: a Python-written file read and written back by the plugin must keep every byte, and a file the
// plugin changed must be one Python writes back unchanged.
func TestStateRoundTripWithPython(t *testing.T) {
	dir := t.TempDir()
	pyPath := filepath.Join(dir, "python", "state.json")
	copyFile(t, "testdata/state-schema.json", pyPath)
	pyBytes := pythonResave(t, pyPath)

	doc, err := decodeState(pyBytes)
	if err != nil {
		t.Fatal(err)
	}
	if got := encodeState(doc); !bytes.Equal(got, pyBytes) {
		t.Fatalf("Go rewrote a Python file with other bytes\n--- python\n%s\n--- go\n%s", pyBytes, got)
	}

	st := &State{doc: doc}
	now := time.Date(2026, 11, 11, 14, 0, 0, 123456000, time.UTC)
	acct := gateway.Account{Name: "claude-0003-acct-e@example.com.json", Label: "acct-é@example.com", Org: "org-e"}
	reset := time.Date(2026, 11, 14, 11, 59, 59, 888000000, time.FixedZone("", -6*3600))
	pct := 96
	wr := isoformat(reset)
	c := Candidate{Kind: "near_limit", Key: "acct-é@example.com|near|seven_day|" + isoformat(nearestHour(reset)), GrantID: "g9",
		Clears: []string{"seven_day"}, Window: "seven_day", WindowReset: &wr, Pct: &pct, ExpiresAt: isoformat(reset.Add(-24 * time.Hour)),
		Title: "Claude weekly limit 96% used", Body: "x"}
	oid := OfferID(NewToken())
	st.AddOffer(oid, c.record(filepath.Join("/home/user/.cli-proxy-api", acct.Name), acct, now))
	st.Sent()[c.Key] = isoformat(now)
	o := st.Offers()[oid]
	o["state"], o["request_id"] = "SENDING", "00112233445566778899aabbccddeeff"
	o["snapshot"] = map[string]any{"resets_left": 2, "pct": 96}
	o["after"] = map[string]any{"resets_left": json.Number("1"), "pct": nil, "at": isoformat(now)}
	o["response"] = map[string]any{"result": "reset", "x": 2.5, "y": 1e-7, "z": json.Number("3.0")}
	goBytes := encodeState(st.doc)

	goPath := filepath.Join(dir, "go", "state.json")
	if err := os.MkdirAll(filepath.Dir(goPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(goPath, goBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if back := pythonResave(t, goPath); !bytes.Equal(back, goBytes) {
		t.Fatalf("Python rewrote the plugin's file with other bytes\n--- go\n%s\n--- python\n%s", goBytes, back)
	}
	times := python(t, `import json, decide
s = json.load(open(sys.argv[1]))
o = s["offers"][sys.argv[2]]
bad = [t for t in [o["created_at"], o["expires_at"], o["window_reset"], o["after"]["at"]] + list(s["sent"].values()) if decide.parse_time(t) is None]
print(json.dumps(bad))`, goPath, oid)
	if string(bytes.TrimSpace(times)) != "[]" {
		t.Fatalf("Python cannot parse these times the plugin wrote: %s", times)
	}
}

// Failure 42: old links and open pages keep working because the offer ID and nonce match Python's.
func TestOfferIDAndNonceMatchPython(t *testing.T) {
	key := "5f2b8c0e9d1a4b7c6e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d"
	tokens := []string{NewToken(), NewToken(), "abcdefghijklmnopqrst_-0123456789ABCDEFGHIJK"}
	for _, tok := range tokens {
		if len(tok) != 43 {
			t.Fatalf("token %q is not the 43 characters of token_urlsafe(32)", tok)
		}
	}
	args := append([]string{key}, tokens...)
	out := python(t, `import hashlib, hmac, json
key = sys.argv[1]
res = []
for tok in sys.argv[2:]:
    oid = hashlib.sha256(tok.encode()).hexdigest()
    res.append([oid, hmac.new(bytes.fromhex(key), oid.encode(), "sha256").hexdigest()[:32]])
print(json.dumps(res))`, args...)
	var want [][2]string
	if err := json.Unmarshal(out, &want); err != nil {
		t.Fatal(err)
	}
	for i, tok := range tokens {
		oid := OfferID(tok)
		if oid != want[i][0] || Nonce(key, oid) != want[i][1] {
			t.Fatalf("token %d: Go (%s, %s) Python %v", i, oid, Nonce(key, oid), want[i])
		}
	}
}

type decideCase struct {
	Label string `json:"label"`
	Now   string `json:"now"`
	Usage any    `json:"usage"`
}

type decideOut struct {
	Candidates []map[string]any `json:"candidates"`
	Problems   []string         `json:"problems"`
	Valid      [][2]any         `json:"valid"`
}

// Failures 1 to 7, 39, 43, 46: decide, still_valid and the dedupe keys give what decide.py gives, on the real
// 2026-11-09 and 2026-11-11 responses and on each shape the e2e builds.
func TestDecideMatchesPython(t *testing.T) {
	cases := decideCases(t)
	raw, err := json.Marshal(cases)
	if err != nil {
		t.Fatal(err)
	}
	in := filepath.Join(t.TempDir(), "cases.json")
	if err := os.WriteFile(in, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	out := python(t, `import json, datetime as dt, decide
cfg = {"threshold_pct": 90, "min_reset_hours": 24, "expiry_alert_hours": [168, 24]}
res = []
for c in json.load(open(sys.argv[1])):
    now = decide.parse_time(c["now"])
    cands, problems = decide.decide(c["label"], c["usage"], now, cfg)
    later = now + dt.timedelta(hours=30)
    valid = []
    for x in cands:
        o = {"grant_id": x.grant_id, "kind": x.kind, "window": x.window}
        valid += [list(decide.still_valid(o, c["usage"], now, cfg)), list(decide.still_valid(o, c["usage"], later, cfg))]
    res.append({"candidates": [x.__dict__ for x in cands], "problems": problems, "valid": valid})
print(json.dumps(res))`, in)
	var want []decideOut
	if err := json.Unmarshal(out, &want); err != nil {
		t.Fatal(err)
	}
	rules := Rules{ThresholdPct: 90, MinResetHours: 24, ExpiryAlertHours: []int{168, 24}}
	for i, c := range cases {
		now, _ := parseTime(c.Now)
		usage, err := ParseUsage(mustJSON(t, c.Usage))
		if err != nil {
			t.Fatal(err)
		}
		cands, problems := Decide(c.Label, usage, now, rules)
		got := decideOut{Candidates: []map[string]any{}, Problems: problems, Valid: [][2]any{}}
		if got.Problems == nil {
			got.Problems = []string{}
		}
		for _, x := range cands {
			got.Candidates = append(got.Candidates, x.pythonFields())
			o := Offer{"grant_id": x.GrantID, "kind": x.Kind, "window": x.Window}
			for _, at := range []time.Time{now, now.Add(30 * time.Hour)} {
				ok, why := StillValid(o, usage, at, rules)
				got.Valid = append(got.Valid, [2]any{ok, why})
			}
		}
		g, _ := json.Marshal(got)
		w, _ := json.Marshal(want[i])
		if !bytes.Equal(g, w) {
			t.Errorf("case %d (%s at %s):\n go     %s\n python %s", i, c.Label, c.Now, g, w)
		}
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func decideCases(t *testing.T) []decideCase {
	var out []decideCase
	for _, f := range []struct{ file, now string }{
		{"live-acct167", "2026-11-09T20:20:00+00:00"}, {"live-acctcs", "2026-11-09T20:20:00+00:00"},
		{"live-acctmain", "2026-11-09T20:20:00+00:00"}, {"nov11-fable-left", "2026-11-11T13:00:00+00:00"},
		{"nov11-fable-out", "2026-11-11T13:00:00+00:00"}, {"nov11-weekly-out", "2026-11-11T13:00:00+00:00"},
	} {
		raw, err := os.ReadFile(filepath.Join("..", "test", "claim", "fixtures", f.file+".json"))
		if err != nil {
			t.Fatal(err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var u any
		if err := dec.Decode(&u); err != nil {
			t.Fatal(err)
		}
		out = append(out, decideCase{Label: f.file, Now: f.now, Usage: u})
	}
	out = append(out, syntheticCases()...)
	return out
}
