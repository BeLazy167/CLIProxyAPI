package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func ev(action, pkg, test string) string {
	if test == "" {
		return `{"Action":"` + action + `","Package":"` + pkg + `"}`
	}
	return `{"Action":"` + action + `","Package":"` + pkg + `","Test":"` + test + `"}`
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
	cases := []struct {
		name     string
		base     []string
		head     []string
		wantCode int
		want     string
	}{
		{
			name:     "passes on base, fails on head",
			base:     []string{ev("pass", "p", "TestA"), ev("pass", "p", "")},
			head:     []string{ev("fail", "p", "TestA"), ev("fail", "p", "")},
			wantCode: 1,
			want:     "p\tTestA\n",
		},
		{
			name:     "fails on both",
			base:     []string{ev("fail", "p", "TestA"), ev("fail", "p", "")},
			head:     []string{ev("fail", "p", "TestA"), ev("fail", "p", "")},
			wantCode: 0,
		},
		{
			name:     "new test fails on head",
			base:     []string{ev("pass", "p", "TestA"), ev("pass", "p", "")},
			head:     []string{ev("pass", "p", "TestA"), ev("fail", "p", "TestNew"), ev("fail", "p", "")},
			wantCode: 1,
			want:     "p\tTestNew\n",
		},
		{
			name:     "fixed on head",
			base:     []string{ev("fail", "p", "TestA"), ev("fail", "p", "")},
			head:     []string{ev("pass", "p", "TestA"), ev("pass", "p", "")},
			wantCode: 0,
		},
		{
			name: "same test name in two packages",
			base: []string{
				ev("pass", "p", "TestA"), ev("pass", "p", ""),
				ev("pass", "q", "TestA"), ev("pass", "q", ""),
			},
			head: []string{
				ev("pass", "p", "TestA"), ev("pass", "p", ""),
				ev("fail", "q", "TestA"), ev("fail", "q", ""),
			},
			wantCode: 1,
			want:     "q\tTestA\n",
		},
		{
			name: "package stops building on head",
			base: []string{ev("pass", "p", "TestA"), ev("pass", "p", "")},
			head: []string{
				`{"ImportPath":"p [p.test]","Action":"build-fail"}`,
				`{"Action":"fail","Package":"p","Elapsed":0,"FailedBuild":"p [p.test]"}`,
			},
			wantCode: 1,
			want:     "p\t\n",
		},
		{
			name:     "non-JSON lines are skipped",
			base:     []string{"go: downloading example.com/x v1.0.0", ev("pass", "p", "TestA"), ev("pass", "p", "")},
			head:     []string{ev("fail", "p", "TestA"), "panic: boom", ev("fail", "p", "")},
			wantCode: 1,
			want:     "p\tTestA\n",
		},
		{
			name:     "failing subtest keeps its full name",
			base:     []string{ev("pass", "p", "TestB/sub_one"), ev("pass", "p", "TestB"), ev("pass", "p", "")},
			head:     []string{ev("fail", "p", "TestB/sub_one"), ev("fail", "p", "TestB"), ev("fail", "p", "")},
			wantCode: 1,
			want:     "p\tTestB\np\tTestB/sub_one\n",
		},
		{
			name: "any failure in a repeated base run counts as failing on base",
			base: []string{
				ev("pass", "p", "TestFlaky"), ev("pass", "p", ""),
				ev("fail", "p", "TestFlaky"), ev("pass", "p", "TestFlaky"), ev("fail", "p", ""),
			},
			head:     []string{ev("fail", "p", "TestFlaky"), ev("fail", "p", "")},
			wantCode: 0,
		},
		{
			name: "package failure explained by a test that also fails in a base rerun",
			base: []string{
				ev("pass", "p", "TestFlaky"), ev("pass", "p", ""),
				ev("fail", "p", "TestFlaky"),
			},
			head:     []string{ev("fail", "p", "TestFlaky"), ev("fail", "p", "")},
			wantCode: 0,
		},
		{
			name:     "new package with a failing test",
			base:     []string{ev("pass", "p", "TestA"), ev("pass", "p", "")},
			head:     []string{ev("pass", "p", "TestA"), ev("pass", "p", ""), ev("fail", "n", "TestN"), ev("fail", "n", "")},
			wantCode: 1,
			want:     "n\tTestN\n",
		},
		{
			name:     "skipped on base, fails on head",
			base:     []string{ev("skip", "p", "TestA"), ev("pass", "p", "")},
			head:     []string{ev("fail", "p", "TestA"), ev("fail", "p", "")},
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
