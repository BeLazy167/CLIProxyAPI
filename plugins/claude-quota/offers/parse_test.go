package offers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Failure 60: a usage body or a state file that holds a JSON value followed by more data is read as that value,
// where Python's json module refuses it ("Extra data"). Each input gets the verdict Python gives it.
func TestTrailingDataRefusedAsPythonDoes(t *testing.T) {
	inputs := []string{`{"a": 1}`, "{\"a\": 1}\n", " \t{\"a\": 1} \r\n", `{"a": 1} x`, `{"a": 1}{}`, `{"a": 1} 2`,
		`{"a": 1}]`, "{\"a\": 1}\n{\"b\": 2}\n", `{"a": 1}"`}
	raw, _ := json.Marshal(inputs)
	script := "import json\nfor s in json.loads(sys.argv[1]):\n    try:\n        json.loads(s)\n        print('ok')\n    except ValueError:\n        print('refused')\n"
	verdicts := strings.Fields(string(python(t, script, string(raw))))
	if len(verdicts) != len(inputs) {
		t.Fatalf("python gave %d verdicts for %d inputs", len(verdicts), len(inputs))
	}
	dir := t.TempDir()
	for i, in := range inputs {
		want := verdicts[i] == "ok"
		if _, err := ParseUsage([]byte(in)); (err == nil) != want {
			t.Errorf("usage body %q: Python says %s, Go error %v", in, verdicts[i], err)
		}
		path := filepath.Join(dir, "state.json")
		if err := os.WriteFile(path, []byte(in), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := NewStore(path).Read(); (err == nil) != want {
			t.Errorf("state file %q: Python says %s, Go error %v", in, verdicts[i], err)
		}
	}
}
