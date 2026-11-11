# This fork

`belazy/CLIProxyAPI` on git.blzy.app (GitHub copy `BeLazy167/CLIProxyAPI`) is a fork of
[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). It builds the AI gateway that runs on the mini PC
behind https://gw.blzy.app. The ops repo (`/work/ops` on the mini PC) builds, deploys and checks it.

The fork adds files and avoids editing upstream files, so taking an upstream release stays a cheap merge. Fork-only files:

| Path | What it is |
|---|---|
| `FORK.md` | This file. |
| `Makefile` | `make release`, the build that deploys use. |
| `.forgejo/workflows/fork-ci.yml` | Fork CI, run by the mini PC Forgejo runner. |
| `scripts/ci/` | The CI checks, runnable locally. |

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
   flaky and it does not count.

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
tag itself. A release directory holds `bin/cliproxyapi`. Later steps add `plugins/linux/amd64/claude-quota.so` and
`static/management.html`, each as a new target in the Makefile's `RELEASE_PARTS`. The symlink
`/work/deploy/cliproxyapi/current` names the running release, and the systemd drop-in runs `current/bin/cliproxyapi`.

Config, auth files and plugins stay outside releases. The gateway reads the single plugin directory
`~/.cli-proxy-api/plugins`, because third-party plugins keep their data under `plugins/data/`. Fork plugins will be symlinks
there that point through `current/`, so they switch with the release. The third-party `.so` files are pinned by
checksum in the ops repo (`deploy/cliproxyapi.plugins`).

A deploy passes its health check only when the gateway answers a client key, every pinned plugin registered in this
process's log and matches its checksum, no unpinned `.so` is present, and one small request each to Claude and Codex
succeeds. A failed check switches back to the previous release.

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
