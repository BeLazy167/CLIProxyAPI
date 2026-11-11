package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func ev(action, pkg, test string) string {
	return jsonLine(map[string]string{"Action": action, "Package": pkg, "Test": test})
}

func out(pkg, text string) string {
	return jsonLine(map[string]string{"Action": "output", "Package": pkg, "Output": text})
}

func jsonLine(fields map[string]string) string {
	for k, v := range fields {
		if v == "" {
			delete(fields, k)
		}
	}
	line, err := json.Marshal(fields)
	if err != nil {
		panic(err)
	}
	return string(line)
}

// normalRun is one run of package pkg whose test binary ended normally. Each result is "pass TestX", "fail TestX" or
// "skip TestX".
func normalRun(pkg string, results ...string) []string {
	lines := []string{ev("start", pkg, "")}
	action := "pass"
	for _, r := range results {
		a, test, _ := strings.Cut(r, " ")
		lines = append(lines, ev("run", pkg, test), ev(a, pkg, test))
		if a == "fail" {
			action = "fail"
		}
	}
	return append(lines, out(pkg, strings.ToUpper(action)+"\n"), out(pkg, strings.ToUpper(action)+"\t"+pkg+"\t0.01s\n"), ev(action, pkg, ""))
}

func join(runs ...[]string) []string {
	var lines []string
	for _, r := range runs {
		lines = append(lines, r...)
	}
	return lines
}

func writeFile(t *testing.T, lines ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "run.json")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func runDiff(t *testing.T, base, head string) (int, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run([]string{base, head}, &out, &errOut)
	return code, out.String()
}

func TestRegressions(t *testing.T) {
	oldFailure := normalRun("p", "fail TestOld")
	cases := []struct {
		name     string
		base     []string
		head     []string
		wantCode int
		want     string
	}{
		{
			name:     "passes on base, fails on head",
			base:     normalRun("p", "pass TestA"),
			head:     normalRun("p", "fail TestA"),
			wantCode: 1,
			want:     "p\tTestA\n",
		},
		{
			name:     "fails on both",
			base:     oldFailure,
			head:     oldFailure,
			wantCode: 0,
		},
		{
			name:     "new test fails on head",
			base:     normalRun("p", "pass TestA"),
			head:     normalRun("p", "pass TestA", "fail TestNew"),
			wantCode: 1,
			want:     "p\tTestNew\n",
		},
		{
			name:     "fixed on head",
			base:     oldFailure,
			head:     normalRun("p", "pass TestOld"),
			wantCode: 0,
		},
		{
			name:     "same test name in two packages",
			base:     join(normalRun("p", "pass TestA"), normalRun("q", "pass TestA")),
			head:     join(normalRun("p", "pass TestA"), normalRun("q", "fail TestA")),
			wantCode: 1,
			want:     "q\tTestA\n",
		},
		{
			name: "package stops building on head",
			base: normalRun("p", "pass TestA"),
			head: []string{
				`{"ImportPath":"p [p.test]","Action":"build-fail"}`,
				`{"Action":"fail","Package":"p","Elapsed":0,"FailedBuild":"p [p.test]"}`,
			},
			wantCode: 1,
			want:     "p\t\n",
		},
		{
			name: "build failure next to a test that already failed on base",
			base: oldFailure,
			head: []string{
				`{"ImportPath":"p [p.test]","Action":"build-fail"}`,
				`{"Action":"fail","Package":"p","Elapsed":0,"FailedBuild":"p [p.test]"}`,
			},
			wantCode: 1,
			want:     "p\t\n",
		},
		{
			name: "TestMain panics where a test already failed on base",
			base: oldFailure,
			head: []string{
				ev("start", "p", ""), out("p", "panic: boom in TestMain\n"), out("p", "FAIL\tp\t0.004s\n"), ev("fail", "p", ""),
			},
			wantCode: 1,
			want:     "p\t\n",
		},
		{
			name: "panic after the tests ran, next to a test that already failed on base",
			base: oldFailure,
			head: []string{
				ev("start", "p", ""), ev("run", "p", "TestOld"), ev("fail", "p", "TestOld"), out("p", "FAIL\n"),
				out("p", "panic: after run\n"), out("p", "FAIL\tp\t0.004s\n"), ev("fail", "p", ""),
			},
			wantCode: 1,
			want:     "p\t\n",
		},
		{
			name: "a test exits the test binary, next to a test that already failed on base",
			base: normalRun("p", "fail TestOld", "pass TestZExit"),
			head: []string{
				ev("start", "p", ""), ev("run", "p", "TestOld"), ev("fail", "p", "TestOld"), ev("run", "p", "TestZExit"),
				out("p", "FAIL\tp\t0.002s\n"), ev("fail", "p", ""),
			},
			wantCode: 1,
			want:     "p\t\n",
		},
		{
			name: "a test panics on both sides",
			base: []string{
				ev("start", "p", ""), ev("run", "p", "TestPanics"), ev("fail", "p", "TestPanics"),
				out("p", "FAIL\tp\t0.004s\n"), ev("fail", "p", ""),
			},
			head: []string{
				ev("start", "p", ""), ev("run", "p", "TestPanics"), ev("fail", "p", "TestPanics"),
				out("p", "FAIL\tp\t0.004s\n"), ev("fail", "p", ""),
			},
			wantCode: 0,
		},
		{
			name:     "non-JSON lines are skipped",
			base:     append([]string{"go: downloading example.com/x v1.0.0"}, normalRun("p", "pass TestA")...),
			head:     append(normalRun("p", "fail TestA"), "panic: boom"),
			wantCode: 1,
			want:     "p\tTestA\n",
		},
		{
			name:     "failing subtest keeps its full name",
			base:     normalRun("p", "pass TestB/sub_one", "pass TestB"),
			head:     normalRun("p", "fail TestB/sub_one", "fail TestB"),
			wantCode: 1,
			want:     "p\tTestB\np\tTestB/sub_one\n",
		},
		{
			name:     "any failure in a repeated base run counts as failing on base",
			base:     join(normalRun("p", "pass TestFlaky"), normalRun("p", "fail TestFlaky", "pass TestFlaky")),
			head:     normalRun("p", "fail TestFlaky"),
			wantCode: 0,
		},
		{
			name:     "new package with a failing test",
			base:     normalRun("p", "pass TestA"),
			head:     join(normalRun("p", "pass TestA"), normalRun("n", "fail TestN")),
			wantCode: 1,
			want:     "n\tTestN\n",
		},
		{
			name:     "skipped on base, fails on head",
			base:     normalRun("p", "skip TestA"),
			head:     normalRun("p", "fail TestA"),
			wantCode: 1,
			want:     "p\tTestA\n",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, out := runDiff(t, writeFile(t, tc.base...), writeFile(t, tc.head...))
			if code != tc.wantCode || out != tc.want {
				t.Fatalf("got code %d output %q, want code %d output %q", code, out, tc.wantCode, tc.want)
			}
		})
	}
}

