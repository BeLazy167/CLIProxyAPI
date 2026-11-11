# Offers, Claim page and panel claim: failure list

Written before `offers/` and the claim routes. Lines 1 to 40 carry over the Python `claude-reset` service: its e2e
scenarios (`test/claim/e2e.py`, moved from fleet) and the failure lists in fleet commits `b8aafd6`, `4316b0d`,
`fdef5db` and `0a726f0`. Lines 41 onward are new for the plugin. The e2e names the scenario that covers each line;
`offers/*_test.go` covers the lines marked (unit).

## Alerts

1. A near-limit grant alerts more than once for one window and reset, including when Claude reports the reset time
   with a different fraction of a second on each read. (`s_near_limit_alert_once`, `s_jittered_reset_one_alert`)
2. A window under 90%, a window that resets on its own within 24 h, a blocked grant, a grant not started yet, or a
   used-up grant alerts. (`s_below_threshold_and_near_reset_no_alert`)
3. Two grants for one window give two alerts, or the later-ending one is offered. (`s_two_grants_one_offer`)
4. A Fable-only limit offers a grant that also clears the weekly limit. (`s_fable_only_limit_offers_narrow_grant`,
   replay of the 2026-11-11 fixtures)
5. An expiring grant gets no alert, more than one alert per threshold, or the 7-day alert inside 24 h.
   (`s_expiry_alerts`)
6. An expiring alert and offer page do not state each cleared window's percent used and natural reset time.
   (`s_expiring_offer_shows_windows`)
7. A grant or response the rules cannot read (unmapped window, missing `cedar_ember`, string `eligible`, string bool,
   bool or infinite percent, empty percent map, unreadable window or limits) gets an offer instead of one "schema
   changed" alert, or stops the other accounts. (`s_schema_problem_isolated`, `s_malformed_fields_fail_closed`)
8. A failed Bark push stores an offer, or is not retried on the next cycle. (`s_bark_fail_retries`)
9. A token that is expired is used for a usage read; a token rejected with 401 or 403 for more than
   `stale_token_alert_hours` sends no alert. (`s_expired_token_skipped`, `s_revoked_token_alerts`)

## Page and claim route guards

10. A GET claims, emails or changes state. (`s_get_is_read_only_and_post_guards`)
11. The page lacks `Cache-Control: no-store` or `Referrer-Policy: same-origin` (a browser form POST under
    `no-referrer` carries `Origin: null`). (`s_get_is_read_only_and_post_guards`, `s_real_browser_claim`)
12. A POST with a wrong nonce, another Origin, `Origin: null`, or an unknown token claims. (`s_get_is_read_only_and_post_guards`)
13. After a failed POST the page posts the retry somewhere other than the same public claim URL.
    (`s_retry_form_action_absolute`)
14. A real browser tap sends `Origin: null` or claims more than once. (`s_real_browser_claim`)
15. The plugin turned off still claims or alerts. (`s_off_switch`)
16. A config typo or a bad interval leaves the old engine running unnoticed. (`s_config_typo_exits`, `s_bad_interval_exits`)
17. A disabled account claims. (`s_disabled_account_refused`)

## Claim state machine

18. A claim sends no `program`, `grant_id` or `request_id`, or sends no before email first, or no after email.
    (`s_happy_claim`)
19. The before email fails and the claim is still sent, or the offer does not go back to OFFERED. (`s_before_email_fails_no_claim`)
20. The after email fails and the result is lost (no Bark fallback), including on a protocol error from Resend.
    (`s_after_email_fails_bark_fallback`, `s_email_protocol_error_bark_fallback`)
21. Eight parallel taps send more than one claim. (`s_concurrent_taps`)
22. Two offers for one grant (near-limit and expiring), tapped in parallel, spend twice. (`s_two_offers_same_grant_concurrent`)
23. A lost reply after the spend is not settled to DONE from a status read, or is re-sent. (`s_lost_response_after_spend`)
24. A lost reply with no spend is re-sent on its own, or a re-tap gets a new request_id. (`s_lost_response_no_spend_retry_same_id`)
25. A tap after the window fell below the threshold claims. (`s_late_tap_refused`)
26. A `cooldown` answer leaves the offer unusable, or a later tap spends twice. (`s_cooldown_back_to_offered`)
27. A 2xx reply without a known result counts as done or as refused instead of UNKNOWN. (`s_malformed_claim_reply_unknown`)
28. A grant missing from a later status read confirms a lost claim. (`s_missing_grant_not_confirmed`)
29. An expired UNKNOWN offer is re-sent. (`s_expired_unknown_no_resend`)
30. A crash while SENDING leaves the offer SENDING, or the restart re-sends instead of settling from a status read.
    (`s_crash_in_sending_recovers`)
31. A sibling offer on an account with an UNKNOWN claim can be claimed. (`s_sibling_after_lost_reply_refused`)
32. After a grant that clears two windows is claimed, the other window's offer can still be claimed.
    (`s_multi_window_grant_siblings_expire`)
