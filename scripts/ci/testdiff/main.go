// Command testdiff compares two `go test -json` outputs and prints what fails on head but not on base.
//
// Usage: testdiff BASE.json HEAD.json
//
// Each output line is "<package>\t<test>", sorted. An empty test means the package failed for more than its failing
// tests: it did not build, its test binary panicked outside a test or ended without its final PASS or FAIL line (a
// TestMain panic, an os.Exit, a crash), or it failed with no failing test. Tests that already fail on base never excuse
// such a package failure. A test or package counts as failing on a side when any of its runs there failed, so base runs
// repeated with -count, or appended to the base file, absorb flaky tests. Exit status: 0 no new failures, 1 new
// failures, 2 bad input: a file with no package results, or a package that started and never reported a result (the go
// command died), so a run that did not finish never reads as a pass.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
)

type key struct {
	Package string
	Test    string
}

type event struct {
	Action      string
	Package     string
	Test        string
	Output      string
	FailedBuild string
}

// binaryRun is what one run of a package's test binary has shown so far.
type binaryRun struct {
	started    bool
	failedTest bool
	summary    bool // the testing package's final "PASS" or "FAIL" line
	panicked   bool // a panic outside any test
}

func (r binaryRun) failedBeyondTests(e event) bool {
	return e.FailedBuild != "" || !r.failedTest || !r.summary || r.panicked
}

type results struct {
	failed   map[key]bool
	packages int
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) != 2 {
		fmt.Fprintln(stderr, "usage: testdiff BASE.json HEAD.json")
		return 2
	}
	base, err := load(args[0])
	if err != nil {
		fmt.Fprintln(stderr, "testdiff:", err)
		return 2
	}
	head, err := load(args[1])
	if err != nil {
		fmt.Fprintln(stderr, "testdiff:", err)
		return 2
	}
	var regressions []key
	for k := range head.failed {
		if !base.failed[k] {
			regressions = append(regressions, k)
		}
	}
	sort.Slice(regressions, func(i, j int) bool {
		if regressions[i].Package != regressions[j].Package {
			return regressions[i].Package < regressions[j].Package
		}
		return regressions[i].Test < regressions[j].Test
	})
	for _, k := range regressions {
		fmt.Fprintf(stdout, "%s\t%s\n", k.Package, k.Test)
	}
	if len(regressions) > 0 {
		return 1
	}
	return 0
}

func load(path string) (results, error) {
	r := results{failed: map[key]bool{}}
	f, err := os.Open(path)
	if err != nil {
		return r, err
	}
	defer func() { _ = f.Close() }()
	runs := map[string]binaryRun{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1<<20), 64<<20)
	for sc.Scan() {
		var e event
		if json.Unmarshal(sc.Bytes(), &e) != nil || e.Package == "" {
			continue
		}
		cur := runs[e.Package]
		switch {
		case e.Action == "start":
			cur = binaryRun{started: true}
		case e.Action == "output" && e.Test == "":
			cur.summary = cur.summary || e.Output == "PASS\n" || e.Output == "FAIL\n"
			cur.panicked = cur.panicked || strings.HasPrefix(e.Output, "panic: ")
		case e.Action == "fail" && e.Test != "":
			r.failed[key{e.Package, e.Test}] = true
			cur.failedTest = true
		case e.Action == "fail":
			if cur.failedBeyondTests(e) {
				r.failed[key{e.Package, ""}] = true
			}
			fallthrough
		case (e.Action == "pass" || e.Action == "skip") && e.Test == "":
			r.packages++
			delete(runs, e.Package)
			continue
		}
		runs[e.Package] = cur
	}
	if err := sc.Err(); err != nil {
		return r, fmt.Errorf("%s: %w", path, err)
	}
	var unfinished []string
	for pkg, cur := range runs {
		if cur.started {
			unfinished = append(unfinished, pkg)
		}
	}
	if len(unfinished) > 0 {
		sort.Strings(unfinished)
		return r, fmt.Errorf("%s: packages started and never reported a result, so the go command stopped early: %s",
			path, strings.Join(unfinished, " "))
	}
	if r.packages == 0 {
		return r, fmt.Errorf("%s: no package results; the go command did not run the tests", path)
	}
	return r, nil
}
