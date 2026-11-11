package ci

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const flakyTest = `package flaky

import (
	"os"
	"testing"
)

// Passes on its first run and fails on every later one, so the base's full run passes and a rerun fails.
func TestFlaky(t *testing.T) {
	path := os.Getenv("FLAKY_COUNTER")
	_, err := os.Stat(path)
	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err == nil {
		t.Fatal("flaky failure")
	}
}
`

func module(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	files["go.mod"] = "module example.com/m\n\ngo 1.21\n"
	for name, body := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func testFile(pkg, name, body string) string {
	return "package " + pkg + "\n\nimport \"testing\"\n\nfunc " + name + "(t *testing.T) {" + body + "}\n"
}

func runScript(t *testing.T, dir, script string, args ...string) (int, string, string) {
	t.Helper()
	path, err := filepath.Abs(script)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("bash", append([]string{path}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "FLAKY_COUNTER="+filepath.Join(t.TempDir(), "counter"), "GOFLAGS=-count=1")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return 0, stdout.String(), stderr.String()
	case errors.As(err, &exit):
		return exit.ExitCode(), stdout.String(), stderr.String()
	}
	t.Fatal(err)
	return 0, "", ""
}

func TestBaselineScript(t *testing.T) {
	if testing.Short() {
		t.Skip("runs go test in two temporary modules")
	}
	base := module(t, map[string]string{
		"stable/s_test.go": testFile("stable", "TestStable", ""),
		"broken/b_test.go": testFile("broken", "TestBuilds", ""),
		"old/o_test.go":    testFile("old", "TestOld", `t.Fatal("already broken")`),
		"flaky/f_test.go":  flakyTest,
	})
	head := module(t, map[string]string{
		"stable/s_test.go": testFile("stable", "TestStable", `t.Fatal("regressed")`),
		"broken/b_test.go": testFile("broken", "TestBuilds", "undefinedName()"),
		"old/o_test.go":    testFile("old", "TestOld", `t.Fatal("already broken")`),
		"flaky/f_test.go":  testFile("flaky", "TestFlaky", `t.Fatal("flaky failure")`),
		"fresh/f_test.go":  testFile("fresh", "TestFresh", "undefinedName()"),
		"newpkg/n_test.go": testFile("newpkg", "TestNew", `t.Fatal("new and failing")`),
	})

	code, out, errOut := runScript(t, head, "test-baseline.sh", base, t.TempDir())
	if code != 1 {
		t.Fatalf("exit %d, want 1\nstdout:\n%s\nstderr:\n%s", code, out, errOut)
	}
	newFailures, flaky, _ := strings.Cut(out, "also failed in a base rerun")
	for _, want := range []string{
		"- `example.com/m/stable` `TestStable`",
		"- `example.com/m/broken` (package)",
		"- `example.com/m/fresh` (package)",
		"- `example.com/m/newpkg` `TestNew`",
	} {
		if !strings.Contains(newFailures, want) {
			t.Errorf("new failures lack %q:\n%s", want, out)
		}
	}
	if !strings.Contains(flaky, "- `example.com/m/flaky` `TestFlaky`") || strings.Contains(newFailures, "TestFlaky") {
		t.Errorf("TestFlaky should be listed only as failing in a base rerun:\n%s", out)
	}
	if strings.Contains(out, "TestOld") {
		t.Errorf("TestOld fails on both sides and should not be listed:\n%s", out)
	}
	if !strings.Contains(errOut, "regressed") || !strings.Contains(errOut, "undefined: undefinedName") {
		t.Errorf("stderr should carry the failing output:\n%s", errOut)
	}

	code, out, errOut = runScript(t, base, "test-baseline.sh", base, t.TempDir())
	if code != 0 || !strings.Contains(out, "No new failures.") {
		t.Fatalf("same tree: exit %d, want 0\nstdout:\n%s\nstderr:\n%s", code, out, errOut)
	}
}

const killerTest = `package zkiller

import (
	"os"
	"syscall"
	"testing"
	"time"
)

// Kills the go command that runs it, as the OOM killer would, so the run ends without this package's result. go test
// prints results in package order, and the wait lets the packages before this one finish and print theirs.
func TestKillsGoTest(t *testing.T) {
	time.Sleep(2 * time.Second)
	if err := syscall.Kill(os.Getppid(), syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Second)
}
`

func TestBaselineScriptStopsWhenGoTestDies(t *testing.T) {
	if testing.Short() {
		t.Skip("runs go test in two temporary modules")
	}
	base := module(t, map[string]string{
		"stable/s_test.go":  testFile("stable", "TestStable", ""),
		"zkiller/k_test.go": testFile("zkiller", "TestKillsGoTest", ""),
	})
	head := module(t, map[string]string{
		"stable/s_test.go":  testFile("stable", "TestStable", ""),
		"zkiller/k_test.go": killerTest,
	})
	code, out, errOut := runScript(t, head, "test-baseline.sh", base, t.TempDir())
	if code != 2 || !strings.Contains(errOut, "exited with status 137") {
		t.Fatalf("exit %d, want 2 with the go command's status on stderr\nstdout:\n%s\nstderr:\n%s", code, out, errOut)
	}
}

const badPrintf = "package x\n\nimport \"fmt\"\n\nfunc F() { fmt.Printf(\"%d\\n\", \"text\") }\n"

func TestVetBaselineScript(t *testing.T) {
	if testing.Short() {
		t.Skip("runs go vet in temporary modules")
	}
	base := module(t, map[string]string{"x/a.go": badPrintf})
	cases := []struct {
		name     string
		head     map[string]string
		wantCode int
		want     []string
		absent   []string
	}{
		{
			name:     "finding on both sides at another line",
			head:     map[string]string{"x/a.go": strings.Replace(badPrintf, "import", "\nimport", 1)},
			wantCode: 0,
			want:     []string{"No new go vet findings."},
		},
		{
			name:     "fixed on head",
			head:     map[string]string{"x/a.go": "package x\n"},
			wantCode: 0,
			want:     []string{"No new go vet findings."},
		},
		{
			name:     "new finding in another file",
			head:     map[string]string{"x/a.go": badPrintf, "x/b.go": strings.Replace(badPrintf, "func F()", "func G()", 1)},
			wantCode: 1,
			want:     []string{"- `x/b.go: fmt.Printf format %d has arg \"text\" of wrong type string`"},
			absent:   []string{"x/a.go"},
		},
		{
			name:     "same finding twice in a file that had it once",
			head:     map[string]string{"x/a.go": strings.Replace(badPrintf, "}\n", "; fmt.Printf(\"%d\\n\", \"text\") }\n", 1)},
			wantCode: 1,
			want:     []string{"- `x/a.go: fmt.Printf format %d has arg \"text\" of wrong type string`"},
		},
		{
			name:     "head no longer type-checks",
			head:     map[string]string{"x/a.go": badPrintf, "x/c.go": "package x\n\nvar v = undefinedName\n"},
			wantCode: 1,
			want:     []string{"undefined: undefinedName"},
		},
		{
			name:     "go command fails",
			head:     map[string]string{"x/a.go": badPrintf, "go.work": "this is not a go.work file\n"},
			wantCode: 1,
			want:     []string{"New go vet findings"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, out, errOut := runScript(t, module(t, tc.head), "vet-baseline.sh", base)
			if code != tc.wantCode {
				t.Fatalf("exit %d, want %d\nstdout:\n%s\nstderr:\n%s", code, tc.wantCode, out, errOut)
			}
			for _, w := range tc.want {
				if !strings.Contains(out, w) {
					t.Errorf("stdout lacks %q:\n%s", w, out)
				}
			}
			for _, a := range tc.absent {
				if strings.Contains(out, a) {
					t.Errorf("stdout should not mention %q:\n%s", a, out)
				}
			}
		})
	}
}
