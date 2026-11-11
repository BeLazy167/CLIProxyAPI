"""Pure decision rules for Claude reset grants. No I/O.

Input is the JSON from GET /api/oauth/usage?cedar_ember=1&skip_spend=1.
"""

import datetime as dt
import math
from dataclasses import dataclass

FABLE_WINDOW = "seven_day_overage_included"


@dataclass
class Candidate:
    kind: str  # "near_limit" or "expiring"
    key: str  # dedupe key, one alert per key
    grant_id: str
    clears: list
    window: str | None
    window_reset: str | None
    pct: int | None
    expires_at: str  # when an offer for this candidate stops being claimable
    title: str
    body: str


def parse_time(s):
    """Parse an ISO time; return an aware datetime or None."""
    if not isinstance(s, str) or not s:
        return None
    try:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def find_limit(usage, kind, model=None):
    """Return the `limits[]` entry of this kind (and scoped model display name), or None."""
    limits = usage.get("limits")
    for lim in limits if isinstance(limits, list) else []:
        if not isinstance(lim, dict) or lim.get("kind") != kind:
            continue
        scope = lim.get("scope")
        m = scope.get("model") if isinstance(scope, dict) else None
        if (m.get("display_name") if isinstance(m, dict) else None) == model:
            return lim
    return None


def window_reset(usage, window):
    """Return the natural reset time of a window, or None if it cannot be mapped."""
    if window == FABLE_WINDOW:
        lim = find_limit(usage, "weekly_scoped", "Fable")
        return parse_time(lim.get("resets_at")) if lim else None
    if window in ("seven_day", "five_hour"):
        w = usage.get(window)
        return parse_time(w.get("resets_at")) if isinstance(w, dict) else None
    return None