33. A string `eligible: "false"` lets a claim through. (`s_string_eligible_blocks_claim`)
34. A log line, the state file or an email holds an OAuth token, the Bark key, the Resend key, the management key or
    an offer token. (`s_no_secrets_in_logs`)

## After a claim

35. A `reset` result leaves the gateway cooldown in place, or the page and after email do not say what happened to
    it; a gateway that is down turns a done claim into an error. (`s_claim_clears_gateway_cooldown`,
    `s_claim_gateway_down_still_done`)
36. After a Fable reset the routing waits for the next cycle, or reads other accounts. (`s_claim_reroutes_now`)
37. An account removed since the last cycle still counts as the fallback after a claim.
    (`s_removed_account_is_no_fallback_after_claim`)

## Routing seen from the claim suite

38. The routing cases of the Python suite (`s_routing_*`, `routing_rules`) change meaning in the plugin. They run
    against the plugin's shadow writer log and the Go rules tests.
39. The 2026-11-09 and 2026-11-11 real responses give other alerts or routes than the Python replay printed.
    (`replay_live_fixtures`, (unit) `TestReplayFixtures`)
40. The gateway being down stops alerts. (`s_routing_gateway_down_alerts_still_work`)

## New for the plugin

41. (unit) The plugin writes `state.json` in a form Python's `store.py` reads differently, or rewrites a file Python
    wrote with other bytes: key order, indent, separators, non-ASCII escapes, floats (`95.0`, `1e-05`, `1e+16`),
    `-0`, null versus a missing key, unknown keys at any level.
42. (unit) The plugin derives another offer ID from a token, or another nonce from the CSRF key, than Python does, so
    old links or open pages stop working.
43. (unit) The plugin's dedupe keys differ from Python's (near-limit key with the reset rounded to the hour in the
    reset's own offset; expiring key with the raw `ends_at`), so a carried-over `sent` map alerts again.
44. Recovery at start does not turn SENDING into UNKNOWN, or runs before this copy holds the state lock, so it
    rewrites an offer another loaded copy is still claiming. (`s_crash_in_sending_recovers`, `s_hot_reload_during_claim`)
45. An offer whose auth file now holds another `organization_uuid` claims on the new organization.
    (`s_replaced_auth_file_refused`)
46. A near-limit offer for a wider grant claims after a narrower grant became eligible for its window, or the claim
    swaps to the narrower grant on its own. (`s_stale_wider_offer_refused`)
47. An expiring offer is refused by the narrowest-grant check or the threshold. (`s_expiring_offer_shows_windows`)
48. The panel and the page tapped at the same time spend twice. (`s_panel_and_page_at_once`)
49. A lost reply from one interface is re-sent from the other with a new request_id, or not refused while unknown.
    (`s_lost_reply_then_other_interface`)
50. A hot reload during a claim sends the claim twice, leaves it SENDING, or runs two engines.
    (`s_hot_reload_during_claim`)
51. A natural window reset with every account excluded waits for the poll. (`s_natural_reset_every_account_excluded`)
52. A usage read failing while Fable swaps counts the unread account as the fallback.
    (`s_read_fails_during_swap`)
53. The state file the plugin wrote is not read by Python's `store.py` as written. (`s_python_reads_plugin_state`)
54. (unit) A build without `claude_quota_live` sends a claim, Bark push or email to a host that is not loopback,
    including through a redirect from a loopback server; the default build sends to loopback too; or a real sender
    is linked into the default build. `build.sh` refuses a default `.so` that holds the claim path or the Bark or
    Resend host.
55. The default build writes `state.json` (Python owns it until cutover) or answers a claim with anything but a
    refusal.
56. The claim route accepts a body over 4 KB, a token in the query and another in the form, or a claim without the
    management key. Caddy adds the management key to any path other than the two offer paths.
    (`s_get_is_read_only_and_post_guards`, `s_caddy_paths`)
57. A tap that arrives while this copy waits for the state lock blocks forever. (`s_hot_reload_during_claim`)
58. A legacy offer (made by Python, no `org`) cannot be claimed, or is bound to an organization other than the one
    in its auth file when the plugin first loads it. (unit `TestBindLegacyOffers`)

## Review round (GPT 6.1 Sol)

59. (unit) The SENDING record and its request ID are not durable before the claim POST: the rename's directory entry
    is not synced, or a failed sync still lets the claim go out.
60. (unit) A usage body or state file with data after the first JSON value is accepted, where Python refuses it.
61. A panel tap after the page claimed a grant (queued behind it, or later) makes a new offer from a candidate that
    claim used up, and spends a second reset: the same expiry reminder, or the unsent reminder of the same grant.
    The reverse order spends twice. (`s_panel_after_page_claim_spends_once`)
62. An account is told apart by its email, so after an email change (same organization, same auth file) an UNKNOWN
    claim no longer blocks other claims, the panel sends it with a new request_id, a status read no longer settles
    it, and a DONE claim no longer expires the offers made under the new email.
    (`s_email_change_keeps_the_claim_on_the_account`)
