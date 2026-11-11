"""Differential check: the Go routing port against the Python claude-reset service it replaces.

Generates randomized cases, runs each through the real Python functions in routing.py and the real
_apply_routing and _heal_cooldowns in claude_reset.py (their I/O replaced by recorders), runs the same
cases through the Go engine (go test -run TestDifferential), and fails on any difference.

Usage: python3 -I -B test/differential.py [--cases N] [--seed S] [--python-dir DIR] [--report PATH]
Run from plugins/claude-quota. Exit 0 when every output matches.
"""

import argparse
import datetime as dt
import json
import os
import random
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
UTC = dt.timezone.utc
HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
FABLE = ["claude-fable-*"]
RESERVED = ["claude-opus-*", "claude-sonnet-*"]
LISTS = [None, [], FABLE, RESERVED, list(reversed(RESERVED)), FABLE + RESERVED, ["claude-opus-*"],
         ["claude-sonnet-*", "claude-sonnet-*"], ["x-*"], ["x-*", "claude-opus-*", "claude-sonnet-*"]]
PCTS = [0, 0.0, 5, 9.5, 10, 50, 54.0, 89.5, 90, 90.5, 99, 99.9, 100, 100.0, 120, -5]
NOISE = [None, "50", True, False, "x", [], {}]
MISSING = object()


def ts(now, hours):
    t = now + dt.timedelta(hours=hours)
    return t.strftime("%Y-%m-%dT%H:%M:%S") + ".%09dZ" % random.randrange(10 ** 9)


def offset_ts(now, hours):
    t = (now + dt.timedelta(hours=hours)).astimezone(dt.timezone(dt.timedelta(hours=-6)))
    return t.strftime("%Y-%m-%dT%H:%M:%S") + ".001273778-06:00"


def pick_pct(full=0.0):
    if random.random() < 0.06:
        return random.choice(NOISE)
    if random.random() < full:
        return random.choice([100, 100.0])
    return random.choice(PCTS)


def put(d, key, value):
    if value is not MISSING:
        d[key] = value


def gen_usage(now):
    if random.random() < 0.03:
        return random.choice([{}, {"limits": "x"}, {"limits": ["x", 1, None]}])
    reset = ts(now, random.choice([-2, 0.01, 3, 72]))
    weekly = {"kind": "weekly_all", "group": "weekly", "resets_at": reset, "scope": None}
    put(weekly, "percent", MISSING if random.random() < 0.03 else pick_pct())
    fable_scope = random.choice([{"model": {"display_name": "Fable", "id": None}, "surface": None}] * 40 + [
        {"model": {"display_name": "fable"}}, {"model": {"id": "Fable"}}, None, {"model": None}])
    fable = {"kind": "weekly_scoped", "group": "weekly", "resets_at": random.choice([reset, "soon", None]), "scope": fable_scope}
    put(fable, "percent", MISSING if random.random() < 0.03 else pick_pct(full=0.4))
    limits = [weekly, fable]
    r = random.random()
    if r < 0.03:
        limits.remove(weekly)
    elif r < 0.06:
        limits.remove(fable)
    elif r < 0.09:
        weekly["scope"] = {"model": {"display_name": "Opus"}}
    elif r < 0.14:
        limits.append({"kind": "weekly_all", "percent": pick_pct(), "scope": None})
        limits.append({"kind": "weekly_scoped", "percent": pick_pct(), "scope": {"model": {"display_name": "Fable"}}})
    elif r < 0.25:
        random.shuffle(limits)
    elif r < 0.28:
        limits.insert(0, "x")
    u = {"limits": limits, "seven_day": {"utilization": 50.0, "resets_at": reset}}
    r = random.random()
    if r < 0.35:
        u["five_hour"] = None
    elif r < 0.45:
        pass
    elif r < 0.90:
        u["five_hour"] = {"utilization": random.choice([0, 0.0, 50, 99.9, 100, 100.0, 130]), "resets_at": ts(now, 2)}
    else:
        u["five_hour"] = random.choice([{"resets_at": ts(now, 2)}, {"utilization": None}, {"utilization": "50"}, "x", 5, []])
    return u