func TestPackageWithoutResultIsAnError(t *testing.T) {
	complete := normalRun("p", "pass TestA")
	killed := join(normalRun("p", "pass TestA"), []string{ev("start", "k", ""), ev("run", "k", "TestK")})
	for name, files := range map[string][2]string{
		"head stopped early": {writeFile(t, complete...), writeFile(t, killed...)},
		"base stopped early": {writeFile(t, killed...), writeFile(t, complete...)},
	} {
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := run(files[:], &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "k") {
				t.Fatalf("got code %d stderr %q, want code 2 naming package k", code, stderr.String())
			}
		})
	}
}

func TestRunWithoutPackageResultsIsAnError(t *testing.T) {
	results := writeFile(t, ev("pass", "p", "TestA"), ev("pass", "p", ""))
	noResults := writeFile(t, "go: updates to go.mod needed", `{"Action":"output","Package":"p","Output":"x"}`)
	for name, files := range map[string][2]string{
		"empty head": {results, noResults},
		"empty base": {noResults, results},
	} {
		t.Run(name, func(t *testing.T) {
			if code, _ := runDiff(t, files[0], files[1]); code != 2 {
				t.Fatalf("got code %d, want 2", code)
			}
		})
	}
}

func TestBadArguments(t *testing.T) {
	results := writeFile(t, ev("pass", "p", ""))
	for name, args := range map[string][]string{
		"one file":     {results},
		"missing file": {results, filepath.Join(t.TempDir(), "absent.json")},
	} {
		t.Run(name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			if code := run(args, &out, &errOut); code != 2 {
				t.Fatalf("got code %d, want 2", code)
			}
		})
	}
}
