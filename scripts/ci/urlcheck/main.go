// Command urlcheck lists the https:// and wss:// URL literals that a Go tree adds over a base tree, and fails when one of
// them names a host that the base never used and the allowlist does not name.
//
// Usage: urlcheck -base BASE_DIR -allow ALLOWLIST [HEAD_DIR]
//
// Only string literals in non-test .go files count; comments do not. Directories that `go ./...` skips (testdata, names
// starting with "." or "_", nested modules) are skipped too. A literal whose host is built at run time ("https://" + h,
// "https://%s/x") is listed as dynamic and never fails the check. The allowlist holds one host per line; "#" starts a
// comment. The Markdown report goes to stdout. Exit status: 0 pass, 1 new host not allowlisted, 2 bad input.
package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"go/scanner"
	"go/token"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	urlPattern  = regexp.MustCompile("(?i)(?:https|wss)://[^\\s\"'`<>\\\\]*")
	hostPattern = regexp.MustCompile(`(?i)^(?:https|wss)://([a-z0-9.-]+)`)
)

const dynamicHost = "(dynamic)"

type literal struct {
	URL  string
	Host string
	Pos  string
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("urlcheck", flag.ContinueOnError)
	flags.SetOutput(stderr)
	baseDir := flags.String("base", "", "base tree")
	allowPath := flags.String("allow", "", "allowlist file")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	headDir := "."
	if flags.NArg() > 0 {
		headDir = flags.Arg(0)
	}
	if *baseDir == "" || *allowPath == "" {
		fmt.Fprintln(stderr, "usage: urlcheck -base BASE_DIR -allow ALLOWLIST [HEAD_DIR]")
		return 2
	}
	allowed, err := readAllowlist(*allowPath)
	if err != nil {
		fmt.Fprintln(stderr, "urlcheck:", err)
		return 2
	}
	base, err := scan(*baseDir)
	if err != nil {
		fmt.Fprintln(stderr, "urlcheck:", err)
		return 2
	}
	head, err := scan(headDir)
	if err != nil {
		fmt.Fprintln(stderr, "urlcheck:", err)
		return 2
	}
	baseURLs, baseHosts := map[string]bool{}, map[string]bool{}
	for _, l := range base {
		baseURLs[l.URL] = true
		baseHosts[l.Host] = true
	}

	fmt.Fprintln(stdout, "### Outbound URL literals added")
	fmt.Fprintln(stdout)
	failed, listed := false, false
	for _, l := range head {
		if baseURLs[l.URL] {
			continue
		}
		var status string
		switch {
		case l.Host == dynamicHost:
			status = "host not literal"
		case baseHosts[l.Host]:
			status = "host already used"
		case allowed[l.Host]:
			status = "allowlisted"
		default:
			status = "new host, not allowlisted"
			failed = true
		}
		if !listed {
			fmt.Fprintln(stdout, "| Host | Status | Literal | Where |")
			fmt.Fprintln(stdout, "|---|---|---|---|")
			listed = true
		}
		fmt.Fprintf(stdout, "| %s | %s | `%s` | %s |\n", l.Host, status, l.URL, l.Pos)
	}
	if !listed {
		fmt.Fprintln(stdout, "No new outbound URL literals.")
	}
	if failed {
		fmt.Fprintf(stdout, "\nA new host must be reviewed and added to %s before this change can merge.\n", *allowPath)
		return 1
	}
	return 0
}

func readAllowlist(path string) (map[string]bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	allowed := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line, _, _ := strings.Cut(sc.Text(), "#")
		if host := strings.ToLower(strings.TrimSpace(line)); host != "" {
			allowed[host] = true
		}
	}
	return allowed, sc.Err()
}

// scan returns the URL literals in the non-test Go files under root, in file walk order.
func scan(root string) ([]literal, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}
	var found []literal
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != root && skipDir(path, d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		found = append(found, literals(filepath.ToSlash(rel), src)...)
		return nil
	})
	return found, err
}

func skipDir(path, name string) bool {
	if name == "testdata" || strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
		return true
	}
	_, err := os.Stat(filepath.Join(path, "go.mod"))
	return !errors.Is(err, fs.ErrNotExist)
}

func literals(name string, src []byte) []literal {
	fset := token.NewFileSet()
	file := fset.AddFile(name, -1, len(src))
	var s scanner.Scanner
	s.Init(file, src, nil, 0)
	var found []literal
	for {
		pos, tok, lit := s.Scan()
		if tok == token.EOF {
			return found
		}
		if tok != token.STRING {
			continue
		}
		for _, u := range urlPattern.FindAllString(lit, -1) {
			host := dynamicHost
			if m := hostPattern.FindStringSubmatch(u); m != nil {
				host = strings.ToLower(strings.TrimRight(m[1], "."))
			}
			p := fset.Position(pos)
			found = append(found, literal{URL: u, Host: host, Pos: fmt.Sprintf("%s:%d", p.Filename, p.Line)})
		}
	}
}