def grants(usage):
    ce = usage.get("cedar_ember")
    if not isinstance(ce, dict) or ce.get("eligible") is not True or not isinstance(ce.get("grants"), list):
        return []
    return [g for g in ce["grants"] if isinstance(g, dict)]


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_pct(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def well_formed(usage, g):
    """True if every field the rules read has the expected type and every cleared window maps."""
    clears, pct = g.get("clears"), g.get("percent_used")
    return (isinstance(g.get("id"), str) and is_int(g.get("resets_left"))
            and isinstance(g.get("usable_now"), bool) and isinstance(g.get("paused", False), bool)
            and parse_time(g.get("ends_at")) is not None and isinstance(pct, dict)
            and isinstance(clears, list) and len(clears) > 0
            and all(isinstance(w, str) and window_reset(usage, w) is not None
                    and is_pct(pct.get(w)) for w in clears))


def find_grant(usage, grant_id):
    for g in grants(usage):
        if g.get("id") == grant_id:
            return g
    return None


def is_live(g, now):
    """True if the grant has a reset left and is inside its start/end dates."""
    starts, ends = parse_time(g.get("starts_at")), parse_time(g.get("ends_at"))
    left = g.get("resets_left")
    return (isinstance(left, int) and left > 0 and not g.get("paused")
            and (starts is None or starts <= now) and ends is not None and now < ends)


def window_ok(usage, g, window, now, cfg):
    """Check the near-limit rule for one window of a well-formed grant. Return (ok, pct, reset)."""
    pct = g["percent_used"].get(window)
    reset = window_reset(usage, window)
    if not is_pct(pct):
        return False, None, reset
    ok = bool(g.get("usable_now")) and pct >= cfg["threshold_pct"] and reset - now > dt.timedelta(hours=cfg["min_reset_hours"])
    return ok, int(pct), reset


def decide(label, usage, now, cfg):
    """Return (candidates, problems) for one account.

    Args:
        label: account label used in keys and messages.
        usage: usage JSON with the cedar_ember block.
        now: aware datetime.
        cfg: dict with threshold_pct, min_reset_hours, expiry_alert_hours.

    Returns:
        candidates: alerts worth sending (dedupe is the caller's job).
        problems: short strings for grants the rules could not read.
    """
    near, out, problems = {}, [], []
    ce = usage.get("cedar_ember")
    if not isinstance(ce, dict) or not isinstance(ce.get("eligible"), bool) or (ce["eligible"] and not isinstance(ce.get("grants"), list)):
        return [], [f"{label}: usage response has no readable cedar_ember block"]
    for g in grants(usage):
        if not well_formed(usage, g):
            problems.append(f"{label}: grant {g.get('id')!r} has fields or windows the rules cannot read: clears={g.get('clears')!r}")
            continue
        gid, clears = g["id"], g["clears"]
        if not is_live(g, now):
            continue
        ends = parse_time(g["ends_at"])
        for w in clears:
            ok, pct, reset = window_ok(usage, g, w, now, cfg)
            if not ok:
                continue
            best = near.get(w)
            # The grant that clears the fewest windows, then the one that ends first, so a
            # Fable-only limit never spends a grant that would also clear the weekly limit.
            if best is None or (len(clears), ends) < (len(best[0]["clears"]), parse_time(best[0]["ends_at"])):
                near[w] = (g, pct, reset)
        for hours in sorted(cfg["expiry_alert_hours"]):  # only the nearest threshold that applies
            if ends - now <= dt.timedelta(hours=hours):
                left = ends - now
                out.append(Candidate(
                    kind="expiring", key=f"{label}|expiring-{hours}h|{gid}|{g['ends_at']}", grant_id=gid, clears=list(clears),
                    window=clears[0], window_reset=None, pct=None, expires_at=ends.isoformat(),
                    title=f"Claude reset expires in {_human(left)}",
                    body=f"{label}: grant {gid} ({g.get('label', '')}) expires {ends:%b %d %H:%M} UTC. "
                         f"Windows it clears: {window_status(usage, g)}." + ("" if g.get("usable_now") else " It is blocked right now."),
                ))
                break
    for w, (g, pct, reset) in near.items():
        exp = min(reset - dt.timedelta(hours=cfg["min_reset_hours"]), parse_time(g["ends_at"]))
        out.append(Candidate(
            kind="near_limit", key=f"{label}|near|{w}|{_nearest_hour(reset).isoformat()}", grant_id=g["id"], clears=list(g["clears"]), window=w,
            window_reset=reset.isoformat(), pct=pct, expires_at=exp.isoformat(),
            title=f"Claude {_window_name(w)} limit {pct}% used",
            body=f"{label}: tap to use reset {g['id']}. Normal reset in {_human(reset - now)}.",
        ))
    return out, problems


def still_valid(offer, usage, now, cfg):
    """Re-check an offer against live data right before a claim. Return (ok, reason)."""
    g = find_grant(usage, offer["grant_id"])
    if g is None or not well_formed(usage, g) or not is_live(g, now):
        return False, "the grant is gone, used up or no longer readable"
    if not g.get("usable_now"):
        return False, f"the grant is not usable now ({g.get('unavailable_reason') or 'blocked'})"
    if offer["kind"] == "near_limit":
        res = window_ok(usage, g, offer["window"], now, cfg)
        if not res[0]:
            return False, f"the {_window_name(offer['window'])} limit is at {res[1]}% or resets soon"
    return True, ""


def window_status(usage, g):
    """Describe each window a well-formed grant clears, with its percent used and natural reset."""
    return "; ".join(f"{_window_name(w)} {int(g['percent_used'][w])}% used, resets {window_reset(usage, w):%b %d %H:%M} UTC"
                     for w in g["clears"])


def window_pct(usage, grant_id, window):
    g = find_grant(usage, grant_id)
    pu = g.get("percent_used") if g else None
    v = pu.get(window) if isinstance(pu, dict) else None
    return int(v) if is_pct(v) else None


def resets_left(usage, grant_id):
    """The grant's resets_left, or None if the grant is missing or unreadable."""
    g = find_grant(usage, grant_id)
    v = g.get("resets_left") if g else None
    return v if is_int(v) else None


def _window_name(w):
    return {"seven_day": "weekly", "five_hour": "session", FABLE_WINDOW: "Fable weekly"}.get(w, w or "")


def _nearest_hour(t):
    """Claude reports one reset as 11:59:59.888, 11:59:59.925 or 12:00:00.073 on different reads."""
    return (t + dt.timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)


def _human(td):
    h = int(td.total_seconds() // 3600)
    return f"{h // 24} d {h % 24} h" if h >= 24 else f"{h} h"
