// Command testdiff compares two `go test -json` outputs and prints what fails on head but not on base.
//
// Usage: testdiff BASE.json HEAD.json
//
// Each output line is "<package>\t<test>", sorted. An empty test means the package failed with no failing test in it,
// for example because it no longer builds; a package with a failing test is explained by that test. A test counts as
// failing on a side when any of its results there is a failure, so base runs repeated with -count, or appended to the
// base file, absorb flaky tests. Exit status: 0 no new failures, 1 new failures, 2 bad input, including a file with no
// package results, so a go command that died never reads as a pass.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
)

type key struct {
	Package string
	Test    string
}

type event struct {
	Action  string
	Package string
	Test    string
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
	failingTests := map[string]bool{}
	for k := range head.failed {
		if k.Test != "" {
			failingTests[k.Package] = true
		}
	}
	var regressions []key
	for k := range head.failed {
		if !base.failed[k] && (k.Test != "" || !failingTests[k.Package]) {
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
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1<<20), 64<<20)
	for sc.Scan() {
		var e event
		if json.Unmarshal(sc.Bytes(), &e) != nil || e.Package == "" {
			continue
		}
		switch e.Action {
		case "fail":
			r.failed[key{e.Package, e.Test}] = true
		case "pass", "skip":
		default:
			continue
		}
		if e.Test == "" {
			r.packages++
		}
	}
	if err := sc.Err(); err != nil {
		return r, fmt.Errorf("%s: %w", path, err)
	}
	if r.packages == 0 {
		return r, fmt.Errorf("%s: no package results; the go command did not run the tests", path)
	}
	return r, nil
}
