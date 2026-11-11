// Package engine decides and applies model routing for the gateway's Claude accounts, and drives the offers.
//
// One goroutine (Run) owns all engine state and handles every trigger in turn: the interval poll, a
// window's natural reset time, a quota 429 seen by the gateway, and each claim tap. That goroutine is the
// engine's one lock, so usage reads for an account never overlap, plans are applied in generation order,
// and claims run one at a time, as the Python service's CLAIM_LOCK made them.
package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"slices"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/offers"
	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/rules"
)

// Config holds the engine settings, validated by the caller.
type Config struct {
	AuthDir   string
	UsageBase string
	UserAgent string
	// Interval is the poll period.
	Interval time.Duration
	// MinReadGap is the least time between two usage reads of one account.
	MinReadGap time.Duration
	// StaleAfter is how old an account's last good read may get before its Opus/Sonnet reservation is released.
	StaleAfter time.Duration
	// ResetGrace is how long after a window's reported reset time the engine reads again.
	ResetGrace time.Duration
	// LastTryFile keeps each account's last usage read attempt, so MinReadGap holds across a restart or a
	// handoff to another loaded copy. Only the engine holding the state dir lock runs, so one writer at a time.
	LastTryFile string
	// StateFile is the offers state file shared with the Python service.
	StateFile string
	Offers    offers.Config
	Send      offers.SendConfig
}

// Status is the engine state the health route reports.
type Status struct {
	Mode       string
	LastCycle  time.Time
	Generation uint64
	// LastGoodRead is each auth file's newest readable usage read; zero means none since the engine started.
	LastGoodRead map[string]time.Time
	// Planned lists the auth files in the newest plan.
	Planned []string
}

type entry struct {
	limits rules.Limits
	readAt time.Time
}

// Engine is created by New and driven by Run.
type Engine struct {
	cfg  Config
	gw   *gateway.Client
	w    Writer
	read func(context.Context, gateway.Account) ([]byte, error)
	logf Logf
	now  func() time.Time
	hits chan string
	jobs chan func()

	stopped   chan struct{}
	closeOnce sync.Once

	status atomic.Pointer[Status]
	offers *offers.Service

	cache    map[string]entry
	lastTry  map[string]time.Time
	lastGood map[string]time.Time
	pending  map[string]bool
	idOf     map[string]string
	started  time.Time
	gen      uint64
}

// New builds an engine that reads usage over HTTP and writes through w.
func New(cfg Config, gw *gateway.Client, w Writer, logf Logf) *Engine {
	client := &http.Client{Timeout: 20 * time.Second}
	e := &Engine{
		cfg: cfg, gw: gw, w: w, logf: logf, now: time.Now,
		hits:     make(chan string, 64),
		jobs:     make(chan func()),
		stopped:  make(chan struct{}),
		cache:    map[string]entry{},
		lastTry:  map[string]time.Time{},
		lastGood: map[string]time.Time{},
		pending:  map[string]bool{},
		idOf:     map[string]string{},
	}
	e.read = func(ctx context.Context, acct gateway.Account) ([]byte, error) {
		return readUsage(ctx, client, cfg.UsageBase, cfg.UserAgent, acct.Token)
	}
	e.offers = offers.New(cfg.Offers, offers.NewStore(cfg.StateFile), offers.NewSender(cfg.Send, logf), offers.Hooks{
		ReadUsage:  func(ctx context.Context, acct gateway.Account) ([]byte, error) { return e.read(ctx, acct) },
		AfterReset: e.afterReset,
	}, logf)
	e.status.Store(&Status{Mode: Mode})
	return e
}

// statusError is a usage read answered with a status other than 200.
type statusError struct{ code int }

func (s statusError) Error() string { return fmt.Sprintf("HTTP %d", s.code) }

