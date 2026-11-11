#!/usr/bin/env bash
# test-baseline.sh BASE_DIR [OUT_DIR]: run `go test ./...` in BASE_DIR (a checkout of the base commit) and in the current
# directory (the head), and fail only on tests that fail on the head but not on the base (scripts/ci/testdiff).
# Before failing, each suspected test is rerun 5 times on the base: one failure there marks it as already failing on the
# base (a flaky test), not a new failure. A package that fails with no failing test (it does not build) is not rerun:
# on the base it may not exist, and go test reports a missing package as a failure.
# Prints a Markdown report on stdout and the failing tests' output on stderr.
# OUT_DIR keeps base.json, head.json and the lists; it defaults to a new temporary directory.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 BASE_DIR [OUT_DIR]" >&2; exit 2; }
base=$(cd "$1" && pwd)
out=${2:-$(mktemp -d)}
mkdir -p "$out" && out=$(cd "$out" && pwd)
(cd "$(dirname "$0")/testdiff" && go build -o "$out/testdiff" .)

gotest() { # dir name: full suite as JSON into $out/name.json
  local t0=$SECONDS
  (cd "$1" && go test -json ./... >"$out/$2.json" 2>"$out/$2.stderr") || :
  echo "$2: go test ./... took $((SECONDS - t0)) s" >&2
}
by_package() { # list file -> "package run-pattern" for each package; a package-only entry gets ^$ (build output only)
  awk -F'\t' '{split($2, t, "/"); if (!($1 in run)) run[$1] = ""; if (t[1] != "" && !seen[$1 SUBSEP t[1]]++) run[$1] = run[$1] (run[$1] == "" ? "" : "|") t[1]}
    END {for (p in run) print p, (run[p] == "" ? "^$" : "^(" run[p] ")$")}' "$1" | sort
}
diff_runs() { # list file: testdiff base.json head.json into it; returns testdiff's status
  local rc=0
  "$out/testdiff" "$out/base.json" "$out/head.json" >"$1" || rc=$?
  return $rc
}

gotest "$base" base
gotest . head
rc=0
diff_runs "$out/suspects.tsv" || rc=$?
[ $rc -le 1 ] || { cat "$out/base.stderr" "$out/head.stderr" >&2; exit $rc; }
if [ $rc = 1 ]; then
  while read -r pkg pattern; do
    [ "$pattern" = '^$' ] && continue
    (cd "$base" && go test -json -count=5 -run "$pattern" "$pkg") >>"$out/base.json" 2>>"$out/base.stderr" || :
  done < <(by_package "$out/suspects.tsv")
  rc=0
  diff_runs "$out/new-failures.tsv" || rc=$?
  [ $rc -le 1 ] || exit $rc
else
  : >"$out/new-failures.tsv"
fi
grep -vxFf "$out/new-failures.tsv" "$out/suspects.tsv" >"$out/flaky-on-base.tsv" || :

echo "### Go tests: head against base $(git -C "$base" rev-parse --short=12 HEAD)"
echo
if [ -s "$out/new-failures.tsv" ]; then
  echo "New failures (fail on the head, pass or are absent on the base):"
  echo
  awk -F'\t' '{print "- `" $1 "` " ($2 == "" ? "(package)" : "`" $2 "`")}' "$out/new-failures.tsv"
else
  echo "No new failures."
fi
if [ -s "$out/flaky-on-base.tsv" ]; then
  echo
  echo "Failed on the head but also failed in a base rerun, so not counted:"
  echo
  awk -F'\t' '{print "- `" $1 "` " ($2 == "" ? "(package)" : "`" $2 "`")}' "$out/flaky-on-base.tsv"
fi
while read -r pkg pattern; do
  echo "--- go test -count=1 -run '$pattern' $pkg (head)" >&2
  go test -count=1 -run "$pattern" "$pkg" >&2 || :
done < <(by_package "$out/new-failures.tsv")
[ ! -s "$out/new-failures.tsv" ]
