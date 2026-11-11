// Package engine decides and applies model routing for the gateway's Claude accounts.
//
// One goroutine (Run) owns all engine state and handles every trigger in turn: the interval poll, a
// window's natural reset time, and a quota 429 seen by the gateway. That goroutine is the engine's one
// lock, so usage reads for an account never overlap and plans are applied in generation order.
package engine

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sort"
	"sync/atomic"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
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

	status atomic.Pointer[Status]

	cache    map[string]entry
	lastTry  map[string]time.Time
	lastGood map[string]time.Time
	hit      map[string]bool
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
		cache:    map[string]entry{},
		lastTry:  map[string]time.Time{},
		lastGood: map[string]time.Time{},
		hit:      map[string]bool{},
		idOf:     map[string]string{},
	}
	e.read = func(ctx context.Context, acct gateway.Account) ([]byte, error) {
		return readUsage(ctx, client, cfg.UsageBase, cfg.UserAgent, acct.Token)
	}
	e.status.Store(&Status{Mode: Mode})
	return e
}

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
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
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

// Run plans at once, then on every trigger until ctx ends. On the way out it releases the Opus/Sonnet
// reservations, so a stopped engine never leaves those models held back.
func (e *Engine) Run(ctx context.Context) {
	e.started = e.now()
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
	if !e.hit[name] {
		e.logf("%s: quota 429 seen; usage read due at %s", name,
			maxTime(e.now(), e.lastTry[name].Add(e.cfg.MinReadGap)).UTC().Format(time.RFC3339))
	}
	e.hit[name] = true
}

// dueAt is when an account needs a read outside the poll: after a 429, or once a window it reported has reset.
func (e *Engine) dueAt(name string) (time.Time, bool) {
	var at time.Time
	found := false
	if e.hit[name] {
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
	var out []string
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
	for name := range e.hit {
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
			delete(e.hit, name)
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

// readOne refreshes one account's limits. It reports whether a usage read succeeded.
func (e *Engine) readOne(ctx context.Context, name string) bool {
	now := e.now()
	acct, err := gateway.LoadAccount(e.cfg.AuthDir, name)
	switch {
	case err != nil:
		delete(e.cache, name)
		e.logf("skip %s: %v", name, err)
		return false
	case acct.Disabled:
		delete(e.cache, name)
		return false
	case !acct.TokenFresh(now):
		delete(e.cache, name)
		e.logf("%s: token stale, skipped", acct.Label)
		return false
	case now.Before(e.lastTry[name].Add(e.cfg.MinReadGap)):
		return false
	}
	e.lastTry[name] = now
	delete(e.hit, name)
	body, err := e.read(ctx, acct)
	if err != nil {
		delete(e.cache, name)
		e.logf("%s: usage read failed: %v", acct.Label, err)
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
		if c, ok := e.cache[name]; ok && now.Sub(c.readAt) <= e.cfg.StaleAfter {
			limits[name] = c.limits
			continue
		}
		a := accounts[name]
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
	if credErr == nil {
		e.idOf = map[string]string{}
		for name, c := range creds {
			if slices.Contains(all, name) {
				e.idOf[name], e.idOf[c.ID], e.idOf[c.AuthIndex] = name, name, name
			}
		}
		delete(e.idOf, "")
	}
	healCooldowns(ctx, e.w, e.logf, creds, credErr, planned, accounts, readNow, now)
	e.publish(now, planned)
	e.logf("plan %d (%s): %d accounts planned, %d read, %d left out", e.gen, why, len(planned), len(readNow), len(all)-len(planned))
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
