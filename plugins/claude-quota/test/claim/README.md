# Claim e2e

The end-to-end suite of the Python `claude-reset` service (fleet `services/claude-reset`, 146 checks), moved here and
run against the plugin. Each scenario starts:

- `fake_upstream.py`: fake Anthropic (usage and claim), Bark and Resend. It also proxies the plugin's
  `GET /v8/management/credentials` to the real gateway and lays the scenario's cooldowns over the reply.
- a real gateway built from this tree (`go build ./cmd/server`) with the plugin built under `-tags claude_quota_e2e`,
  which sends claims, Bark pushes and emails only to loopback. Any outbound HTTPS from the gateway goes to a dead
  proxy, so a fake token never leaves the machine.
- a private Caddy (`admin off`, its own port and storage) running `../../caddy/reset.caddy` with only the gateway port
  and key path changed, so the phone's URLs (`/reset/offer/<token>`, `/reset/offer/<token>/claim`) take the same path
  as in production.

`browser_claim.cjs` taps Claim in headless Chromium. `reference/` holds the Python service's `store.py` and
`decide.py`; the Go tests in `offers/` and `s_python_reads_plugin_state` check the plugin against them.

```bash
cd plugins/claude-quota
python3 -I -B test/claim/e2e.py                 # every scenario; writes test/claim/e2e-report.txt
python3 -I -B test/claim/e2e.py s_happy_claim   # one scenario
```

Needs Go, Caddy, Python 3.12, Node with `playwright-core` (`PLAYWRIGHT_CORE`, default
`/tmp/bh-render/node_modules/playwright-core`) and a Chromium headless shell (`CHROME_BIN`).

## Checks adapted from the Python suite

The plugin differs from the Python service in four ways, and these checks changed with it. Every other check keeps
its name and its test.

1. The routing writer in every build without `claude_quota_live` logs each write (`shadow: <email> excluded_models
   <from> -> <to>`) instead of sending a PATCH. The routing checks read those lines. Where a Python check looked at
   the auth file after a PATCH, the harness applies the logged writes to the auth files (`apply_shadow_writes`), as
   the live writer's PATCH would, and the check reads the next plan.
   - `s_routing_applies_and_heals`: "PATCH only where the list changes", "auth files hold the wanted lists",
     "second cycle: no PATCH, no heal", "every change logged in one line".
   - `s_routing_no_reserve_clears_old_list`: "old reserve list cleared from the file".
   - `s_routing_busy_fallback_and_partial_heal`, `s_claim_reroutes_now`, `s_removed_account_is_no_fallback_after_claim`.
   - `s_routing_gateway_down_alerts_still_work`: a logging writer cannot fail a PATCH, so the check reads the failed
     credentials read and the logged write.
   - `s_routing_failed_free_skips_reserve`: a logging writer cannot fail. The three checks run
     `test/differential.py`, which compares the Go engine with the Python `_apply_routing` on random cases that
     include failed writes.
2. The plugin has no `routing_enabled` switch. `s_claim_clears_gateway_cooldown` keeps the cycle's own heal away
   with a five-hour window at 100% instead, and its checks read the logged cooldown reset (`after a reset claim`)
   and the page and email line `gateway cooldown reset is logged only (shadow routing writer)`.
3. The off switch and config errors belong to the gateway's plugin host. `s_off_switch` sets `enabled: false`: the
   host unloads the plugin, so the claim route answers 404 instead of 503. `s_config_typo_exits` and
   `s_bad_interval_exits` check that the engine stops and the gateway logs the error, instead of a process exit.
4. The pure-rule and replay checks run the Go code: `routing_rules` maps each numbered Python check to the Go rules
   test with the same number, and `replay_live_fixtures` runs `go run ./cmd/replay`, which prints the same lines
   as `claude_reset.py replay`.

`s_real_browser_claim` checks the Origin of the Caddy URL, and `s_malformed_fields_fail_closed` also asks the
plugin's health route whether the engine still runs.
