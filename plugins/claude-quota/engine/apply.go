package engine

import (
	"context"
	"sort"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/rules"
)

// loaded is one auth file as read right before the writes.
type loaded struct {
	acct gateway.Account
	err  error
}

// applyRouting sets each account's excluded_models, in the order and with the safeguards of the Python
// service's _apply_routing. It returns the limits it planned with.
//
// Accounts in limits whose auth file is gone, unreadable or disabled are dropped first, so they never count
// as a fallback. Writes that free an account go first; if one fails, no write in this run adds the Opus/Sonnet
// reservation, so a failed swap never leaves both models excluded everywhere. Accounts named in stale keep
// their Fable exclusion and lose the Opus/Sonnet reservation (fail open); the caller passes only accounts
// that loaded, are enabled, and are not in limits.
func applyRouting(ctx context.Context, w Writer, logf Logf, limits map[string]rules.Limits, accounts map[string]loaded, stale []string) map[string]rules.Limits {
	planned := make(map[string]rules.Limits, len(limits))
	current := make(map[string][]string, len(limits)+len(stale))
	for name, lim := range limits {
		a, ok := accounts[name]
		switch {
		case !ok:
			logf("%s: left out of routing, auth file is gone", name)
		case a.err != nil:
			logf("%s: left out of routing, auth file unreadable: %v", name, a.err)
		case !a.acct.Disabled:
			planned[name] = lim
			current[name] = a.acct.ExcludedModels
		}
	}
	wanted := rules.Plan(planned)
	for _, name := range stale {
		acct := accounts[name].acct
		current[name], wanted[name] = acct.ExcludedModels, rules.WithoutReserved(acct.ExcludedModels)
	}
	freed := true
	for _, c := range rules.Changes(current, wanted) {
		acct := accounts[c.Name].acct
		if c.AddsReserved && !freed {
			logf("%s: excluded_models %s not added: a write that frees an account failed", acct.Label, models(c.To))
			continue
		}
		if err := w.SetExcludedModels(ctx, acct, c.From, c.To); err != nil {
			logf("%s: excluded_models not set: %v", acct.Label, err)
			freed = freed && c.AddsReserved
		}
	}
	return planned
}

// healCooldowns clears gateway cooldowns that the usage reads of the accounts in heal prove stale, as the Python
// service's _heal_cooldowns does. Only accounts still planned are checked; it returns the ones it checked.
func healCooldowns(ctx context.Context, w Writer, logf Logf, creds map[string]gateway.Credential, credErr error,
	planned map[string]rules.Limits, accounts map[string]loaded, heal []string, now time.Time) []string {
	if credErr != nil {
		logf("cooldown check skipped: %v", credErr)
		return nil
	}
	names := append([]string(nil), heal...)
	sort.Strings(names)
	var checked []string
	for _, name := range names {
		lim, ok := planned[name]
		if !ok {
			continue
		}
		checked = append(checked, name)
		cred := creds[name]
		stale := rules.StaleCooldowns(lim, cred.Cooldowns, now)
		if len(stale) == 0 {
			continue
		}
		acct := accounts[name].acct
		if cred.AuthIndex == "" {
			logf("%s: gateway cooldown until %s is stale, not cleared: the gateway does not list this auth file",
				acct.Label, stale[0].RetryAt.UTC().Format(time.RFC3339))
			continue
		}
		if err := w.ResetCooldown(ctx, acct, cred.AuthIndex, "stale until "+stale[0].RetryAt.UTC().Format(time.RFC3339)); err != nil {
			logf("%s: gateway cooldown not cleared: %v", acct.Label, err)
		}
	}
	return checked
}
