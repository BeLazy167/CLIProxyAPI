# claude-quota

A CLIProxyAPI plugin that decides which Claude models each Claude account serves, from each account's own quota.
It replaces the routing half of the Python `claude-reset` service (`~/fleet/services/claude-reset`) and keeps its
rules and safeguards. The reset alerts, offers and Claim page are not here yet.

This build runs in **shadow mode only**. It reads usage, plans, and logs each write it would make. It sends no write
to the gateway. The mode is compiled in: the write calls exist only under the `claude_quota_live` build tag, and
`build.sh` refuses an output that contains a write path.

## What it does

- Every `interval` (default 15 min) it reads each `claude-*.json` auth file and calls
  `GET <usage_base>/api/oauth/usage?cedar_ember=1&skip_spend=1` with that account's token.
- It plans each account's `excluded_models` with the rules in `rules/` (a port of `routing.py`):
  - An account at 100% Fable or 100% weekly gets `["claude-fable-*"]`.
  - If some such account still has 10% or more weekly left and a readable five-hour window under 100%, the accounts
    that still have Fable get `["claude-opus-*", "claude-sonnet-*"]`. Otherwise nothing is reserved.
- It writes in the order and with the safeguards of the Python `_apply_routing` and `_heal_cooldowns`:
  - Removed, unreadable or disabled accounts, and accounts whose usage read failed, are left out of the plan.
  - Writes that free an account go first. If one fails, no write in that run adds the Opus/Sonnet reservation.
  - It writes only on change.
  - It resets a gateway cooldown only when every future cooldown on that credential is a stale quota cooldown.
- It also re-plans at each window's reported reset time, and after a quota 429 the gateway reports through the usage
  hook. An account is read at most once per `min_read_gap` (at least 5 min unless the usage server is on loopback).
  A read the gap holds back runs once the gap passes. The last read attempt per account is kept in
  `<state_dir>/claude-quota.last-try.json`, so the gap holds across a reconfigure and a handoff between loaded copies.
- Before each plan it checks every cached account again: an account whose auth file is now unreadable, disabled, or
  has a token that expires within a minute is left out, as in the Python service.
- Fail open: once an account has no usage read newer than `stale_after` (45 min), or when the engine stops, it
  releases the Opus/Sonnet reservation. Fable exclusions stay.
- One goroutine owns all engine state and handles every trigger in turn. Each plan has a generation number.
- Each loaded copy runs its engine only while it holds an exclusive `flock` on `<state_dir>/claude-quota.lock`. When
  the host keeps an old copy loaded after a hot reload, only one engine runs.

In shadow mode each skipped write is one log line in the gateway log:

```
claude-quota: shadow: <account email> excluded_models <current> -> <wanted>
claude-quota: shadow: <account email> cooldown reset (stale until <time>)
```

Health: `GET /v0/management/plugins/claude-quota/health` (management key required). It reports mode, state
(`running`, `waiting for lock`, `stopped`), last cycle, generation, and each account's limit age.

## Config

```yaml
plugins:
  configs:
    claude-quota:
      enabled: true
      mode: shadow                       # the only mode this build accepts
      interval: 15m
      management_base: http://127.0.0.1:8317            # must be loopback
      management_key_file: ~/.config/claude-reset/cpa-mgmt.key
      state_dir: ~/.local/state/claude-reset
      auth_dir: ~/.cli-proxy-api
      usage_base: https://api.anthropic.com
      user_agent: claude-cli/2.1.321 (external, cli)
      stale_after: 45m
      min_read_gap: 5m                   # below 5m only against a usage server on loopback
      reset_grace: 1m                    # read this long after a window's reset time
      lock_retry: 10s
```

Every key except `enabled` has the default shown. Unknown keys are an error.

For the shadow run, set `interval: 30m`. The Python service still polls every account every 15 minutes, and 30m
halves the extra usage reads the plugin adds on top.

## Build

The plugin is its own Go module, so the gateway's `go test ./...` does not include it.

```bash
plugins/claude-quota/build.sh [OUTPUT]    # default plugins/claude-quota/bin/claude-quota.so
```

## Tests

Run these from `plugins/claude-quota`:

```bash
go vet ./... && go test ./...                              # rules, engine, plugin lifecycle at the RPC boundary
python3 -I -B test/differential.py                         # Go vs the Python rules on 6000 random cases
go test -tags e2e -count=1 -timeout 20m ./test/            # real gateway + built .so + fake usage server
```

`rules/FAILURES.md` and `rpc/FAILURES.md` list the failure cases that the tests are named after.