func readUsage(ctx context.Context, client *http.Client, base, userAgent, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/oauth/usage?cedar_ember=1&skip_spend=1", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, cause(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, statusError{resp.StatusCode}
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

// Status returns the newest published engine state.
func (e *Engine) Status() *Status {
	return e.status.Load()
}

// QuotaHit reports a 429 the gateway got for a credential, by auth ID or auth index. It never blocks.
func (e *Engine) QuotaHit(id string) {
	select {
	case e.hits <- id:
	default:
	}
}

// Offers is the engine's offers service. Its page methods only read and may run on any goroutine.
func (e *Engine) Offers() *offers.Service {
	return e.offers
}

// Do runs job on the engine goroutine and waits for it to finish. It reports false, without running job,
// when the engine stops or does not take the job within wait (it is not running yet, or busy that long).
func (e *Engine) Do(job func(), wait time.Duration) bool {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	done := make(chan struct{})
	select {
	case e.jobs <- func() { defer close(done); job() }:
		<-done
		return true
	case <-e.stopped:
	case <-timer.C:
	}
	return false
}

// Close marks the engine stopped, so Do stops waiting for it. Run calls it on the way out; the owner calls
// it when Run never started.
func (e *Engine) Close() {
	e.closeOnce.Do(func() { close(e.stopped) })
}

// PanelClaim claims grantID on the credential the gateway lists under authIndex. Run it inside Do.
func (e *Engine) PanelClaim(authIndex, grantID string) (offers.Result, string) {
	ctx := context.Background()
	creds, err := e.gw.Credentials(ctx)
	if err != nil {
		return offers.Result{Code: http.StatusBadGateway, Message: fmt.Sprintf("Could not read the gateway's credentials (%v). Nothing was claimed.", err)}, ""
	}
	names, _ := gateway.AuthFiles(e.cfg.AuthDir)
	for name, c := range creds {
		if c.AuthIndex == authIndex && slices.Contains(names, name) {
			return e.offers.PanelClaim(ctx, name, grantID)
		}
	}
	return offers.Result{Code: http.StatusNotFound, Message: "No Claude auth file has this auth_index. Nothing was claimed."}, ""
}

// afterReset runs after a claim result "reset": it clears the gateway's cooldown for the account and plans
// again at once from the post-claim read, so a Fable reset is usable without waiting for a cycle.
func (e *Engine) afterReset(ctx context.Context, acct gateway.Account, usageAfter any) string {
	line := e.resetAfterClaim(ctx, acct)
	if usageAfter == nil {
		return line
	}
	raw, _ := json.Marshal(usageAfter)
	if lim, ok := rules.ReadLimits(raw); ok {
		e.cache[acct.Name] = entry{limits: lim, readAt: e.now()}
		e.lastGood[acct.Name] = e.now()
	} else {
		delete(e.cache, acct.Name)
		e.logf("%s: routing skipped, no readable weekly or Fable percent", acct.Label)
	}
	if all, err := gateway.AuthFiles(e.cfg.AuthDir); err == nil {
		e.apply(ctx, "claim reset", all, nil)
	}
	return line
}

func (e *Engine) resetAfterClaim(ctx context.Context, acct gateway.Account) string {
	creds, err := e.gw.Credentials(ctx)
	if err != nil {
		return fmt.Sprintf("gateway cooldown not cleared: %v", err)
	}
	idx := creds[acct.Name].AuthIndex
	if idx == "" {
		return "gateway cooldown not cleared: the gateway does not list this auth file"
	}
	if err := e.w.ResetCooldown(ctx, acct, idx, "after a reset claim"); err != nil {
		return fmt.Sprintf("gateway cooldown not cleared: %v", err)
	}
	if Mode == "shadow" {
		return "gateway cooldown reset is logged only (shadow routing writer)"
	}
	return "gateway cooldown cleared"
}

// Run plans at once, then on every trigger until ctx ends. On the way out it releases the Opus/Sonnet
// reservations, so a stopped engine never leaves those models held back.
func (e *Engine) Run(ctx context.Context) {
	defer e.Close()
	e.started = e.now()
	e.loadLastTry()
	e.offers.Recover()
	e.cycle(ctx, "start", nil)
	poll := time.NewTicker(e.cfg.Interval)
	defer poll.Stop()
	for ctx.Err() == nil {
		var wake <-chan time.Time
		at, timed := e.nextWake()
		timer := time.NewTimer(time.Until(at))
		if timed {
			wake = timer.C
		}
		select {
		case <-ctx.Done():
		case <-poll.C:
			e.cycle(ctx, "poll", nil)
		case <-wake:
			e.cycle(ctx, "window reset or quota 429", e.dueNames(e.now()))
		case id := <-e.hits:
			e.noteHit(id)
		case job := <-e.jobs:
			job()
		}
		timer.Stop()
	}
	stop, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	e.releaseAll(stop)
}

func (e *Engine) noteHit(id string) {
	name, ok := e.idOf[id]
	if !ok {
		return
	}
	if !e.pending[name] {
		e.logf("%s: quota 429 seen; usage read due at %s", name,
			maxTime(e.now(), e.lastTry[name].Add(e.cfg.MinReadGap)).UTC().Format(time.RFC3339))
	}
	e.pending[name] = true
}

// dueAt is when an account needs a read outside the poll: a pending read (after a 429, or one the read gap
// held back), or once a window it reported has reset.
func (e *Engine) dueAt(name string) (time.Time, bool) {
	var at time.Time
	found := false
	if e.pending[name] {
		at, found = e.lastTry[name], true
	}
	if c, ok := e.cache[name]; ok {
		for _, r := range c.limits.ResetsAt {
			if r.After(c.readAt) && (!found || r.Add(e.cfg.ResetGrace).Before(at)) {
				at, found = r.Add(e.cfg.ResetGrace), true
			}
		}
	}
	return maxTime(at, e.lastTry[name].Add(e.cfg.MinReadGap)), found
}

func (e *Engine) nextWake() (time.Time, bool) {
	var next time.Time
	found := false
	for _, name := range e.knownNames() {
		if at, ok := e.dueAt(name); ok && (!found || at.Before(next)) {
			next, found = at, true
		}
	}
	return next, found
}

func (e *Engine) dueNames(now time.Time) []string {
	out := []string{}
	for _, name := range e.knownNames() {
		if at, ok := e.dueAt(name); ok && !at.After(now) {
			out = append(out, name)
		}
	}
	return out
}

func (e *Engine) knownNames() []string {
	set := map[string]bool{}
	for name := range e.cache {
		set[name] = true
	}
	for name := range e.pending {
		set[name] = true
	}
	out := make([]string, 0, len(set))
	for name := range set {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// cycle reads usage for the named accounts (every account when names is nil), then plans and writes.
func (e *Engine) cycle(ctx context.Context, why string, names []string) {
	e.offers.ExpireOffered(e.now())
	all, err := gateway.AuthFiles(e.cfg.AuthDir)
	if err != nil {
		e.logf("cycle skipped: auth dir: %v", err)
		return
	}
	for _, m := range []map[string]time.Time{e.lastTry, e.lastGood} {
		for name := range m {
			if !slices.Contains(all, name) {
				delete(m, name)
			}
		}
	}
	for name := range e.cache {
		if !slices.Contains(all, name) {
			delete(e.cache, name)
		}
	}
	if names == nil {
		names = all
	}
	var readNow []string
	for _, name := range names {
		if ctx.Err() != nil {
			return
		}
		if !slices.Contains(all, name) {
			delete(e.pending, name)
			continue
		}
		if e.readOne(ctx, name) {
			readNow = append(readNow, name)
		}
	}
	if ctx.Err() == nil {
		e.apply(ctx, why, all, readNow)
	}
}

// readOne refreshes one account's limits. It reports whether a usage read succeeded. An account held back
// only by the read gap stays pending, so it is read once the gap passes; any other skip ends the pending read.
func (e *Engine) readOne(ctx context.Context, name string) bool {
	now := e.now()
	acct, err := gateway.LoadAccount(e.cfg.AuthDir, name)
	delete(e.pending, name)
	switch {
	case err != nil:
		e.logf("skip %s: %v", name, err)
		return false
	case acct.Disabled:
		return false
	case !acct.TokenFresh(now):
		e.logf("%s: token stale, skipped", acct.Label)
		e.offers.TokenStale(ctx, acct, now)
		return false
	case now.Before(e.lastTry[name].Add(e.cfg.MinReadGap)):
		e.pending[name] = true
		return false
	}
	e.lastTry[name] = now
	if err := e.saveLastTry(); err != nil {
		// Without a saved read time a reload would read again inside the gap, so no read happens until saving
		// works again. Limits then go stale and the stale rule releases the Opus/Sonnet reservations.
		e.logf("read gap state not saved, %s not read: %v", acct.Label, err)
		return false
	}
	body, err := e.read(ctx, acct)
	if err != nil {
		delete(e.cache, name)
		e.logf("%s: usage read failed: %v", acct.Label, err)
		var se statusError
		if errors.As(err, &se) && (se.code == http.StatusUnauthorized || se.code == http.StatusForbidden) {
			e.offers.TokenStale(ctx, acct, now)
		}
		return false
	}
	if !e.offers.Observe(ctx, acct, body, now) {
		delete(e.cache, name)
		return false
	}
	lim, ok := rules.ReadLimits(body)
	if !ok {
		delete(e.cache, name)
		e.logf("%s: routing skipped, no readable weekly or Fable percent", acct.Label)
		return false
	}
	e.cache[name] = entry{limits: lim, readAt: e.now()}
	e.lastGood[name] = e.now()
	return true
}

func (e *Engine) loadLastTry() {
	raw, err := os.ReadFile(e.cfg.LastTryFile)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err == nil {
		err = json.Unmarshal(raw, &e.lastTry)
	}
	if err != nil {
		e.lastTry = map[string]time.Time{}
		e.logf("read gap state not loaded, every account is read now: %v", err)
		return
	}
	now := e.now()
	for name, at := range e.lastTry {
		if at.After(now) { // the clock moved back since the save; wait at most one gap
			e.lastTry[name] = now
		}
	}
}

func (e *Engine) saveLastTry() error {
	raw, err := json.Marshal(e.lastTry)
	tmp := e.cfg.LastTryFile + ".tmp"
	if err == nil {
		err = os.WriteFile(tmp, raw, 0o600)
	}
	if err == nil {
		err = os.Rename(tmp, e.cfg.LastTryFile)
	}
	return err
}

func (e *Engine) loadAll(names []string) map[string]loaded {
	out := make(map[string]loaded, len(names))
	for _, name := range names {
		acct, err := gateway.LoadAccount(e.cfg.AuthDir, name)
		out[name] = loaded{acct: acct, err: err}
	}
	return out
}

func (e *Engine) apply(ctx context.Context, why string, all, readNow []string) {
	now := e.now()
	accounts := e.loadAll(all)
	limits := map[string]rules.Limits{}
	var stale []string
	for _, name := range all {
		a := accounts[name]
		if a.err != nil || a.acct.Disabled || !a.acct.TokenFresh(now) {
			delete(e.cache, name)
		}
		if c, ok := e.cache[name]; ok && now.Sub(c.readAt) <= e.cfg.StaleAfter {
			limits[name] = c.limits
			continue
		}
		since := maxTime(e.lastGood[name], e.started)
		if a.err == nil && !a.acct.Disabled && now.Sub(since) > e.cfg.StaleAfter &&
			rules.Changed(a.acct.ExcludedModels, rules.WithoutReserved(a.acct.ExcludedModels)) {
			e.logf("fail-open: %s has no usage read newer than %s; releasing its Opus/Sonnet reservation", a.acct.Label, e.cfg.StaleAfter)
			stale = append(stale, name)
		}
	}
	e.gen++
	planned := applyRouting(ctx, e.w, e.logf, limits, accounts, stale)
	for name := range limits {
		if _, ok := planned[name]; !ok {
			delete(e.cache, name)
		}
	}
	creds, credErr := e.gw.Credentials(ctx)
	e.mapIDs(all, creds, credErr)
	healCooldowns(ctx, e.w, e.logf, creds, credErr, planned, accounts, readNow, now)
	e.publish(now, planned)
	e.logf("plan %d (%s): %d accounts planned, %d read, %d left out", e.gen, why, len(planned), len(readNow), len(all)-len(planned))
}

// mapIDs maps the IDs a usage record names to auth file names. The gateway's auth ID for a file is its name;
// the auth index comes from the newest credentials read, or the one before when this read failed.
func (e *Engine) mapIDs(all []string, creds map[string]gateway.Credential, credErr error) {
	ids := map[string]string{}
	for id, name := range e.idOf {
		if credErr != nil && slices.Contains(all, name) {
			ids[id] = name
		}
	}
	for name, c := range creds {
		if slices.Contains(all, name) {
			ids[c.ID], ids[c.AuthIndex] = name, name
		}
	}
	for _, name := range all {
		ids[name] = name
	}
	delete(ids, "")
	e.idOf = ids
}

// releaseAll drops the Opus/Sonnet reservation from every enabled account. Fable exclusions stay.
func (e *Engine) releaseAll(ctx context.Context) {
	all, err := gateway.AuthFiles(e.cfg.AuthDir)
	if err != nil {
		e.logf("fail-open skipped: auth dir: %v", err)
		return
	}
	accounts := e.loadAll(all)
	var stale []string
	for _, name := range all {
		if a := accounts[name]; a.err == nil && !a.acct.Disabled {
			stale = append(stale, name)
		}
	}
	e.logf("fail-open: engine stopping; releasing every Opus/Sonnet reservation")
	applyRouting(ctx, e.w, e.logf, nil, accounts, stale)
}

func (e *Engine) publish(now time.Time, planned map[string]rules.Limits) {
	s := &Status{Mode: Mode, LastCycle: now, Generation: e.gen, LastGoodRead: map[string]time.Time{}}
	for name, t := range e.lastGood {
		s.LastGoodRead[name] = t
	}
	for name := range planned {
		s.Planned = append(s.Planned, name)
		if _, ok := s.LastGoodRead[name]; !ok {
			s.LastGoodRead[name] = time.Time{}
		}
	}
	sort.Strings(s.Planned)
	e.status.Store(s)
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func cause(err error) error {
	type unwrapper interface{ Unwrap() error }
	if u, ok := err.(unwrapper); ok && u.Unwrap() != nil {
		return u.Unwrap()
	}
	return err
}
