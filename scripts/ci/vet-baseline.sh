#!/usr/bin/env bash
# vet-baseline.sh BASE_DIR: run `go vet ./...` in BASE_DIR (a checkout of the base commit) and in the current directory
# (the head), and fail only on findings the base does not have. Findings compare as "file: message", without line and
# column, so code that moves does not count; a finding that appears more often than on the base does. Any other output
# of the go command counts as a finding, so a vet that cannot run never passes. Prints a Markdown report on stdout and
# the head's full vet output on stderr.
set -euo pipefail
[ $# = 1 ] || { echo "usage: $0 BASE_DIR" >&2; exit 2; }
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

vet() { # dir name: findings into $out/name, one per line
  (cd "$1" && go vet ./... >"$out/$2.raw" 2>&1) || :
  grep -v '^#' "$out/$2.raw" | sed -E 's/^([^: ]+\.go):[0-9]+:[0-9]+: /\1: /' >"$out/$2" || :
}
vet "$1" base
vet . head
awk 'FILENAME == ARGV[1] {left[$0]++; next} left[$0]-- <= 0' "$out/base" "$out/head" >"$out/new"

echo "### go vet: head against base $(git -C "$1" rev-parse --short=12 HEAD)"
echo
if [ -s "$out/new" ]; then
  echo "New go vet findings (file: message):"
  echo
  sed 's/.*/- `&`/' "$out/new"
  cat "$out/head.raw" >&2
  exit 1
fi
echo "No new go vet findings. The base has $(wc -l <"$out/base")."
cat "$out/head.raw" >&2
