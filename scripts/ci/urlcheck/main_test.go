package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type tree map[string]string

func (tr tree) write(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for name, body := range tr {
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

func goFile(body string) string { return "package x\n\n" + body + "\n" }

func check(t *testing.T, base, head tree, allow string) (int, string) {
	t.Helper()
	allowFile := filepath.Join(t.TempDir(), "allowed-hosts.txt")
	if err := os.WriteFile(allowFile, []byte(allow), 0o644); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	code := run([]string{"-base", base.write(t), "-allow", allowFile, head.write(t)}, &out, &errOut)
	return code, out.String()
}

var baseTree = tree{"a.go": goFile(`const api = "https://api.known.com/v1"`)}

func TestNewHosts(t *testing.T) {
	cases := []struct {
		name     string
		head     string
		allow    string
		wantCode int
		want     []string
	}{
		{
			name:     "new host not allowlisted fails",
			head:     `const u = "https://evil.example.net/collect"`,
			wantCode: 1,
			want:     []string{"| evil.example.net | new host, not allowlisted | `https://evil.example.net/collect` | b.go:3 |"},
		},
		{
			name:     "new host in allowlist passes",
			head:     `const u = "https://evil.example.net/collect"`,
			allow:    "# reviewed 2026-11-11\n\n  Evil.Example.NET  \n",
			wantCode: 0,
			want:     []string{"| evil.example.net | allowlisted |"},
		},
		{
			name:     "new URL on a host the base already uses passes",
			head:     `const u = "https://api.known.com/v2"`,
			wantCode: 0,
			want:     []string{"| api.known.com | host already used |"},
		},
		{
			name:     "raw string literal is found",
			head:     "const u = `see https://raw.example.org/x`",
			wantCode: 1,
			want:     []string{"| raw.example.org | new host, not allowlisted |"},
		},
		{
			name:     "case and port are normalized",
			head:     `const u = "HTTPS://API.Known.com:443/v3"`,
			wantCode: 0,
			want:     []string{"| api.known.com | host already used |"},
		},
		{
			name:     "wss counts",
			head:     `const u = "wss://stream.example.io/ws"`,
			wantCode: 1,
			want:     []string{"| stream.example.io | new host, not allowlisted |"},
		},
		{
			name:     "host built at run time is listed, not failed",
			head:     "func f(h string) string { return \"https://\" + h + \"/x\" }\nconst g = \"https://%s/y\"",
			wantCode: 0,
			want:     []string{"| (dynamic) | host not literal | `https://` | b.go:3 |", "| (dynamic) | host not literal | `https://%s/y` | b.go:4 |"},
		},
		{
			name:     "two URLs in one literal",
			head:     `const u = "https://one.example.com https://two.example.com"`,
			wantCode: 1,
			want:     []string{"| one.example.com |", "| two.example.com |"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			head := tree{"a.go": baseTree["a.go"], "b.go": goFile(tc.head)}
			code, out := check(t, baseTree, head, tc.allow)
			if code != tc.wantCode {
				t.Fatalf("got code %d, want %d\n%s", code, tc.wantCode, out)
			}
			for _, w := range tc.want {
				if !strings.Contains(out, w) {
					t.Fatalf("output lacks %q:\n%s", w, out)
				}
			}
		})
	}
}

func TestIgnored(t *testing.T) {
	cases := map[string]tree{
		"test file":         {"b_test.go": goFile(`const u = "https://evil.example.net"`)},
		"comment":           {"b.go": goFile("// https://evil.example.net/docs\n/* wss://evil.example.net */\nconst n = 1")},
		"testdata":          {"testdata/b.go": goFile(`const u = "https://evil.example.net"`)},
		"dot directory":     {".forgejo/b.go": goFile(`const u = "https://evil.example.net"`)},
		"underscore dir":    {"_old/b.go": goFile(`const u = "https://evil.example.net"`)},
		"nested module":     {"sub/go.mod": "module sub\n", "sub/b.go": goFile(`const u = "https://evil.example.net"`)},
		"http is not https": {"b.go": goFile(`const u = "http://evil.example.net"`)},
		"URL moved to another file": {
			"b.go": goFile(`const moved = "https://api.known.com/v1"`),
		},
	}
	for name, extra := range cases {
		t.Run(name, func(t *testing.T) {
			head := tree{}
			if name != "URL moved to another file" {
				head["a.go"] = baseTree["a.go"]
			}
			for k, v := range extra {
				head[k] = v
			}
			code, out := check(t, baseTree, head, "")
			if code != 0 || !strings.Contains(out, "No new outbound URL literals.") {
				t.Fatalf("got code %d:\n%s", code, out)
			}
		})
	}
}

func TestBadInput(t *testing.T) {
	root := baseTree.write(t)
	allow := filepath.Join(t.TempDir(), "allowed-hosts.txt")
	if err := os.WriteFile(allow, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	for name, args := range map[string][]string{
		"missing allowlist": {"-base", root, "-allow", filepath.Join(root, "absent.txt"), root},
		"missing base":      {"-base", filepath.Join(root, "absent"), "-allow", allow, root},
		"no base flag":      {"-allow", allow, root},
	} {
		t.Run(name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			if code := run(args, &out, &errOut); code != 2 {
				t.Fatalf("got code %d, want 2", code)
			}
		})
	}
}