def gen_cooldowns(now):
    r = random.random()
    if r < 0.05:
        return random.choice([None, "x", 5])
    out = []
    for _ in range(random.choice([0, 0, 1, 1, 1, 2, 3])):
        if random.random() < 0.04:
            out.append("x")
            continue
        c = {"scope": "credential", "reason": random.choice(["quota", "credential_quota", "credential_quota", "unauthorized", "unknown", "cloudflare_challenge", None, 5])}
        if random.random() < 0.4:
            c["scope"] = "model"
            c["model_key"] = random.choice(["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable", None, 5])
        retry = random.choice(["future", "future", "future", "offset", "past", "now", "missing", "null", "num", "soon", "naive", "empty"])
        put(c, "retry_at", {"future": lambda: ts(now, random.choice([0.5, 5, 80])), "offset": lambda: offset_ts(now, 5),
                            "past": lambda: ts(now, -1), "now": lambda: now.isoformat().replace("+00:00", "Z"),
                            "missing": lambda: MISSING, "null": lambda: None, "num": lambda: 5, "soon": lambda: "soon",
                            "naive": lambda: (now + dt.timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%S"),
                            "empty": lambda: ""}[retry]())
        out.append(c)
    return out


def gen_case(i):
    now = dt.datetime(2026, 11, 11, 13, 0, 0, tzinfo=UTC) + dt.timedelta(minutes=random.randrange(100000))
    accounts = []
    for j in range(random.randint(1, 4)):
        name = f"claude-{'abcd'[j]}.json"
        a = {"name": name, "read_ok": random.random() < 0.9, "usage": gen_usage(now),
             "auth_ok": random.random() < 0.93, "disabled": random.random() < 0.07,
             "excluded_models": random.choice(LISTS), "patch_fails": random.random() < 0.15}
        if random.random() < 0.9:
            a["cred"] = {"auth_index": random.choice([f"idx-{j}"] * 6 + [""]), "cooldowns": gen_cooldowns(now)}
        accounts.append(a)
    pairs = [[random.choice(LISTS), random.choice(LISTS)] for _ in range(3)]
    return {"id": i, "now": now.isoformat(), "accounts": accounts, "creds_fail": random.random() < 0.07, "pairs": pairs}


def run_python(case, mods):
    routing, claude_reset, gateway, claude_api = mods
    now = dt.datetime.fromisoformat(case["now"])
    out = {"limits": {}, "plan": {}, "stale": {}, "writes": [], "skipped": [], "resets": [], "pairs": []}
    limits, read = {}, {}
    for a in sorted(case["accounts"], key=lambda a: a["name"]):
        if not a["read_ok"]:
            continue
        lim = routing.read_limits(a["usage"])
        out["limits"][a["name"]] = None if lim is None else [lim.weekly, lim.fable, lim.five_hour]
        read[a["name"]] = ({"label": a["name"]}, a["usage"])
        if lim is not None:
            limits[a["name"]] = lim
            cooldowns = (a.get("cred") or {}).get("cooldowns")
            out["stale"][a["name"]] = [c.get("retry_at") for c in routing.stale_cooldowns(lim, cooldowns, now)]
    out["plan"] = routing.plan(limits)

    by_name = {a["name"]: a for a in case["accounts"]}

    def load_account(path):
        a = by_name[os.path.basename(path)]
        if not a["auth_ok"]:
            raise ValueError("unreadable")
        return {"label": a["name"], "disabled": a["disabled"], "excluded_models": a["excluded_models"]}

    def set_excluded_models(cfg, name, models):
        out["writes"].append([name, models])
        if by_name[name]["patch_fails"]:
            raise gateway.GatewayError("HTTP 500")

    def credentials(cfg):
        if case["creds_fail"]:
            raise gateway.GatewayError("HTTP 500")
        return {a["name"]: a["cred"] for a in case["accounts"] if "cred" in a}

    def reset_cooldown(cfg, idx):
        out["resets"].append(idx)
        return {"status": "ok"}

    def log(msg):
        if "not added" in msg:
            out["skipped"].append(msg.split(":")[0])

    claude_api.load_account = load_account
    gateway.set_excluded_models, gateway.credentials, gateway.reset_cooldown = set_excluded_models, credentials, reset_cooldown
    claude_reset.log = log
    claude_reset.LIMITS.clear()
    claude_reset.LIMITS.update(limits)
    cfg = {"auth_dir": "/nonexistent"}
    claude_reset._apply_routing(cfg)
    claude_reset._heal_cooldowns(cfg, read, now)
    out["pairs"] = [[routing.changed(c, w), routing.adds_reserved(c, w)] for c, w in case["pairs"]]
    return out


def same(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return float(a) == float(b)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    return a == b


def same_stale(py, go):
    """Python returns the raw retry_at strings; Go returns parsed times. Compare the instants."""
    if py.keys() != go.keys():
        return False
    for name in py:
        if len(py[name]) != len(go[name]):
            return False
        for p, g in zip(py[name], go[name]):
            pt = dt.datetime.fromisoformat(p.replace("Z", "+00:00"))
            if pt != dt.datetime.fromisoformat(g.replace("Z", "+00:00")):
                return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=6000)
    ap.add_argument("--seed", type=int, default=20261111)
    ap.add_argument("--python-dir", default=os.path.expanduser("~/fleet/services/claude-reset"))
    ap.add_argument("--report", default=os.path.expanduser("~/.t3/scratch/2026-11-11-ok-can-you-take-a-f335d50e/plugin/differential-report.txt"))
    a = ap.parse_args()
    sys.path.insert(0, a.python_dir)
    import claude_api
    import claude_reset
    import gateway
    import routing

    random.seed(a.seed)
    cases = [gen_case(i) for i in range(a.cases)]
    py = [run_python(c, (routing, claude_reset, gateway, claude_api)) for c in cases]
    with tempfile.TemporaryDirectory(prefix="cq-diff-") as tmp:
        cases_path, out_path = os.path.join(tmp, "cases.json"), os.path.join(tmp, "go.json")
        with open(cases_path, "w") as f:
            json.dump(cases, f, allow_nan=False)
        env = dict(os.environ, DIFF_CASES=cases_path, DIFF_OUT=out_path)
        run = subprocess.run(["go", "test", "-count=1", "-run", "^TestDifferential$", "./engine/"], cwd=PLUGIN, env=env,
                             capture_output=True, text=True)
        if run.returncode != 0:
            print(run.stdout, run.stderr)
            sys.exit(f"go test failed with exit {run.returncode}")
        with open(out_path) as f:
            go = json.load(f)

    fields = ["limits", "plan", "stale", "writes", "skipped", "resets", "pairs"]
    diffs, coverage = [], {k: 0 for k in ("unreadable limits", "reserved planned", "write attempted", "write failed",
                                          "reserve skipped after failed free", "cooldown reset", "pruned account")}
    for c, p, g in zip(cases, py, go):
        for f in fields:
            ok = same_stale(p[f], g[f]) if f == "stale" else same(p[f], g[f])
            if not ok:
                diffs.append(f"case {c['id']} field {f}: python={json.dumps(p[f])} go={json.dumps(g[f])}")
        coverage["unreadable limits"] += any(v is None for v in p["limits"].values())
        coverage["reserved planned"] += any(v == RESERVED for v in p["plan"].values())
        coverage["write attempted"] += bool(p["writes"])
        coverage["write failed"] += any(c2["patch_fails"] for c2 in c["accounts"] if c2["name"] in {w[0] for w in p["writes"]})
        coverage["reserve skipped after failed free"] += bool(p["skipped"])
        coverage["cooldown reset"] += bool(p["resets"])
        coverage["pruned account"] += any(not x["auth_ok"] or x["disabled"] for x in c["accounts"] if x["name"] in p["plan"])
    checks = len(cases) * len(fields)
    lines = [f"claude-quota differential run {dt.datetime.now(UTC).isoformat()}",
             f"python: {a.python_dir} (routing.py, claude_reset._apply_routing, claude_reset._heal_cooldowns)",
             f"go: {PLUGIN} (rules, engine.applyRouting, engine.healCooldowns)",
             f"seed {a.seed}, {len(cases)} cases, {checks} field comparisons ({', '.join(fields)})",
             "cases that exercise each path: " + ", ".join(f"{k} {v}" for k, v in coverage.items()),
             f"differences: {len(diffs)}"] + diffs[:50]
    report = "\n".join(lines) + "\n"
    os.makedirs(os.path.dirname(a.report), exist_ok=True)
    with open(a.report, "w") as f:
        f.write(report)
    print(report)
    sys.exit(1 if diffs else 0)


if __name__ == "__main__":
    main()
