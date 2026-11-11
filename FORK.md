# This fork

`belazy/CLIProxyAPI` on git.blzy.app (GitHub copy `BeLazy167/CLIProxyAPI`) is a fork of
[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). It builds the AI gateway that runs on the mini PC
behind https://gw.blzy.app. The ops repo (`/work/ops` on the mini PC) builds, deploys and checks it.

The fork adds files and avoids editing upstream files, so taking an upstream release stays a cheap merge. Fork-only files:

| Path | What it is |
|---|---|
| `FORK.md` | This file. |
| `Makefile` | `make release`, the build that deploys use. |
| `panel/` | The quota panel the gateway serves as `/management.html` (see Panel below). |
| `.forgejo/workflows/fork-ci.yml` | Fork CI, run by the mini PC Forgejo runner. |
| `scripts/ci/` | The CI checks, runnable locally. |

## Outbound traffic and its switches

Besides requests to the AI providers and their login hosts, the gateway makes these requests. None carries prompts,
tokens or usage.

| What | Host | When | Off switch |
|---|---|---|---|
| Panel updater | api.github.com, GitHub release downloads, cpamc.router-for.me | start, every 3 h | `remote-management.disable-auto-update-panel: true`. A missing panel file is still downloaded when someone opens the panel, so the deploy health check requires the release's `static/management.html`. |
| Model catalogs | raw.githubusercontent.com, models.router-for.me | start, every 3 h | the `-local-model` flag, which uses the catalogs built into the binary. The config cannot name the built-in catalogs; a local file path also works. |
| Antigravity and xAI client versions | antigravity-hub-auto-updater-974169037036.us-central1.run.app, registry.npmjs.org | start, every 3 h | `disable-version-updaters: true` (v8 layout: `requests.disable-version-updaters`). Read at start only. |
| Latest-version check, plugin store | api.github.com, raw.githubusercontent.com, GitHub releases | when a panel asks | none. This fork's panel never asks (`panel/tests/gatewayGithubRoutes.test.ts`). |
| Public-IP lookup | api.ipify.org, ifconfig.me, icanhazip.com, ipinfo.io | an OAuth login started from the CLI | none |

`disable-version-updaters` is this fork's only change to upstream files: the field in `internal/config/config.go`, its v8
path in `internal/config/config_v8.go`, and the guards in `cmd/server/main.go` (Antigravity) and
`sdk/cliproxy/service_lifecycle.go` (xAI). With it set, the gateway sends the built-in versions:
`antigravityFallbackVersion` in `internal/misc/antigravity_version.go` and `DefaultXAIFallbackClientVersion` in
`internal/runtime/executor/helps/xai_version.go`. No config key sets the xAI version. To send a newer one, add
`"headers": {"x-grok-client-version": "<v>", "User-Agent": "xai-grok-workspace/<v>"}` to the xAI auth file; these
headers replace the built-in ones.

Third-party plugins make their own requests, which these switches do not cover. The ops repo pins them
(`deploy/cliproxyapi.plugins`).

## Branches

- `main` is what runs. Every change lands through a PR. After a merge, Fork CI runs on `main`, and when it is green
  forge-sync deploys that commit.
- `upstream` holds upstream release tags and nothing else. It only moves by fast-forward to a newer upstream release tag
  (`/work/ops/bin/forge-upstream-pr` does this). Never commit to it.
- `dev` and `legacy` come from upstream's history and are not used. Never target them.

Merge PRs into `main` with a merge commit, never squash or rebase. A merge commit keeps upstream's commits in `main`'s
history, so the next upstream release merges cleanly and CI can tell an upstream merge from other changes.

## CI

Fork CI (`Fork CI / check`) runs on every PR into `main` and on every push to `main`. For a PR it merges the PR head into
`main` and checks the result:

1. `go build ./cmd/server`.
2. `go vet ./...` against a base. It fails only on findings the base does not have, compared as file and message
   without line numbers. Upstream's code already has one (`internal/pluginhost/host_test.go`, copylocks).
3. New outbound URL literals. It lists every `https://` or `wss://` literal in non-test Go files that the change adds over
   `main`. It fails only when one names a host that `main` never named and `scripts/ci/urlcheck/allowed-hosts.txt` does
   not list. Review the calling code, then add the host to that file.
4. Tests against a base. It runs `go test ./...` on the base and on the result, and fails only on tests that fail on the
   result but not on the base. Each suspected test is rerun 5 times on the base first; one failure there marks it as
   flaky and it does not count. A package that fails for more than its failing tests (it does not build, or its test
   binary panics outside a test or exits early) is a failure of its own, which tests failing on the base do not excuse.
   When `go test` exits other than 0 or 1 (killed, for example) or a package never reports a result, the check fails.

The PR job runs code that is not on `main` yet, so it gets no credentials: checkout keeps no token, only the step that
fetches the PR head sees one, and Go's caches for that job live inside the job instead of in the runner's shared caches.

The base for vet and tests is `main` before the change. For an upstream release PR it is the release itself, so findings
and failures that upstream already has do not count.

Run the same checks locally from the repo root. Go and the scripts take `GOCACHE`, `GOTMPDIR` and `TMPDIR` from the
environment; on the mini PC set them to directories under `/work/tmp`, since `/` is small.

```sh
t=$(mktemp -d)
git worktree add --detach "$t/base" main
go build -o "$t/cliproxyapi" ./cmd/server
scripts/ci/vet-baseline.sh "$t/base"
go run ./scripts/ci/urlcheck -base "$t/base" -allow scripts/ci/urlcheck/allowed-hosts.txt
scripts/ci/test-baseline.sh "$t/base" "$t/tests"   # keeps base.json and head.json in $t/tests
git worktree remove "$t/base" && rm -rf "$t"
```

