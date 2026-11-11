# claude-quota

A CLIProxyAPI plugin that decides which Claude models each Claude account serves, from each account's own quota,
and alerts when a Claude reset grant is worth using, with a Claim page and a claim route for the quota panel.
It replaces the Python `claude-reset` service (`~/fleet/services/claude-reset`) and keeps its rules and safeguards.

The mode is compiled in. Three builds exist:

| Build | Tags | Routing writes | Claims, Bark, email | `state.json` |
|---|---|---|---|---|
| shadow (default, `build.sh`) | none | logged only | logged only; sent to no host at all | read only |
| e2e (tests only) | `claude_quota_e2e` | logged only | sent only to loopback | read and written |
| live | `claude_quota_live` | sent to the gateway | sent (HTTPS anywhere, plain HTTP to loopback only) | read and written |

Each build accepts only its own `mode` in the config (`shadow`, `e2e`, `live`), so a test build started with the
live config refuses to run. The gateway write calls and the claim endpoint exist only in the builds that send them,
and `build.sh` refuses a default `.so` that holds a gateway write path, the claim endpoint, or a Bark or Resend host.
The default build never writes `state.json`: the Python service owns it until cutover.

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
- At gateway boot the plugin starts before the gateway's HTTP server listens, so the start cycle's credentials read
  fails. It then reads the credentials again after 2 s, 5 s and 15 s (no new usage reads), until one read works, and
  checks the cooldowns of the accounts the start cycle read.
- Fail open: once an account has no usage read newer than `stale_after` (45 min), or when the engine stops, it
  releases the Opus/Sonnet reservation. Fable exclusions stay.
- One goroutine owns all engine state and handles every trigger in turn. Each plan has a generation number.
- Each loaded copy runs its engine only while it holds an exclusive `flock` on `<state_dir>/claude-quota.lock`. When
  the host keeps an old copy loaded after a hot reload, only one engine runs.

Without `claude_quota_live` each skipped routing write is one log line in the gateway log:

```
claude-quota: shadow: <account email> excluded_models <current> -> <wanted>
claude-quota: shadow: <account email> cooldown reset (stale until <time>)
claude-quota: shadow: <account email> cooldown reset (after a reset claim)
```

## Reset alerts and claims

This is a port of the Python service's `decide.py`, `_offer`, `_claim` and `_finish`. Its 146-check e2e suite runs
against the plugin (`test/claim/`). On every usage read the engine:

- settles an UNKNOWN claim on the account as DONE when the grant's count dropped (a read-only check; nothing is
  re-sent on its own);
- sends one "schema changed" Bark alert per unreadable grant or response;
- offers a grant when it clears a window at 90% or more (`threshold_pct`) that resets on its own more than 24 h
  away (`min_reset_hours`), choosing the grant that clears the fewest windows, then the one that ends first;
  and when a grant expires within 7 days or 24 hours (`expiry_alert_hours`). One alert per dedupe key: the
  near-limit key holds the reset time rounded to the hour, so Claude's sub-second jitter does not alert again.

An offer is stored only after its Bark push lands. The push links to `<public_base>/offer/<token>`; the state file
holds sha256(token), never the token. Each offer is bound to the account's `organization_uuid`. The claim guards,
the panel's choice of offer, the settling of lost replies and sibling expiry tell accounts apart by that
organization (by the auth file for an offer not bound yet). The email in `label` can change and is only shown.

A tap runs on the engine goroutine, so taps from the page and the panel never overlap. In order it checks: offer
known, OFFERED or UNKNOWN, not expired, no other claim on the account SENDING or UNKNOWN, no Claude cooldown,
auth file in the auth dir, account enabled, the auth file still holds the offer's organization, token fresh; a
fresh status read; for an UNKNOWN offer whose count dropped, DONE without sending; still worth using; for a new
near-limit attempt, no narrower grant now eligible for its window (refused, never swapped; an UNKNOWN retry
re-sends its first request as Python did). Then the "before" email (no email, no claim), SENDING saved, the claim
POST with the request ID, and the result: UNKNOWN on a timeout, 5xx or unknown reply; OFFERED on a refusal,
`cooldown` or `unavailable`; DONE on `reset`, which expires sibling offers, resets the gateway cooldown, plans the
routing again from the post-claim read, and sends the "after" email (Bark when the email fails).

At start, before the first cycle, SENDING offers become UNKNOWN, and open offers made before the organization
binding (by the Python service) are bound to the organization their auth file holds then.

