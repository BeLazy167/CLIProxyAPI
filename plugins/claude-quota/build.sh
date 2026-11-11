#!/usr/bin/env bash
# Builds the claude-quota plugin as a c-shared library. The default shadow build must carry no gateway write path,
# no claim endpoint and no Bark or Resend host; CLAUDE_QUOTA_MODE=live builds with the claude_quota_live tag and
# must carry them.
# Usage: [CLAUDE_QUOTA_MODE=shadow|live] plugins/claude-quota/build.sh [OUTPUT]   (default: plugins/claude-quota/bin/claude-quota.so)
set -euo pipefail
cd "$(dirname "$0")"
out="$(realpath -m "${1:-bin/claude-quota.so}")"
mkdir -p "$(dirname "$out")"
if [ "$(go env GOARCH)" = amd64 ]; then
	export GOAMD64="${GOAMD64:-v1}" CGO_CFLAGS="${CGO_CFLAGS:--march=x86-64}"
fi
mode="${CLAUDE_QUOTA_MODE:-shadow}"
case $mode in
shadow) tags="" ;;
live) tags=claude_quota_live ;;
*) echo "build.sh: CLAUDE_QUOTA_MODE must be shadow or live, not $mode" >&2; exit 2 ;;
esac
CGO_ENABLED=1 go build -buildmode=c-shared -trimpath ${tags:+-tags "$tags"} -o "$out" .
rm -f "${out%.*}.h"
if [ "$mode" = live ]; then
	for s in 'credentials/fields' 'routing/cooldown/reset' 'reset_rate_limits'; do
		grep -aqF "$s" "$out" || { echo "build.sh: live build $out lacks $s" >&2; exit 1; }
	done
	echo "$out"
	exit 0
fi
if grep -aqE 'credentials/fields|routing/cooldown/reset' "$out"; then
	echo "build.sh: $out contains a gateway write path; a shadow build must not" >&2
	exit 1
fi
if grep -aqE 'reset_rate_limits|api\.day\.app|api\.resend\.com' "$out"; then
	echo "build.sh: $out contains the claim endpoint or a Bark or Resend host; a shadow build must not" >&2
	exit 1
fi
echo "$out"
