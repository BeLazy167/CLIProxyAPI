# Routing rules: failure list

Written before `rules.go`. Each line is one way the rules could fail. `rules_test.go` names each case by its number.
Lines 1 to 20 carry over `routing_rules()` in the Python service's `e2e.py` and the failure lists in fleet commits
`4316b0d`, `fdef5db` and `0a726f0`. Lines 21 onward are new for the Go port.

## Reading limits

1. `limits` missing, not a list, or holding non-objects is read as limits instead of unreadable.
2. No `weekly_all` entry, or no Fable `weekly_scoped` entry, is read as limits instead of unreadable.
3. A percent that is a bool, a string, null or out of float range counts as a number.
4. Fable at 100 or weekly at 100 is not "out of Fable", or 99.9 is.
15. (read part) A null or missing `five_hour` does not read as 0; a `five_hour` that is not an object, or has no numeric
    `utilization`, does not read as unreadable.
21. A body that is not a JSON object is read as limits.
22. A `weekly_all` entry whose scope names a model counts as the account-wide weekly limit; or a later entry wins over
    the first matching one.
23. A scoped entry counts as Fable when its display name is not exactly `Fable` (case, `id` instead of `display_name`).
24. A whole-number percent (`54`) and a fractional one (`54.0`, `90.5`) read differently from the same value.
25. A window's `resets_at` that is missing or unparseable makes the account unreadable, instead of only giving no
    reset time.

## Planning

5. Opus/Sonnet are not reserved at exactly 10% weekly left, or are reserved at 9.5%.
6. No Fable-out account with weekly room, yet Opus/Sonnet are reserved.
7. Every account is Fable-out, yet Opus/Sonnet are reserved, or Fable is not excluded everywhere.
8. A single account gets an exclusion.
9. Haiku is ever excluded.
11. An account that was not read counts as a fallback. (Planning sees only read accounts; covered in the engine.)
19. A Fable-out account whose five-hour window is at 100% or unreadable counts as the Opus/Sonnet fallback; or one
    at 99.9% does not.
26. An empty input plans anything.
27. A percent above 100 or below 0 breaks the arithmetic (weekly 150 is out; weekly -5 has 105% left).

## Comparing lists

10. The same set in another order, or with a repeat, counts as a change; null and `[]` differ; a real change does not
    count.
28. A change that newly excludes Opus or Sonnet is not flagged as adding a reservation, or a change that keeps or
    removes them is.
29. Fail-open removes anything other than the two reserved patterns, keeps either of them, or leaves an empty list
    instead of null.

## Stale cooldowns

12. A cooldown whose `retry_at` is in the past counts.
13. A `retry_at` with nanoseconds and `Z`, or with an offset, does not parse.
14. Weekly at 100 still clears a cooldown.
15. (cooldown part) Five-hour at 100 or unreadable still clears a cooldown.
16. A Fable model cooldown clears while Fable is at 100; or an Opus model cooldown is kept then.
17. No cooldowns (empty list, null, not a list) returns something.
18. A non-quota reason clears.
20. One cooldown that may still be right does not keep every cooldown on the credential; or a past one does.
30. A cooldown entry that is not an object, or whose `retry_at` is missing, a number, a naive time or garbage, is
    treated as stale.
31. A `retry_at` equal to now counts as future.
32. `credential_quota` does not count as a quota reason, or a reason that is not a string does.
33. A model key `claude-fable` (no dash) or one that is not a string counts as a Fable cooldown.