### Upstream's workflows must not run here

Forgejo reads workflows from `.forgejo/workflows` and falls back to `.github/workflows` only when a commit has no
`.forgejo/workflows`. It reads them from the PR head for `pull_request`, from the pushed commit for pushes and tags, and
from `main` for `pull_request_target`. Pure upstream commits, such as the `upstream` branch and upstream tags, have only
`.github/workflows`, so the repo's Actions settings disable upstream's workflow files by name. To disable one, open
`https://git.blzy.app/belazy/CLIProxyAPI/actions?workflow=<file name>` as an admin and choose "Disable workflow" in the menu.
The list of disabled names is `forge/cliproxyapi-disabled-workflows.txt` in the ops repo. `forge-upstream-pr` stops when a
release brings a workflow file that is not on it. Keep `.forgejo/workflows` on `main`. Without it, `pull_request_target`
falls back to upstream's workflows on `main`, and the disabled list does not apply to those.

## Releases

`/work/ops/bin/deploy cliproxyapi <sha>` builds a commit into `/work/deploy/cliproxyapi/releases/<sha>` with

```sh
make release OUT=<release dir> VERSION=<version> COMMIT=<first 8 hex of sha>
```

The version is the newest upstream release tag merged into the commit, with `+<7 hex>` added when the commit is not the
tag itself. `make release` writes `bin/cliproxyapi`, `static/management.html` (the panel) and
`plugins/linux/amd64/claude-quota.so`, each from its own target in the Makefile's `RELEASE_PARTS`. The panel build needs
`bun` on the PATH. The deploy then adds to `plugins/`: copies of the third-party plugins pinned by checksum in the ops
repo (`deploy/cliproxyapi.plugins`), that pins file, and `data`, a symlink to `~/.cli-proxy-api/plugins/data`, where
plugins keep their state. Plugins must be real files: the gateway skips symlinked plugins. The symlink `/work/deploy/cliproxyapi/current` names the
running release, and the systemd drop-in runs `current/bin/cliproxyapi`.

Config and auth files stay outside releases. Once `plugins.dir` in the gateway's config is
`/work/deploy/cliproxyapi/current/plugins` (a prepared change in the ops runbook `runbooks/cliproxyapi-fork.md`), a
release switches the binary and its plugins together. Until then the gateway reads `~/.cli-proxy-api/plugins`.

A deploy passes its health check only when, within 60 seconds, the gateway answers a client key, the plugin directory holds
exactly the pinned plugins with their checksums, each registered in this process's log, one small request each to Claude
and Codex succeeds, and no plugin failed, panicked, or was unloaded or reloaded in this process. A failed restart or check
switches back to the previous release.

## Panel

`panel/` is the quota panel: a React app that Vite builds into one HTML file. It came in as a git subtree of
`belazy/cpamc-ledger` (`main` at `e87b5052`), with its history. `panel/go.mod` exists only to keep `panel/` out of the
gateway's `go build ./...`, `go vet ./...` and `go test ./...`: after `bun install`, `panel/node_modules` holds Go files.
The systemd drop-in in the ops repo points `MANAGEMENT_STATIC_PATH` at `current/static/management.html`, so a release
switches the gateway, its plugins and its panel together.

Its upstreams:

- [philly0105/cpamc-ledger](https://github.com/philly0105/cpamc-ledger), the panel `belazy/cpamc-ledger` forked. It
  carries the history of the next one.
- [router-for-me/Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center),
  upstream's own panel.

This fork's panel differs from them in two ways. The Claude reset button asks the `claude-quota` plugin to claim
(`POST /v0/management/plugins/claude-quota/claim`) instead of claiming from the browser. And it has no latest-version
check and no plugin store, because the gateway answers both by fetching from GitHub.

Panel updates are taken by hand, from the repo root:

```sh
git fetch https://github.com/philly0105/cpamc-ledger.git main
git subtree pull --prefix panel FETCH_HEAD -m "panel: merge philly0105/cpamc-ledger <short sha>"
cd panel && bun install --frozen-lockfile --ignore-scripts && bun run test && bun run lint && bun run build
```

For the Management Center itself, fetch `https://github.com/router-for-me/Cli-Proxy-API-Management-Center.git main`
the same way. A conflict in the Claude reset files or in the plugin store keeps this fork's side. Two panel tests fail
on `e87b5052` already ("provider model options > gates fields by provider capability" and "provider filter overflow >
allocates remaining quota toolbar width without shrinking the sort control").

## Rollback

```sh
ls /work/deploy/cliproxyapi/releases                          # builds kept on disk
/work/ops/bin/deploy cliproxyapi <older sha> --allow-older    # switch, restart, verify the live SHA and health
```

forge-sync deploys `main` again within a minute unless that SHA is the one in `/work/deploy/cliproxyapi/failed`. To hold an
older release, first set the app column of `CLIProxyAPI` to `-` in `/work/ops/forge/repos.d/repos.tsv`.

## Taking an upstream release

1. Every week `forge-upstream-pr.timer` runs `/work/ops/bin/forge-upstream-pr`. When upstream has a release that `main`
   does not contain, it fast-forwards `upstream` to that tag and opens the PR `upstream -> main`, titled with the tag. The
   body lists the release tags since `main`'s last upstream tag, their release notes, and the commit the PR must have.
2. Read the release notes and the Fork CI summary: new outbound hosts and new test failures.
3. If the PR conflicts, merge the tag into a branch from `main`, resolve the conflicts there, and open that branch as the PR
   instead. CI then compares its tests with `main`.
4. Merge with a merge commit. forge-sync deploys `main` when Fork CI is green on it.

For an urgent upstream fix, run `/work/ops/bin/forge-upstream-pr` by hand. It never merges.