The state file is `<state_dir>/state.json`, with the same keys (`csrf_key`, `offers`, `sent`, `stale`), the same
offer fields (plus `org` and `key`, which Python ignores), the same offer IDs, nonces and dedupe keys as Python's
`store.py`, written byte for byte as Python writes it (`json.dump(indent=1, sort_keys=True)`), by temp file, rename
and a sync of the directory. Unknown keys are kept. A rollback to
the Python service reads what the plugin wrote.

## Routes

All need the management key; the gateway checks it.

| Route | Caller |
|---|---|
| `GET /v0/management/plugins/claude-quota/health` | deploy health check |
| `GET /v0/management/plugins/claude-quota/offer?token=<token>` | the Bark link, through Caddy |
| `POST /v0/management/plugins/claude-quota/offer/claim?token=<token>` (form `nonce`) | the Claim button, through Caddy |
| `POST /v0/management/plugins/claude-quota/claim` (JSON `{"auth_index", "grant_id"}`) | the quota panel |

The page sends `Referrer-Policy: same-origin` (a form POST under `no-referrer` carries `Origin: null`),
`Cache-Control: no-store`, `X-Frame-Options: DENY` and a CSP that allows no script. The page claim needs the
configured Origin (`public_base`'s scheme and host), the offer's nonce, a body of at most 4 KB, and at most one
token, the same in the query and the form. The panel claim uses an open offer for the grant (an UNKNOWN one
first), or makes one from a fresh read when the grant is what an alert would offer, then runs the same tap.
It makes no offer for an alert the account already used: one an offer of the account holds after a claim was sent
for it (SENDING, UNKNOWN, DONE, CLOSED) or after it expired, or an expiry reminder for a grant claimed since the
reminder's threshold began. An OFFERED offer sent nothing, so it uses nothing: the panel can claim the narrower grant
the page points to. An offer's alert is its dedupe key without the email (offers made by the plugin store it as
`key`); for an offer the Python service made it is rebuilt from the offer's window and reset, or its grant, end and
threshold. Offers of another organization with the same email never count. An alert is not sent again while it is in
the `sent` map (Python's dedupe) or an offer of the account holds it, so a tap queued behind a claim never spends a
second reset and an email change repeats no alert.
It answers `{"message", "offer_id", "state"}` with the tap's status code.

`caddy/reset.caddy` rewrites `https://gw.blzy.app/reset/offer/<token>` and `.../claim` to the two offer routes,
moves the token into the query, and adds the management key for exactly those two paths. It is not installed.

Health reports mode, state (`running`, `waiting for lock`, `stopped`), last cycle, generation, and each account's
limit age.

## Config

```yaml
plugins:
  configs:
    claude-quota:
      enabled: true
      mode: shadow                       # the only mode this build accepts (e2e and live builds: e2e, live)
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
      public_base: https://gw.blzy.app/reset            # Bark links and the Origin a claim must carry
      bark_bases: []                     # live build: [http://127.0.0.1:8099, https://api.day.app]
      bark_key_file: ~/.config/bark/key
      resend_base: ""                    # live build: https://api.resend.com
      resend_key_file: ~/.config/claude-reset/resend.key
      email_from: ""                     # e2e and live builds: required, for example alerts@example.com
      email_to: ""                       # e2e and live builds: required, for example you@example.com
      threshold_pct: 90
      min_reset_hours: 24
      expiry_alert_hours: [168, 24]
      stale_token_alert_hours: 2
```

Every key except `enabled` has the default shown. Unknown keys are an error. No email address is built in: a build
that sends (e2e, live) refuses to start without `email_from` and `email_to`. `usage_base` serves the usage reads
and the claims. The Bark and Resend key files are read at each send and never logged; a build that sends refuses
to start when either is missing or empty.

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
go vet ./... && go test ./...                              # rules, engine, offers, plugin lifecycle at the RPC boundary
go test -tags claude_quota_e2e ./offers/                   # the e2e build sends to loopback only
python3 -I -B test/differential.py                         # Go vs the Python rules on 6000 random cases
go test -tags e2e -count=1 -timeout 20m ./test/            # routing: real gateway + built .so + fake usage server
python3 -I -B test/claim/e2e.py                            # offers and claims: see test/claim/README.md
go run ./cmd/replay --now 2026-11-11T13:00:00+00:00 test/claim/fixtures/nov11-*.json   # rules over saved reads
```

The `offers` tests run Python's own `store.py` and `decide.py` (`test/claim/reference/`): the state file round
trips byte for byte both ways, offer IDs and nonces match, and decide and still_valid give the same output on the
real 2026-11-09 and 2026-11-11 reads and on each shape the e2e builds.

`rules/FAILURES.md`, `rpc/FAILURES.md` and `offers/FAILURES.md` list the failure cases that the tests are named after.
