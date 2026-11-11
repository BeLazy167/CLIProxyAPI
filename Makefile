# Fork release build (FORK.md). The ops deploy script runs: make release OUT=<dir> VERSION=<v> COMMIT=<8 hex>
# A release directory holds bin/cliproxyapi; later parts add plugins/linux/amd64/*.so and static/management.html.
# Each part is its own target in RELEASE_PARTS.
GO ?= go
BUILD_DATE ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
RELEASE_PARTS := release-gateway

.PHONY: release release-args $(RELEASE_PARTS)

release: $(RELEASE_PARTS)

release-args:
	@test -n "$(OUT)" && test -n "$(VERSION)" && echo "$(COMMIT)" | grep -Eqx '[0-9a-f]{8}' || \
		{ echo 'usage: make release OUT=<dir> VERSION=<v> COMMIT=<8 hex>' >&2; exit 2; }

# The build of upstream's release workflow: CGO on, which plugins need, and its three ldflags.
release-gateway: release-args
	mkdir -p "$(OUT)/bin"
	CGO_ENABLED=1 GOOS=linux GOARCH=amd64 $(GO) build -buildvcs=false -trimpath \
		-ldflags "-s -w -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildDate=$(BUILD_DATE)" \
		-o "$(OUT)/bin/cliproxyapi" ./cmd/server
