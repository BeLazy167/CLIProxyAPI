// Command replay runs the claude-quota alert and routing rules over saved usage reads, as the Python service's
// `claude_reset.py replay` did, and prints the same lines.
//
// Usage (from plugins/claude-quota): go run ./cmd/replay --now 2026-11-11T13:00:00+00:00 test/claim/fixtures/nov11-*.json
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/offers"
)

func main() {
	now := flag.String("now", "", "the time to judge the reads at (ISO 8601 with an offset); default now")
	flag.Parse()
	at := time.Now().UTC()
	if *now != "" {
		t, err := time.Parse(time.RFC3339Nano, *now)
		if err != nil {
			fmt.Fprintln(os.Stderr, "replay: --now:", err)
			os.Exit(2)
		}
		at = t
	}
	var labels []string
	var bodies [][]byte
	for _, f := range flag.Args() {
		raw, err := os.ReadFile(f)
		if err != nil {
			fmt.Fprintln(os.Stderr, "replay:", err)
			os.Exit(1)
		}
		labels = append(labels, strings.TrimSuffix(strings.TrimPrefix(filepath.Base(f), "live-"), ".json"))
		bodies = append(bodies, raw)
	}
	lines, err := offers.Replay(labels, bodies, at)
	if err != nil {
		fmt.Fprintln(os.Stderr, "replay:", err)
		os.Exit(1)
	}
	for _, l := range lines {
		fmt.Println(l)
	}
}
