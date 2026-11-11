#!/usr/bin/env bash
# Builds the claude-quota plugin (shadow mode) as a c-shared library and checks that it carries no gateway write
# path, no claim endpoint and no Bark or Resend host.
# Usage: plugins/claude-quota/build.sh [OUTPUT]   (default: plugins/claude-quota/bin/claude-quota.so)
set -euo pipefail
cd "$(dirname "$0")"
out="$(realpath -m "${1:-bin/claude-quota.so}")"
mkdir -p "$(dirname "$out")"
if [ "$(go env GOARCH)" = amd64 ]; then
	export GOAMD64="${GOAMD64:-v1}" CGO_CFLAGS="${CGO_CFLAGS:--march=x86-64}"
fi
CGO_ENABLED=1 go build -buildmode=c-shared -trimpath -o "$out" .
rm -f "${out%.*}.h"
if grep -aqE 'credentials/fields|routing/cooldown/reset' "$out"; then
	echo "build.sh: $out contains a gateway write path; a shadow build must not" >&2
	exit 1
fi
if grep -aqE 'reset_rate_limits|api\.day\.app|api\.resend\.com' "$out"; then
	echo "build.sh: $out contains the claim endpoint or a Bark or Resend host; a shadow build must not" >&2
	exit 1
fi
echo "$out"
