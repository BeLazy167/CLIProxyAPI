# Plugin lifecycle and RPC: failure list

Written before `plugin.go` and `config.go`. `plugin_test.go` drives the plugin through the same RPC methods and JSON
the gateway's plugin host sends, and names each case by its number. The e2e in `test/` covers the same ground against
a real gateway process and the built `.so`.

1. A second loaded copy runs its engine while the first still runs, so two engines read and plan.
2. A copy waiting for the lock never starts after the copy holding it stops.
3. Quiesce or shutdown leaves the engine running: usage reads continue afterwards.
4. Register after quiesce (the host's rollback of a failed hot reload) does not restart the engine.
5. Reconfigure with the same config restarts the engine; a changed config does not take effect.
6. Quiesce or shutdown does not release the Opus/Sonnet reservations, or releases a Fable exclusion.
7. A config with any mode other than the build's mode (`shadow`) starts an engine.
8. A management base that is not loopback receives the management key.
9. `min_read_gap` below 5 minutes is accepted against the real Anthropic host.
10. An unknown config key is ignored, so a typo silently keeps a default.
11. A missing or empty management key file starts an engine.
12. A quota 429 for a known credential triggers no usage read; or several 429s trigger more than one read within
    `min_read_gap`.
13. A 429 for a credential the engine does not route, or a non-429 failure, triggers a read.
14. The health route is missing mode, state, last cycle, generation or per-account limit age, or answers another path.
15. A stale quota cooldown or a changed exclusion list sends a request to the management API in shadow.
16. The management key or an OAuth token appears in a log line or in the health reply.
