package offers

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/plugins/claude-quota/gateway"
)

// Store is the state file the Python service also reads and writes (~/.local/state/claude-reset/state.json):
// {"csrf_key": hex, "offers": {offer_id: offer}, "sent": {dedupe key: time}, "stale": {label: time}}.
// Keys this code does not know, at any level, are kept as they are. Only the engine goroutine of the copy
// that holds the state dir lock writes it; page reads may run beside it.
type Store struct {
	path string
	mu   sync.Mutex
}

// NewStore opens the state file at path; it need not exist yet.
func NewStore(path string) *Store {
	return &Store{path: path}
}

// State is one decoded state file.
type State struct {
	doc map[string]any
}

// Offer is one offer record, as Python stores it. It shares storage with its State.
type Offer map[string]any

func decodeState(raw []byte) (map[string]any, error) {
	var doc map[string]any
	if err := decodePy(raw, &doc); err != nil || doc == nil {
		return nil, fmt.Errorf("state file is not a JSON object: %v", err)
	}
	return doc, nil
}

func encodeState(doc map[string]any) []byte {
	return encodePy(doc)
}

// load reads the file and fills in what store.py's _load fills in. Caller holds mu.
func (s *Store) load() (*State, error) {
	raw, err := os.ReadFile(s.path)
	doc := map[string]any{}
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if doc, err = decodeState(raw); err != nil {
			return nil, err
		}
	}
	for _, k := range []string{"offers", "sent"} {
		if _, ok := doc[k].(map[string]any); !ok {
			doc[k] = map[string]any{}
		}
	}
	if _, ok := doc["csrf_key"].(string); !ok {
		key := make([]byte, 32)
		_, _ = rand.Read(key)
		doc["csrf_key"] = hex.EncodeToString(key)
	}
	return &State{doc: doc}, nil
}

// Read returns a fresh copy of the state.
func (s *Store) Read() (*State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

// Update loads the state, applies fn and saves the result (temp file, fsync, rename), as store.py's tx does,
// then syncs the directory so the rename survives a power loss. An error means the change may not be durable:
// the claim path stops before its POST. A build that does not own the state file (writesState false) applies
// fn to a copy and saves nothing.
func (s *Store) Update(fn func(*State)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.load()
	if err != nil {
		return err
	}
	fn(st)
	if !writesState {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(encodeState(st.doc))
	if err == nil {
		err = f.Sync()
	}
	if errClose := f.Close(); err == nil {
		err = errClose
	}
	if err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(s.path))
	if err != nil {
		return err
	}
	err = dir.Sync()
	if errClose := dir.Close(); err == nil {
		err = errClose
	}
	return err
}

func (st *State) CSRFKey() string {
	return st.doc["csrf_key"].(string)
}

// Offers maps offer ID to offer; changes write through to the state.
func (st *State) Offers() map[string]Offer {
	raw := st.doc["offers"].(map[string]any)
	out := make(map[string]Offer, len(raw))
	for id, o := range raw {
		if m, ok := o.(map[string]any); ok {
			out[id] = m
		}
	}
	return out
}

// AddOffer stores a new offer.
func (st *State) AddOffer(id string, o Offer) {
	st.doc["offers"].(map[string]any)[id] = map[string]any(o)
}

// Sent maps each alert's dedupe key to when it was sent.
func (st *State) Sent() map[string]any {
	return st.doc["sent"].(map[string]any)
}

// Stale maps an account label to when its token was first seen expired or rejected; created on first use,
// as Python's setdefault does.
func (st *State) Stale() map[string]any {
	m, ok := st.doc["stale"].(map[string]any)
	if !ok {
		m = map[string]any{}
		st.doc["stale"] = m
	}
	return m
}

func (o Offer) str(key string) string {
	s, _ := o[key].(string)
	return s
}

func (o Offer) State() string    { return o.str("state") }
func (o Offer) Kind() string     { return o.str("kind") }
func (o Offer) Label() string    { return o.str("label") }
func (o Offer) GrantID() string  { return o.str("grant_id") }
func (o Offer) Window() string   { return o.str("window") }
func (o Offer) AuthFile() string { return o.str("auth_file") }
func (o Offer) Org() string      { return o.str("org") }

func (o Offer) ExpiresAt() (time.Time, bool) { return parseTime(o["expires_at"]) }

// Clears is the windows the offer's grant clears; an old offer without the list clears its own window.
func (o Offer) Clears() []string {
	list, ok := o["clears"].([]any)
	if !ok || len(list) == 0 {
		return []string{o.Window()}
	}
	out := make([]string, 0, len(list))
	for _, w := range list {
		s, _ := w.(string)
		out = append(out, s)
	}
	return out
}

func (o Offer) snapshot() map[string]any {
	m, _ := o["snapshot"].(map[string]any)
	return m
}

// record is the offer Python's _offer stores for this candidate, bound to the account's organization.
func (c Candidate) record(authFile string, acct gateway.Account, now time.Time) Offer {
	f := c.pythonFields()
	return Offer{
		"label": acct.Label, "auth_file": authFile, "org": acct.Org, "kind": c.Kind, "grant_id": c.GrantID,
		"clears": c.Clears, "window": c.Window, "window_reset": f["window_reset"], "pct_at_alert": f["pct"],
		"expires_at": c.ExpiresAt, "created_at": isoformat(now), "state": "OFFERED", "title": c.Title,
	}
}

// OfferID is the offer's key in the state file: sha256 of the token, so the file never holds a token.
func OfferID(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Nonce is the CSRF nonce for one offer, as claude_reset.nonce_for derives it.
func Nonce(csrfKey, offerID string) string {
	key, _ := hex.DecodeString(csrfKey)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(offerID))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

const tokenAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

// NewToken has the shape of secrets.token_urlsafe(32): 43 URL-safe characters, 258 random bits.
func NewToken() string {
	b := make([]byte, 43)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = tokenAlphabet[b[i]&63]
	}
	return string(b)
}

func newRequestID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// short is the first 8 characters of an offer ID, for log lines.
func short(id string) string {
	return id[:min(8, len(id))]
}
