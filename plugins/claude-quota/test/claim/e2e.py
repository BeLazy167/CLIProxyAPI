"""End-to-end run of the claude-quota offers, Claim page and panel claim against fake_upstream.py.

Moved from fleet's services/claude-reset/e2e.py. Each scenario starts a fresh fake upstream, a real gateway
built from this tree with the plugin built under the claude_quota_e2e tag, and a private Caddy instance that
runs caddy/reset.caddy with only the gateway port and key path changed. It drives the stack over HTTP like
the phone does (one scenario with headless Chromium) and the quota panel does, and checks what reached the
fake Anthropic, Bark, Resend and gateway endpoints. README.md lists the checks adapted from the Python suite.

Usage (from plugins/claude-quota): python3 -I -B test/claim/e2e.py [scenario ...]
Writes test/claim/e2e-report.txt.
"""

import datetime as dt
import hashlib
import hmac
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(os.path.dirname(HERE))
REPO = os.path.dirname(os.path.dirname(PLUGIN))
UTC = dt.timezone.utc
SECRET_TOKEN = "sk-ant-oat-FAKE-SECRET-TOKEN"
BARK_KEY = "FAKEBARKDEVICEKEY123"
RESEND_KEY = "re_FAKE_RESEND_KEY"
CPA_KEY = "FAKE-CPA-MANAGEMENT-KEY"
FABLE = ["claude-fable-*"]
RESERVED = ["claude-opus-*", "claude-sonnet-*"]
ROUTE = "/v0/management/plugins/claude-quota"
BUILD = {}


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def iso(h):
    return (dt.datetime.now(UTC) + dt.timedelta(hours=h)).isoformat()


def grant(gid, clears, pct, usable=True, left=1, ends_h=24 * 90, starts_h=-24, blocking=None):
    return {
        "id": gid, "label": gid, "resets_total": 1, "resets_left": left,
        "starts_at": iso(starts_h), "ends_at": iso(ends_h), "clears": clears,
        "paused": False, "usable_now": usable, "use_requires_limit": False,
        "percent_used": {w: pct for w in clears}, "blocking": blocking or [],
        "type": "full", "unavailable_reason": None if usable else "blocked_seven_day",
        "gives_back_weekly": True,
    }


def usage(grants, seven_pct=40, fable_pct=50, reset_h=72, reset_at=None):
    reset = reset_at or iso(reset_h)
    return {
        "five_hour": None,
        "seven_day": {"utilization": float(seven_pct), "resets_at": reset},
        "limits": [
            {"kind": "weekly_all", "group": "weekly", "percent": seven_pct, "resets_at": reset, "scope": None},
            {"kind": "weekly_scoped", "group": "weekly", "percent": fable_pct, "resets_at": reset,
             "scope": {"model": {"id": None, "display_name": "Fable"}, "surface": None}},
        ],
        "cedar_ember": {"eligible": True, "ineligible_reason": None, "grants": grants,
                        "next_grant_id": None, "weekly_resets_at": iso(reset_h)},
    }


def sh(cwd, *args, env=None):
    out = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env={**os.environ, **(env or {})})
    if out.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}: {out.stdout[-2000:]}{out.stderr[-2000:]}")
    return out.stdout


def build():
    """Build the gateway and two copies of the e2e plugin (the second for the hot reload) once per run."""
    d = tempfile.mkdtemp(prefix="cq-claim-build-")
    BUILD["dir"] = d
    BUILD["gateway"] = os.path.join(d, "cli-proxy-api")
    sh(REPO, "go", "build", "-o", BUILD["gateway"], "./cmd/server")
    for name, build_id in (("plugin", "claude-quota-claim-e2e"), ("reload", "claude-quota-claim-e2e-reload")):
        BUILD[name] = os.path.join(d, f"{name}.so")
        sh(PLUGIN, "go", "build", "-buildmode=c-shared", "-trimpath", "-tags", "claude_quota_e2e",
           f"-ldflags=-buildid={build_id}", "-o", BUILD[name], ".", env={"CGO_ENABLED": "1"})


class Run:
    """One fake upstream, one gateway with the plugin, and one Caddy, in a temp dir."""

    def __init__(self, accounts, enabled=True, interval="1s", mode=None, extra_cfg=None, state=None):
        self.tmp = tempfile.mkdtemp(prefix="cq-claim-")
        self.up_port, self.gw_port, self.caddy_port = free_port(), free_port(), free_port()
        self.up = f"http://127.0.0.1:{self.up_port}"
        self.gw = f"http://127.0.0.1:{self.gw_port}"
        self.origin = f"http://127.0.0.1:{self.caddy_port}"
        self.base = self.origin + "/reset"
        self.svc = self.caddy = None
        self.fake = subprocess.Popen([sys.executable, "-I", "-B", os.path.join(HERE, "fake_upstream.py"), str(self.up_port)])
        self._wait(self.up + "/_ctl/world")
        auth = os.path.join(self.tmp, "auth")
        world = {"accounts": {}, "orgs": {}, "gateway": {"key": CPA_KEY, "real": self.gw, "cooldowns": {}}}
        os.makedirs(auth)
        os.makedirs(os.path.join(self.tmp, "plugins"))
        self.labels = list(accounts)
        for i, (label, acct) in enumerate(accounts.items()):
            token = f"{SECRET_TOKEN}-{i}"
            org = f"org-{label}"
            world["accounts"][token] = acct["usage"]
            world["orgs"][org] = token
            name = f"claude-{label}.json"
            if acct.get("cooldowns"):
                world["gateway"]["cooldowns"][name] = acct["cooldowns"]
            extra = {"excluded_models": acct["excluded_models"]} if "excluded_models" in acct else {}
            with open(os.path.join(auth, name), "w") as f:
                json.dump({"type": "claude", "email": acct.get("email", f"{label}@example.com"), "access_token": token,
                           "organization_uuid": org, "expired": acct.get("expired", iso(5)),
                           "disabled": acct.get("disabled", False), **extra}, f)
        self.ctl("set", world)
        if state:
            os.makedirs(os.path.join(self.tmp, "state"))
            with open(self.state_path(), "w") as f:
                json.dump(state(auth), f)
        if mode:
            self.ctl("mode", mode)
        for name, val in (("bark.key", BARK_KEY), ("resend.key", RESEND_KEY), ("cpa.key", CPA_KEY), ("caddy-mgmt.key", CPA_KEY)):
            with open(os.path.join(self.tmp, name), "w") as f:
                f.write(val + "\n")
        shutil.copy(BUILD["plugin"], os.path.join(self.tmp, "plugins", "claude-quota.so"))
        self.cfg = os.path.join(self.tmp, "config.yaml")
        self.interval = interval
        self.extra_cfg = dict(extra_cfg or {})
        self.api_keys = ["e2e-client-key"]
        self.write_cfg(enabled)
        self.log = open(os.path.join(self.tmp, "gateway.log"), "a")
        try:
            self.start_caddy()
            self.start_svc()
        except BaseException:
            self.close()
            raise

    def write_cfg(self, enabled, extra=None):
        t = self.tmp
        plugin = {
            "enabled": enabled, "mode": "e2e", "interval": self.interval,
            "management_base": self.up, "management_key_file": f"{t}/cpa.key",
            "state_dir": f"{t}/state", "auth_dir": f"{t}/auth", "usage_base": self.up,
            "min_read_gap": "100ms", "reset_grace": "0s", "lock_retry": "200ms",
            "public_base": self.base, "bark_bases": [self.up], "bark_key_file": f"{t}/bark.key",
            "resend_base": self.up, "resend_key_file": f"{t}/resend.key",
            "email_from": "reset-alerts@example.com", "email_to": "me@example.com",
            **self.extra_cfg, **(extra or {}),
        }
        lines = "\n".join(f"      {k}: {json.dumps(v)}" for k, v in plugin.items())
        with open(self.cfg, "w") as f:
            f.write(f"""config-version: 8
server:
  host: "127.0.0.1"
  port: {self.gw_port}
management:
  allow-remote: false
  secret-key: {json.dumps(CPA_KEY)}
  disable-control-panel: true
access:
  api-keys: {json.dumps(self.api_keys)}
oauth:
  auth-dir: {json.dumps(t + "/auth")}
observability:
  logs:
    debug: false
    logging-to-file: false
plugins:
  enabled: true
  dir: {json.dumps(t + "/plugins")}
  configs:
    claude-quota:
{lines}
""")

    def start_caddy(self):
        with open(os.path.join(PLUGIN, "caddy", "reset.caddy")) as f:
            snippet = f.read()
        snippet = snippet.replace("127.0.0.1:8317", f"127.0.0.1:{self.gw_port}").replace(
            "/etc/caddy/sites/cpa-mgmt.key", os.path.join(self.tmp, "caddy-mgmt.key"))
        with open(os.path.join(self.tmp, "reset.caddy"), "w") as f:
            f.write(snippet)
        with open(os.path.join(self.tmp, "Caddyfile"), "w") as f:
            f.write(f"""{{
	admin off
	auto_https off
	persist_config off
	storage file_system {self.tmp}/caddy-data
}}
http://127.0.0.1:{self.caddy_port} {{
	import {self.tmp}/reset.caddy
	reverse_proxy 127.0.0.1:{self.gw_port}
}}
""")
        xdg = os.path.join(self.tmp, "caddy-xdg")
        self.caddy_log = open(os.path.join(self.tmp, "caddy.log"), "a")
        self.caddy = subprocess.Popen(["caddy", "run", "--config", os.path.join(self.tmp, "Caddyfile"), "--adapter", "caddyfile"],
                                      stdout=self.caddy_log, stderr=subprocess.STDOUT,
                                      env={**os.environ, "XDG_DATA_HOME": xdg, "XDG_CONFIG_HOME": xdg})
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", self.caddy_port), timeout=0.2).close()
                return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("caddy did not start")

    def start_svc(self, wait=True):
        # Any outbound HTTPS from the gateway under test goes to a closed port, so a fake token is never sent out.
        env = {**os.environ, "HTTPS_PROXY": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9",
               "NO_PROXY": "127.0.0.1,localhost", "TMPDIR": self.tmp}
        self.svc = subprocess.Popen([BUILD["gateway"], "--config", self.cfg, "--local-model"], cwd=self.tmp,
                                    stdout=self.log, stderr=subprocess.STDOUT, env=env)
        if wait and not self.wait_health(lambda h: h.get("state") == "running" and h.get("last_cycle"), 60):
            raise RuntimeError(f"plugin not running: {self.logtext()[-3000:]}")

    def kill_svc(self):
        self.svc.kill()
        self.svc.wait()

    def health(self):
        code, body, _ = self.get(self.gw + ROUTE + "/health", headers={"Authorization": f"Bearer {CPA_KEY}"})
        try:
            return code, json.loads(body)
        except ValueError:
            return code, {}

    def wait_health(self, pred, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            code, h = self.health()
            if code == 200 and pred(h):
                return True
            time.sleep(0.1)
        return False

    def set_auth(self, label, **fields):
        path = os.path.join(self.tmp, "auth", f"claude-{label}.json")
        with open(path) as f:
            a = json.load(f)
        for k, v in fields.items():
            if v is None and k == "excluded_models":
                a.pop(k, None)
            else:
                a[k] = v
        with open(path, "w") as f:
            json.dump(a, f)

    def _wait(self, url):
        for _ in range(100):
            try:
                urllib.request.urlopen(url, timeout=1).read()
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError(f"not up: {url}")

    def ctl(self, what, body):
        req = urllib.request.Request(f"{self.up}/_ctl/{what}", json.dumps(body).encode(), {"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()

    def world(self):
        return json.loads(urllib.request.urlopen(self.up + "/_ctl/world").read())

    def wait_for(self, pred, timeout=8):
        end = time.time() + timeout
        while time.time() < end:
            w = self.world()
            if pred(w):
                return w
            time.sleep(0.2)
        return self.world()

    def alerts(self, w=None):
        return [b for b in (w or self.world())["bark"] if not b["failed"]]

    def offer_urls(self, w=None):
        return [b["url"] for b in self.alerts(w) if b.get("url")]

    def get(self, url, headers=None):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=30)
            return r.status, r.read().decode(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), dict(e.headers)
        except OSError as e:  # not listening yet, or gone
            return 0, repr(e), {}

    def nonce(self, url):
        _, html, _ = self.get(url)
        m = re.search(r'name="nonce" value="([^"]+)"', html)
        return m.group(1) if m else None

    def post_claim(self, url, nonce=None, origin=None, fields=None):
        nonce = self.nonce(url) if nonce is None else nonce
        data = urllib.parse.urlencode({"nonce": nonce or "", **(fields or {})}).encode()
        req = urllib.request.Request(url + "/claim", data, {"Origin": origin or self.origin, "Content-Type": "application/x-www-form-urlencoded"})
        return self._send(req)

    def _send(self, req):
        try:
            r = urllib.request.urlopen(req, timeout=120)
            return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()
        except OSError as e:
            return 0, repr(e)

    def auth_index(self, label):
        _, body, _ = self.get(self.gw + "/v8/management/credentials", headers={"Authorization": f"Bearer {CPA_KEY}"})
        return next(f["auth_index"] for f in json.loads(body)["files"] if f["name"] == f"claude-{label}.json")

    def panel_claim(self, label, grant_id, auth_index=None):
        body = json.dumps({"auth_index": auth_index or self.auth_index(label), "grant_id": grant_id}).encode()
        req = urllib.request.Request(self.gw + ROUTE + "/claim", body, {"Authorization": f"Bearer {CPA_KEY}", "Content-Type": "application/json"})
        code, text = self._send(req)
        try:
            return code, json.loads(text)
        except ValueError:
            return code, {"message": text}

    def gw_calls(self, method=None, w=None):
        return [c for c in (w or self.world())["gw_calls"] if method is None or c["method"] == method]

    def state_path(self):
        return os.path.join(self.tmp, "state", "state.json")

    def state(self):
        with open(self.state_path()) as f:
            return json.load(f)

    def logtext(self):
        self.log.flush()
        with open(os.path.join(self.tmp, "gateway.log")) as f:
            return f.read()

    def plugin_lines(self):
        out = []
        for line in self.logtext().splitlines():
            i = line.find("claude-quota: ")
            if i >= 0:
                out.append(line[i + len("claude-quota: "):].replace('\\"', '"').rstrip('"'))
        return out

    def wait_line(self, pred, timeout=8):
        end = time.time() + timeout
        while time.time() < end:
            if any(pred(ln) for ln in self.plugin_lines()):
                return True
            time.sleep(0.1)
        return False

    def shadow_writes(self):
        """The routing writes the plugin's shadow writer logged, in order: (auth file name, from, to)."""
        out = []
        for ln in self.plugin_lines():
            m = re.fullmatch(r"shadow: (\S+)@example\.com excluded_models (.+) -> (.+)", ln)
            if m:
                out.append((f"claude-{m.group(1)}.json", json.loads(m.group(2)), json.loads(m.group(3))))
        return out

    def cooldown_resets(self):
        return [m.groups() for ln in self.plugin_lines()
                if (m := re.fullmatch(r"shadow: (\S+)@example\.com cooldown reset \((.+)\)", ln))]

    def apply_shadow_writes(self):
        """Do what the live writer's PATCH does to the auth files, so the next plan starts from them."""
        for name, _, to in self.shadow_writes():
            self.set_auth(name.removeprefix("claude-").removesuffix(".json"), excluded_models=to)

    def auth_file(self, label):
        with open(os.path.join(self.tmp, "auth", f"claude-{label}.json")) as f:
            return json.load(f)

    def reload_plugin(self):
        """Hot reload to a new build of the plugin, as a deploy does: new .so in the plugin dir plus a config change."""
        shutil.copy(BUILD["reload"], os.path.join(self.tmp, "plugins", "claude-quota-v0.1.1.so"))
        self.api_keys.append("e2e-client-key-reload")
        self.write_cfg(True)

    def running_engines(self):
        last = {}
        for ln in self.plugin_lines():
            m = re.match(r"^engine (\S+) (running|stopped)", ln)
            if m:
                last[m.group(1)] = m.group(2)
        return [k for k, v in last.items() if v == "running"]

    def close(self):
        for p in (self.svc, getattr(self, "caddy", None), self.fake):
            if p is not None and p.poll() is None:
                p.send_signal(signal.SIGTERM)
                try:
                    p.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait()
        for f in (getattr(self, "log", None), getattr(self, "caddy_log", None)):
            if f is not None:
                f.close()
        if not os.environ.get("KEEP_TMP"):
            shutil.rmtree(self.tmp, ignore_errors=True)


def one_near_limit_account(**kw):
    return {"a": {"usage": usage([grant("g1", ["seven_day_overage_included"], 95)], fable_pct=95, **kw)}}


def offer(r):
    return list(r.state()["offers"].values())[0]


# ---------------- scenarios ----------------
# Each returns a list of (check name, passed, detail).

def s_near_limit_alert_once():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: len(r.alerts(w)) >= 1)
        time.sleep(2.5)  # two more cycles
        w = r.world()
        urls = r.offer_urls(w)
        return [("one alert after 3 cycles", len(r.alerts(w)) == 1, f"alerts={len(r.alerts(w))}"),
                ("alert has offer link", len(urls) == 1 and urls[0].startswith(r.base + "/offer/"), urls),
                ("no claim sent", w["claims"] == [], w["claims"]),
                ("bark key used in path", r.alerts(w)[0]["path"] == "/" + BARK_KEY, r.alerts(w)[0]["path"])]
    finally:
        r.close()


def s_below_threshold_and_near_reset_no_alert():
    accts = {
        "low": {"usage": usage([grant("g1", ["seven_day_overage_included"], 80)], fable_pct=80)},
        "soon": {"usage": usage([grant("g1", ["seven_day_overage_included"], 99)], fable_pct=99, reset_h=6)},
        "day": {"usage": usage([grant("g1", ["seven_day_overage_included"], 99)], fable_pct=99, reset_h=20)},
        "blocked": {"usage": usage([grant("g1", ["seven_day_overage_included"], 99, usable=False)], fable_pct=99)},
        "notstarted": {"usage": usage([grant("g1", ["seven_day_overage_included"], 99, starts_h=5)], fable_pct=99)},
        "used": {"usage": usage([grant("g1", ["seven_day_overage_included"], 99, left=0)], fable_pct=99)},
    }
    r = Run(accts)
    try:
        time.sleep(3)
        w = r.world()
        return [("no alerts for 80%, reset in 6 h, reset in 20 h (default 24 h), blocked, not started, used up", r.alerts(w) == [], r.alerts(w)),
                ("status was read", w["status_reads"] >= 6, w["status_reads"])]
    finally:
        r.close()


def s_two_grants_one_offer():
    g_late = grant("late", ["seven_day_overage_included"], 95, ends_h=24 * 100)
    g_early = grant("early", ["seven_day_overage_included"], 95, ends_h=24 * 30)
    r = Run({"a": {"usage": usage([g_late, g_early], fable_pct=95)}})
    try:
        w = r.wait_for(lambda w: len(r.alerts(w)) >= 1)
        time.sleep(2)
        w = r.world()
        al = r.alerts(w)
        return [("one alert for two grants on one window", len(al) == 1, len(al)),
                ("earliest-expiring grant chosen", "early" in json.dumps(al), al)]
    finally:
        r.close()


def s_get_is_read_only_and_post_guards():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        code, html, hdr = r.get(url)
        r.get(url)
        bad_nonce = r.post_claim(url, nonce="wrong")
        bad_origin = r.post_claim(url, origin="https://evil.example")
        null_origin = r.post_claim(url, origin="null")
        bad_token = r.post_claim(r.base + "/offer/notatoken")
        w = r.world()
        return [("GET 200 shows grant", code == 200 and "g1" in html, code),
                ("no-store + same-origin referrer headers", hdr.get("Cache-Control") == "no-store" and hdr.get("Referrer-Policy") == "same-origin", hdr),
                ("bad nonce refused", bad_nonce[0] == 403, bad_nonce[0]),
                ("bad origin refused", bad_origin[0] == 403, bad_origin[0]),
                ("Origin: null refused", null_origin[0] == 403, null_origin[0]),
                ("unknown token 404", bad_token[0] == 404, bad_token[0]),
                ("no claim, no email after GETs and bad POSTs", w["claims"] == [] and w["emails"] == [], (w["claims"], len(w["emails"])))]
    finally:
        r.close()


def s_happy_claim():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        code, html = r.post_claim(url)
        w = r.world()
        again = r.post_claim(url)
        w2 = r.world()
        mails = [e for e in w["emails"] if not e["failed"]]
        o = offer(r)
        claim = w["claims"][0] if w["claims"] else {}
        return [("claim page 200 says reset", code == 200 and "reset" in html.lower(), code),
                ("exactly one claim sent", len(w["claims"]) == 1, len(w["claims"])),
                ("claim body program/grant/request_id", claim.get("program") == "cedar_ember" and claim.get("grant_id") == "g1" and len(claim.get("request_id", "")) >= 16, claim),
                ("before email then after email", len(mails) == 2 and "before" in mails[0]["subject"].lower() + mails[0]["text"].lower() and mails[1]["subject"] != mails[0]["subject"], [m["subject"] for m in mails]),
                ("emails use resend key, from/to", all(m["auth"] == f"Bearer {RESEND_KEY}" and "<reset-alerts@example.com>" in m["from"] and m["to"] == ["me@example.com"] for m in mails), [(m["from"], m["to"]) for m in mails]),
                ("state DONE and verified", o["state"] == "DONE" and o.get("verified") is True, (o["state"], o.get("verified"))),
                ("second POST sends nothing", len(w2["claims"]) == 1, (again[0], len(w2["claims"]))),
                ("spent exactly 1", sum(w2["spent"].values()) == 1, w2["spent"])]
    finally:
        r.close()


def parallel(fns):
    res = [None] * len(fns)
    ts = [threading.Thread(target=lambda i=i, f=f: res.__setitem__(i, f())) for i, f in enumerate(fns)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return res


def s_concurrent_taps():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.ctl("mode", {"claim": "slow"})
        nonce = r.nonce(url)
        parallel([lambda: r.post_claim(url, nonce=nonce)] * 8)
        w = r.world()
        return [("8 parallel taps -> 1 claim", len(w["claims"]) == 1, len(w["claims"])),
                ("spent exactly 1", sum(w["spent"].values()) == 1, w["spent"]),
                ("2 emails only", len(w["emails"]) == 2, len(w["emails"]))]
    finally:
        r.close()


def s_lost_response_after_spend():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.ctl("mode", {"claim": "drop_after_spend"})
        r.post_claim(url)
        st1 = offer(r)["state"]
        time.sleep(2.5)  # the next cycle reconciles from a status read
        st2 = offer(r)
        r.post_claim(url)
        w = r.world()
        return [("state UNKNOWN right after lost response", st1 == "UNKNOWN", st1),
                ("cycle reconciles to DONE", st2["state"] == "DONE", st2["state"]),
                ("no second claim sent", len(w["claims"]) == 1, len(w["claims"])),
                ("spent exactly 1", sum(w["spent"].values()) == 1, w["spent"])]
    finally:
        r.close()


def s_lost_response_no_spend_retry_same_id():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.ctl("mode", {"claim": "drop_no_spend"})
        r.post_claim(url)
        time.sleep(2.5)
        st = offer(r)["state"]
        w1 = r.world()
        r.post_claim(url)
        w = r.world()
        ids = [c["request_id"] for c in w["claims"]]
        return [("stays UNKNOWN when status unchanged", st == "UNKNOWN", st),
                ("no automatic re-send", len(w1["claims"]) == 1, len(w1["claims"])),
                ("user re-tap re-sends same request_id", len(ids) == 2 and ids[0] == ids[1], ids),
                ("spent exactly 1", sum(w["spent"].values()) == 1, w["spent"])]
    finally:
        r.close()


def s_late_tap_refused():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        acct = next(iter(w["accounts"]))
        u = w["accounts"][acct]
        u["cedar_ember"]["grants"][0]["percent_used"]["seven_day_overage_included"] = 40
        r.ctl("set", {"accounts": {acct: u}})
        code, html = r.post_claim(url)
        w = r.world()
        return [("late tap refused with message", "no longer" in html.lower(), (code, html[:200])),
                ("no claim, no email", w["claims"] == [] and w["emails"] == [], (len(w["claims"]), len(w["emails"])))]
    finally:
        r.close()


def s_before_email_fails_no_claim():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.ctl("mode", {"email_fail": 1})
        code, html = r.post_claim(url)
        w = r.world()
        st = offer(r)["state"]
        r.post_claim(url)
        w2 = r.world()
        return [("no claim when before email fails", w["claims"] == [], w["claims"]),
                ("page shows email error", "email" in html.lower(), html[:200]),
                ("offer back to OFFERED", st == "OFFERED", st),
                ("later tap works", len(w2["claims"]) == 1, len(w2["claims"]))]
    finally:
        r.close()


def s_after_email_fails_bark_fallback():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        n_alerts = len(r.alerts(w))
        r.ctl("mode", {"email_ok_first": 1, "email_fail": 1})  # before email lands, after email fails
        r.post_claim(url)
        w = r.world()
        new_alerts = r.alerts(w)[n_alerts:]
        return [("claim still done", len(w["claims"]) == 1 and offer(r)["state"] == "DONE", len(w["claims"])),
                ("bark fallback sent with result", any("reset" in (a.get("body", "") + a.get("title", "")).lower() for a in new_alerts), new_alerts)]
    finally:
        r.close()


def s_cooldown_back_to_offered():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.ctl("mode", {"claim": "cooldown"})
        r.post_claim(url)
        st = offer(r)
        r.post_claim(url)
        w = r.world()
        return [("cooldown -> OFFERED", st["state"] == "OFFERED", st["state"]),
                ("retap after past cooldown_until claims", len(w["claims"]) == 2 and sum(w["spent"].values()) == 1, (len(w["claims"]), w["spent"]))]
    finally:
        r.close()


def s_off_switch():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        nonce = r.nonce(url)
        r.write_cfg(enabled=False)
        gone = wait_until(lambda: r.health()[0] != 200, 20)
        code, _ = r.post_claim(url, nonce=nonce)
        acct = next(iter(w["accounts"]))
        u = w["accounts"][acct]
        u["cedar_ember"]["grants"].append(grant("g2", ["seven_day"], 97))
        u["seven_day"]["utilization"] = 97
        r.ctl("set", {"accounts": {acct: u}})
        n = len(r.alerts())
        time.sleep(2.5)
        w = r.world()
        return [("POST refused when disabled (the host unloads the plugin, so its route is gone)", gone and code == 404 and w["claims"] == [], (code, len(w["claims"]))),
                ("no new alerts when disabled", len(r.alerts(w)) == n, (n, len(r.alerts(w))))]
    finally:
        r.close()


def wait_until(pred, timeout):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.1)
    return False


def s_bark_fail_retries():
    r = Run(one_near_limit_account(), mode={"bark_fail": 2})
    try:
        w = r.wait_for(lambda w: len(r.alerts(w)) >= 1, timeout=8)
        failed = [b for b in w["bark"] if b["failed"]]
        st = {"offers": {}}
        for _ in range(30):  # the offer is written right after the push lands
            st = r.state()
            if st["offers"]:
                break
            time.sleep(0.1)
        return [("failed pushes retried until one lands", len(failed) >= 1 and len(r.alerts(w)) == 1, (len(failed), len(r.alerts(w)))),
                ("one offer stored (only for the landed push)", len(st["offers"]) == 1, len(st["offers"]))]
    finally:
        r.close()


def s_expiry_alerts():
    accts = {
        "e7": {"usage": usage([grant("g7", ["seven_day_overage_included"], 5, ends_h=24 * 5)], fable_pct=5)},
        "e1": {"usage": usage([grant("g1", ["seven_day_overage_included"], 5, ends_h=20)], fable_pct=5)},
    }
    r = Run(accts)
    try:
        r.wait_for(lambda w: len(r.alerts(w)) >= 2)
        time.sleep(2)
        al = r.alerts()
        txt = json.dumps(al)
        return [("expiring in 5 d -> one 7-day alert", sum("g7" in json.dumps(a) for a in al) == 1, len(al)),
                ("expiring in 20 h -> only the 24-hour alert", sum("g1" in json.dumps(a) for a in al) == 1, txt[:300])]
    finally:
        r.close()


def s_schema_problem_isolated():
    bad = grant("odd", ["five_hour_weird_window"], 99, ends_h=20)
    noblock = usage([], fable_pct=99)
    del noblock["cedar_ember"]
    accts = {
        "bad": {"usage": usage([bad], fable_pct=99)},
        "noblock": {"usage": noblock},
        "good": {"usage": usage([grant("g1", ["seven_day_overage_included"], 95)], fable_pct=95)},
    }
    r = Run(accts)
    try:
        r.wait_for(lambda w: len(r.alerts(w)) >= 3)
        time.sleep(2)
        al = r.alerts()
        return [("only the good account gets an offer (unmapped grant expiring in 20 h gets none)", sum(bool(a.get("url")) for a in al) == 1, [a.get("title") for a in al]),
                ("schema alerts: unmapped window + missing cedar_ember", sum("schema" in (a.get("title", "") + a.get("body", "")).lower() for a in al) == 2, [a.get("title") for a in al])]
    finally:
        r.close()


def s_expired_token_skipped():
    r = Run({"a": {"usage": usage([grant("g1", ["seven_day_overage_included"], 95)], fable_pct=95), "expired": iso(-0.1)}})
    try:
        time.sleep(2.5)
        w = r.world()
        return [("no status read with expired token", w["status_reads"] == 0, w["status_reads"]),
                ("no alert", r.alerts(w) == [], r.alerts(w))]
    finally:
        r.close()


def s_no_secrets_in_logs():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.post_claim(url)
        token = url.rsplit("/", 1)[1]
        log = r.logtext()
        state = json.dumps(r.state())
        mails = json.dumps([{k: v for k, v in e.items() if k != "auth"} for e in r.world()["emails"]])
        leaks = [s for s in (SECRET_TOKEN, BARK_KEY, RESEND_KEY, CPA_KEY, token) if s in log]
        return [("log has no oauth/bark/resend/gateway key or offer token", leaks == [], leaks),
                ("state has no raw offer token or oauth token", token not in state and SECRET_TOKEN not in state, None),
                ("emails have no offer token or oauth token", token not in mails and SECRET_TOKEN not in mails, None),
                ("log is not empty", len(log) > 0, len(log))]
    finally:
        r.close()


def s_two_offers_same_grant_concurrent():
    g = grant("g1", ["seven_day_overage_included"], 95, left=2, ends_h=20)
    r = Run({"a": {"usage": usage([g], fable_pct=95)}}, mode={"claim": "slow"})
    try:
        w = r.wait_for(lambda w: len(r.offer_urls(w)) >= 2)
        urls = r.offer_urls(w)
        nonces = [r.nonce(u) for u in urls]
        parallel([lambda u=u, n=n: r.post_claim(u, nonce=n) for u, n in zip(urls, nonces) for _ in range(3)])
        w = r.world()
        return [("near-limit + expiring offers for one grant", len(urls) == 2, len(urls)),
                ("6 parallel taps on 2 offers -> 1 claim", len(w["claims"]) == 1, len(w["claims"])),
                ("spent exactly 1 of 2", sum(w["spent"].values()) == 1, w["spent"])]
    finally:
        r.close()


def s_retry_form_action_absolute():
    r = Run(one_near_limit_account(), mode={"email_fail": 1})
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        token = url.rsplit("/", 1)[1]
        code, html = r.post_claim(url)
        m = re.search(r'action="([^"]+)"', html)
        want = urllib.parse.urlsplit(r.base).path + f"/offer/{token}/claim"
        return [("page after a failed POST posts back to the same claim URL", bool(m) and m.group(1) == want, m and m.group(1))]
    finally:
        r.close()


def s_disabled_account_refused():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.set_auth("a", disabled=True)
        code, html = r.post_claim(url)
        w = r.world()
        return [("disabled account: no claim, no email", w["claims"] == [] and w["emails"] == [], (code, len(w["claims"]), len(w["emails"])))]
    finally:
        r.close()


def s_malformed_claim_reply_unknown():
    r = Run(one_near_limit_account(), mode={"claim": "empty_200"})
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.post_claim(url)
        st = offer(r)["state"]
        return [("2xx without a known result -> UNKNOWN", st == "UNKNOWN", st)]
    finally:
        r.close()


def s_missing_grant_not_confirmed():
    r = Run(one_near_limit_account(), mode={"claim": "drop_no_spend"})
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.post_claim(url)
        acct = next(iter(w["accounts"]))
        u = r.world()["accounts"][acct]
        u["cedar_ember"]["grants"] = []
        r.ctl("set", {"accounts": {acct: u}})
        time.sleep(2.5)
        st = offer(r)["state"]
        return [("grant missing from status does not confirm a lost claim", st == "UNKNOWN", st)]
    finally:
        r.close()


def s_expired_unknown_no_resend():
    r = Run(one_near_limit_account(), mode={"claim": "drop_no_spend"})
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        r.post_claim(url)
        r.kill_svc()
        st = r.state()
        for o in st["offers"].values():
            o["expires_at"] = iso(-1)
        with open(r.state_path(), "w") as f:
            json.dump(st, f)
        r.start_svc()
        code, html = r.post_claim(url)
        w = r.world()
        return [("expired UNKNOWN offer is not re-sent", len(w["claims"]) == 1, (code, len(w["claims"])))]
    finally:
        r.close()


def s_crash_in_sending_recovers():
    r = Run(one_near_limit_account(), mode={"claim": "slow"})
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        nonce = r.nonce(url)
        t = threading.Thread(target=lambda: r.post_claim(url, nonce=nonce))
        t.start()
        r.wait_for(lambda w: len(w["claims"]) >= 1, timeout=5)
        sending = offer(r)["state"]
        r.kill_svc()
        t.join()
        time.sleep(0.6)  # the fake finishes the slow claim and spends it
        r.start_svc()
        time.sleep(2.5)
        st = offer(r)["state"]
        w = r.world()
        return [("crash during SENDING -> UNKNOWN -> DONE by status read", sending == "SENDING" and st == "DONE", (sending, st)),
                ("no re-send after restart", len(w["claims"]) == 1, len(w["claims"]))]
    finally:
        r.close()


def s_config_typo_exits():
    r = Run(one_near_limit_account())
    try:
        r.write_cfg(True, extra={"enabeld": False})
        stopped = wait_until(lambda: r.health()[1].get("state") != "running", 20)
        return [("config typo stops the engine (the host reports the plugin error)", stopped and "enabeld" in r.logtext(), r.health())]
    finally:
        r.close()


def s_revoked_token_alerts():
    r = Run(one_near_limit_account(), extra_cfg={"stale_token_alert_hours": 0})
    try:
        r.set_auth("a", access_token="sk-ant-oat-revoked")
        w = r.wait_for(lambda w: any("token" in (a.get("title", "")).lower() for a in r.alerts(w)), timeout=8)
        return [("401 on status read -> token alert", any("token" in a.get("title", "").lower() for a in r.alerts(w)), [a.get("title") for a in r.alerts(w)])]
    finally:
        r.close()


def s_sibling_after_lost_reply_refused():
    g = grant("g1", ["seven_day_overage_included"], 95, left=2, ends_h=20)
    r = Run({"a": {"usage": usage([g], fable_pct=95)}}, mode={"claim": "drop_no_spend"})
    try:
        w = r.wait_for(lambda w: len(r.offer_urls(w)) >= 2)
        u1, u2 = r.offer_urls(w)[:2]
        r.post_claim(u1)
        code, html = r.post_claim(u2)
        w = r.world()
        return [("sibling offer refused while an earlier claim is unknown", len(w["claims"]) == 1, (code, len(w["claims"])))]
    finally:
        r.close()


def s_multi_window_grant_siblings_expire():
    g = grant("g1", ["seven_day", "seven_day_overage_included"], 95, left=2)
    r = Run({"a": {"usage": usage([g], seven_pct=95, fable_pct=95)}})
    try:
        w = r.wait_for(lambda w: len(r.offer_urls(w)) >= 2)
        u1, u2 = r.offer_urls(w)[:2]
        r.post_claim(u1)
        code, html = r.post_claim(u2)
        w = r.world()
        offers = r.state()["offers"]
        done = [i for i, o in offers.items() if o["state"] == "DONE"]
        marked = [o.get("expired_by") for o in offers.values() if o["state"] == "EXPIRED"]
        return [("one grant, two windows -> two offers", len(r.offer_urls(w)) == 2, len(r.offer_urls(w))),
                ("second window's offer expires after the first claim", len(w["claims"]) == 1 and sum(w["spent"].values()) == 1, (code, len(w["claims"]), w["spent"])),
                ("the expired sibling names the claim that expired it", len(done) == 1 and marked == done, (done, marked))]
    finally:
        r.close()


def s_malformed_fields_fail_closed():
    empty_pct = grant("nopct", ["seven_day_overage_included"], 99, ends_h=20)
    empty_pct["percent_used"] = {}
    str_bool = grant("strbool", ["seven_day_overage_included"], 99, ends_h=20)
    str_bool["usable_now"] = "false"
    no_elig = usage([grant("g", ["seven_day_overage_included"], 99)], fable_pct=99)
    del no_elig["cedar_ember"]["eligible"]
    bad_window = usage([grant("g", ["seven_day"], 99)], fable_pct=99)
    bad_window["seven_day"] = "unreadable"
    bad_limits = usage([grant("g", ["seven_day_overage_included"], 99)], fable_pct=99)
    bad_limits["limits"] = ["unreadable"]
    bool_pct = grant("boolpct", ["seven_day_overage_included"], 99, ends_h=20)
    bool_pct["percent_used"] = {"seven_day_overage_included": True}
    inf_pct = grant("infpct", ["seven_day_overage_included"], 99, ends_h=20)
    inf_pct["percent_used"] = {"seven_day_overage_included": 1e400}
    accts = {"nopct": {"usage": usage([empty_pct], fable_pct=99)}, "strbool": {"usage": usage([str_bool], fable_pct=99)},
             "noelig": {"usage": no_elig}, "badwin": {"usage": bad_window}, "badlim": {"usage": bad_limits},
             "boolpct": {"usage": usage([bool_pct], fable_pct=99)}, "infpct": {"usage": usage([inf_pct], fable_pct=99)},
             "good": {"usage": usage([grant("g1", ["seven_day_overage_included"], 95)], fable_pct=95)}}
    r = Run(accts)
    try:
        r.wait_for(lambda w: len(r.alerts(w)) >= 8, timeout=8)
        time.sleep(1.5)
        al = r.alerts()
        schema = sum("schema" in a.get("title", "").lower() for a in al)
        return [("service still running", r.svc.poll() is None and r.health()[1].get("state") == "running", r.svc.poll()),
                ("only the good account gets an offer", sum(bool(a.get("url")) for a in al) == 1, [a.get("title") for a in al]),
                ("seven schema alerts", schema == 7, schema)]
    finally:
        r.close()


def s_string_eligible_blocks_claim():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        acct = next(iter(w["accounts"]))
        u = w["accounts"][acct]
        u["cedar_ember"]["eligible"] = "false"
        r.ctl("set", {"accounts": {acct: u}})
        code, html = r.post_claim(url)
        w = r.world()
        return [("eligible \"false\" (a string) blocks the claim", w["claims"] == [], (code, len(w["claims"])))]
    finally:
        r.close()


def s_bad_interval_exits():
    r = Run(one_near_limit_account())
    try:
        r.interval = "-1s"
        r.write_cfg(True)
        stopped = wait_until(lambda: r.health()[1].get("state") != "running", 20)
        return [("negative interval stops the engine (the host reports the plugin error)", stopped and "interval" in r.logtext(), r.health())]
    finally:
        r.close()


def s_email_protocol_error_bark_fallback():
    r = Run(one_near_limit_account())
    try:
        w = r.wait_for(lambda w: r.offer_urls(w))
        url = r.offer_urls(w)[0]
        n = len(r.alerts(w))
        r.ctl("mode", {"email_ok_first": 1, "email_garbage": 1})
        r.post_claim(url)
        w = r.world()
        return [("claim done", len(w["claims"]) == 1, len(w["claims"])),
                ("after email protocol error -> Bark fallback", len(r.alerts(w)) > n, (n, len(r.alerts(w))))]
    finally:
        r.close()


FABLE_W = "seven_day_overage_included"


def claimed_offer(r):
    w = r.wait_for(lambda w: r.offer_urls(w))
    return r.offer_urls(w)[0]


def s_real_browser_claim():
    r = Run(one_near_limit_account())
    try:
        url = claimed_offer(r)
        try:
            out = subprocess.run(["node", os.path.join(HERE, "browser_claim.cjs"), url], capture_output=True, text=True, timeout=90)
        except (OSError, subprocess.TimeoutExpired) as e:
            return [("headless Chromium ran", False, repr(e))]
        w = r.world()
        lines = out.stdout.strip().splitlines()
        post = next((ln for ln in lines if ln.startswith("POST")), "")
        result = next((ln for ln in lines if ln.startswith("RESULT")), "")
        return [("headless Chromium ran", out.returncode == 0, out.stderr[-400:]),
                ("browser form POST carries the page origin, not null", post.endswith("Origin: " + r.origin), post),
                ("browser tap claimed exactly once", len(w["claims"]) == 1 and sum(w["spent"].values()) == 1, (len(w["claims"]), w["spent"])),
                (f"browser saw: {post.replace(r.origin, '<origin>')} / {result[:160]}", "Reset claimed" in result, result)]
    finally:
        r.close()


def s_jittered_reset_one_alert():
    base = (dt.datetime.now(UTC) + dt.timedelta(hours=72)).replace(minute=0, second=0, microsecond=0)

    def u(us):
        return usage([grant("g1", [FABLE_W], 95)], fable_pct=95, reset_at=(base + dt.timedelta(microseconds=us)).isoformat())
    r = Run({"a": {"usage": u(-111498)}})
    try:
        w = r.wait_for(lambda w: r.alerts(w))
        token = next(iter(w["accounts"]))
        for us in (-74054, -252410, 73849):
            r.ctl("set", {"accounts": {token: u(us)}})
            time.sleep(1.3)
        w = r.world()
        return [("reset time moving by microseconds across 4 reads -> one alert", len(r.alerts(w)) == 1, [a.get("title") for a in r.alerts(w)]),
                ("one offer stored", len(r.state()["offers"]) == 1, len(r.state()["offers"])),
                ("several cycles ran", w["status_reads"] >= 4, w["status_reads"])]
    finally:
        r.close()


def s_fable_only_limit_offers_narrow_grant():
    full = grant("full-reset", ["seven_day", FABLE_W], 100, ends_h=24 * 30)
    full["percent_used"] = {"seven_day": 64, FABLE_W: 100}
    fable = grant("fable-only", [FABLE_W], 100, ends_h=24 * 120)
    r = Run({"a": {"usage": usage([full, fable], seven_pct=64, fable_pct=100)}})
    try:
        url = claimed_offer(r)
        offers = list(r.state()["offers"].values())
        r.post_claim(url)
        w = r.world()
        g = {x["id"]: x["resets_left"] for x in next(iter(w["accounts"].values()))["cedar_ember"]["grants"]}
        return [("one offer, for the Fable-only grant that ends later", [o["grant_id"] for o in offers] == ["fable-only"], [o["grant_id"] for o in offers]),
                ("claim spends the Fable-only grant, full reset kept", g == {"full-reset": 1, "fable-only": 0}, g)]
    finally:
        r.close()


def s_claim_clears_gateway_cooldown():
    accts = one_near_limit_account()
    accts["a"]["usage"]["five_hour"] = {"utilization": 100.0, "resets_at": iso(3)}  # keeps the cycle's own heal away
    accts["a"]["cooldowns"] = [{"scope": "credential", "reason": "credential_quota", "retry_at": iso(80)}]
    r = Run(accts)
    try:
        url = claimed_offer(r)
        time.sleep(1.5)
        before = r.cooldown_resets()
        writes_before = [c for c in r.gw_calls() if c["method"] != "GET"]
        code, html = r.post_claim(url)
        w = r.world()
        mails = [e for e in w["emails"] if not e["failed"]]
        resets = r.cooldown_resets()
        line = "gateway cooldown reset is logged only (shadow routing writer)"
        return [("no gateway write and no cooldown reset before the claim", before == [] and writes_before == [], (before, writes_before)),
                ("one cooldown reset after the claim, for the claimed account", resets == [("a", "after a reset claim")], resets),
                ("management key sent as Bearer", all(c["authorized"] for c in r.gw_calls(w=w)), r.gw_calls(w=w)[:3]),
                ("the claimed account is found in the real gateway's credentials", "does not list" not in html, html[-300:]),
                ("page and after email report the cooldown step", line in html and line in mails[-1]["text"], (html[-300:], mails[-1]["text"])),
                ("no PATCH or POST reached the management API", [c for c in r.gw_calls(w=w) if c["method"] != "GET"] == [], None)]
    finally:
        r.close()


def s_claim_gateway_down_still_done():
    r = Run(one_near_limit_account())
    try:
        url = claimed_offer(r)
        r.ctl("mode", {"gw_down": 1})
        code, html = r.post_claim(url)
        o = offer(r)
        return [("claim DONE although the gateway is down", o["state"] == "DONE" and code == 200, (code, o["state"])),
                ("page says the cooldown was not cleared", "gateway cooldown not cleared" in html, html[-300:]),
                ("service still running", r.svc.poll() is None, r.svc.poll())]
    finally:
        r.close()


def nano(hours, suffix="Z"):
    return (dt.datetime.now(UTC) + dt.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S") + ".001273778" + suffix


def s_routing_applies_and_heals():
    accts = {
        "fableout": {"usage": usage([], seven_pct=64, fable_pct=100), "excluded_models": FABLE,
                     "cooldowns": [{"scope": "model", "model_key": "claude-fable-5-2", "reason": "quota", "retry_at": nano(80)}]},
        "fableleft": {"usage": usage([], seven_pct=54, fable_pct=0),
                      "cooldowns": [{"scope": "credential", "reason": "credential_quota", "retry_at": nano(80, "-06:00")}]},
        "weeklyout": {"usage": usage([], seven_pct=100, fable_pct=0),
                      "cooldowns": [{"scope": "credential", "reason": "credential_quota", "retry_at": nano(70)}]},
        "authfail": {"usage": usage([], seven_pct=30, fable_pct=20),
                     "cooldowns": [{"scope": "credential", "reason": "unauthorized", "retry_at": nano(1)}]},
        "pastcd": {"usage": usage([], seven_pct=40, fable_pct=10),
                   "cooldowns": [{"scope": "credential", "reason": "credential_quota", "retry_at": nano(-1)}]},
    }
    r = Run(accts, interval="60s")
    try:
        r.wait_line(lambda ln: ln.startswith("plan 1 "))
        w1 = r.world()
        patches = {n: to for n, _, to in r.shadow_writes()}
        heals = r.cooldown_resets()
        files = {lb: patches.get(f"claude-{lb}.json", r.auth_file(lb).get("excluded_models")) for lb in accts}
        r.apply_shadow_writes()
        cds = w1["gateway"]["cooldowns"]
        cds.pop("claude-fableleft.json")
        r.ctl("set", {"gateway": {**w1["gateway"], "cooldowns": cds}})
        r.kill_svc()
        r.start_svc()
        wait_until(lambda: sum(ln.startswith("plan 1 ") for ln in r.plugin_lines()) >= 2, 20)
        w2 = r.world()
        log = "\n".join(r.plugin_lines())
        res = RESERVED
        return [("one usage read per account in a cycle", w1["status_reads"] == 5, w1["status_reads"]),
                ("shadow write only where the list changes", patches == {"claude-fableleft.json": res, "claude-weeklyout.json": FABLE,
                                                                         "claude-authfail.json": res, "claude-pastcd.json": res}, patches),
                ("the plan gives every account its wanted list", files == {"fableout": FABLE, "fableleft": res, "weeklyout": FABLE,
                                                                          "authfail": res, "pastcd": res}, files),
                ("stale quota cooldown healed only on the account with weekly room", [h[0] for h in heals] == ["fableleft"], heals),
                ("second cycle after the writes landed: no write, no heal (idempotent)", len(r.shadow_writes()) == 4 and len(r.cooldown_resets()) == 1,
                 (len(r.shadow_writes()), len(r.cooldown_resets()))),
                ("second cycle still one read per account", w2["status_reads"] == 10, w2["status_reads"]),
                ("every change logged in one line", log.count("excluded_models null -> ") == 4 and log.count("cooldown reset (stale until") == 1, log[-800:]),
                ("management key not in the log", CPA_KEY not in r.logtext(), None)]
    finally:
        r.close()


def s_routing_no_reserve_clears_old_list():
    accts = {"weeklyout": {"usage": usage([], seven_pct=100, fable_pct=0)},
             "fableleft": {"usage": usage([], seven_pct=50, fable_pct=0), "excluded_models": RESERVED},
             "stale": {"usage": usage([], seven_pct=50, fable_pct=100), "expired": iso(-1)}}
    r = Run(accts, interval="60s")
    try:
        wait_until(lambda: len(r.shadow_writes()) >= 2, 8)
        time.sleep(0.5)
        patches = {n: to for n, _, to in r.shadow_writes()}
        return [("no account with Fable gone and weekly room (unread account ignored): Opus/Sonnet not reserved",
                 patches == {"claude-weeklyout.json": FABLE, "claude-fableleft.json": None}, patches),
                ("old reserve list cleared (the write for fableleft is null)", ("claude-fableleft.json", RESERVED, None) in r.shadow_writes(), r.shadow_writes())]
    finally:
        r.close()


def s_routing_gateway_down_alerts_still_work():
    r = Run({"a": {"usage": usage([grant("g1", [FABLE_W], 100)], seven_pct=60, fable_pct=100)}}, mode={"gw_down": 1})
    try:
        r.wait_for(lambda w: r.offer_urls(w))
        time.sleep(2.5)
        log = "\n".join(r.plugin_lines())
        return [("service still running with the gateway down", r.svc.poll() is None, r.svc.poll()),
                ("alert sent", len(r.offer_urls()) == 1, len(r.offer_urls())),
                ("failed credentials read logged; the shadow write still logged", "cooldown check skipped" in log and "excluded_models null -> " in log, log[-500:])]
    finally:
        r.close()


def five_hour(pct):
    return {"utilization": float(pct), "resets_at": iso(3)}


def s_routing_busy_fallback_and_partial_heal():
    busy = usage([], seven_pct=60, fable_pct=100)
    busy["five_hour"] = five_hour(100)
    blind = usage([], seven_pct=60, fable_pct=100)
    blind["five_hour"] = "unreadable"
    accts = {
        "busy": {"usage": busy, "excluded_models": FABLE},
        "blind": {"usage": blind, "excluded_models": FABLE},
        "healthy": {"usage": usage([], seven_pct=40, fable_pct=0)},
        "mixed": {"usage": usage([], seven_pct=50, fable_pct=0),
                  "cooldowns": [{"scope": "credential", "reason": "credential_quota", "retry_at": nano(80)},
                                {"scope": "credential", "reason": "unauthorized", "retry_at": nano(1)}]},
        "fablecd": {"usage": usage([], seven_pct=95, fable_pct=100), "excluded_models": FABLE,
                    "cooldowns": [{"scope": "model", "model_key": "claude-fable-5-2", "reason": "quota", "retry_at": nano(80)},
                                  {"scope": "credential", "reason": "credential_quota", "retry_at": nano(80)}]},
    }
    r = Run(accts, interval="60s")
    try:
        r.wait_line(lambda ln: ln.startswith("plan 1 "))
        return [("Fable-out accounts at five-hour 100% or unreadable are no fallback: Opus/Sonnet not reserved",
                 r.shadow_writes() == [], r.shadow_writes()),
                ("a stale cooldown is not cleared while a valid one shares the credential (non-quota, or Fable at 100%)",
                 r.cooldown_resets() == [], r.cooldown_resets())]
    finally:
        r.close()


def s_routing_failed_free_skips_reserve():
    out = subprocess.run([sys.executable, "-I", "-B", os.path.join(PLUGIN, "test", "differential.py"), "--cases", "3000",
                          "--report", os.path.join(tempfile.gettempdir(), "cq-claim-differential.txt")],
                         cwd=PLUGIN, capture_output=True, text=True)
    text = out.stdout + out.stderr
    m = re.search(r"reserve skipped after failed free (\d+)", text)
    same = out.returncode == 0 and "differences: 0" in text
    return [("a failed freeing write skips every reserving write (Go engine vs Python, random cases with failed writes)",
             same and m is not None and int(m.group(1)) > 0, text[-400:]),
            ("the skip is logged (the differential compares the skipped list)", same, text[-200:]),
            ("next cycle frees the fallback first, then reserves (write order compared case by case)", out.returncode == 0, text[-200:])]


def s_claim_reroutes_now():
    accts = {"a": {"usage": usage([grant("g1", [FABLE_W], 100)], seven_pct=60, fable_pct=100)},
             "b": {"usage": usage([], seven_pct=50, fable_pct=0)}}
    r = Run(accts, interval="60s")
    try:
        url = claimed_offer(r)
        r.wait_line(lambda ln: ln.startswith("plan 1 "))
        w = r.world()
        cycle = {n: to for n, _, to in r.shadow_writes()}
        r.apply_shadow_writes()
        reads, n = w["status_reads"], len(r.shadow_writes())
        code, html = r.post_claim(url)
        w = r.world()
        after = {n2: to for n2, _, to in r.shadow_writes()[n:]}
        return [("cycle: Fable excluded on a, Opus/Sonnet reserved on b",
                 cycle == {"claude-a.json": FABLE, "claude-b.json": RESERVED}, cycle),
                ("right after the Fable reset, routing clears both lists without waiting for a cycle",
                 code == 200 and after == {"claude-a.json": None, "claude-b.json": None}, (code, after)),
                ("no usage read for the other account (page, pre-claim and post-claim reads only)",
                 w["status_reads"] == reads + 3, (reads, w["status_reads"]))]
    finally:
        r.close()


def s_removed_account_is_no_fallback_after_claim():
    accts = {"a": {"usage": usage([], seven_pct=60, fable_pct=100)},
             "b": {"usage": usage([grant("g1", ["seven_day", FABLE_W], 100)], seven_pct=100, fable_pct=0)}}
    r = Run(accts, interval="60s")
    try:
        url = claimed_offer(r)
        wait_until(lambda: r.shadow_writes(), 8)
        time.sleep(0.5)
        r.apply_shadow_writes()
        n = len(r.shadow_writes())
        os.remove(os.path.join(r.tmp, "auth", "claude-a.json"))
        code, html = r.post_claim(url)
        after = {n2: to for n2, _, to in r.shadow_writes()[n:]}
        return [("an account removed since the last cycle does not reserve Opus/Sonnet away from the claimed one",
                 code == 200 and after == {"claude-b.json": None}, (code, after))]
    finally:
        r.close()


def s_expiring_offer_shows_windows():
    reset = (dt.datetime.now(UTC) + dt.timedelta(hours=72)).replace(minute=0, second=0, microsecond=0)
    g = grant("g1", ["seven_day", FABLE_W], 0, ends_h=20)
    g["percent_used"] = {"seven_day": 40, FABLE_W: 12}
    r = Run({"a": {"usage": usage([g], seven_pct=40, fable_pct=12, reset_at=reset.isoformat())}})
    try:
        url = claimed_offer(r)
        body = r.alerts()[0].get("body", "")
        code, html, _ = r.get(url)
        want = [f"weekly 40% used, resets {reset:%b %d %H:%M} UTC", f"Fable weekly 12% used, resets {reset:%b %d %H:%M} UTC"]
        return [("expiring alert states each cleared window's percent and natural reset", all(s in body for s in want), body),
                ("offer page states them too", code == 200 and all(s in html for s in want), html[-600:]),
                ("expiring offer stays claimable", 'name="nonce"' in html, None)]
    finally:
        r.close()


RULE_TESTS = {4: "TestFableOut", 9: "TestPlan", 11: "TestExpiredFallbackDoesNotHoldReservation"}
RULE_NAMES = ["limits missing, not a list, or not dicts -> unreadable", "no weekly_all or no Fable entry -> unreadable",
              "bool, string, NaN, inf or null percent -> unreadable", "Fable 100 or weekly 100 is out, 99.9 is not",
              "reserve at exactly 10% weekly left, not at 9.5%", "no Fable-out account with room -> nothing reserved",
              "every account Fable-out -> Fable excluded everywhere, nothing reserved", "single account -> no exclusion",
              "Haiku never excluded", "same set in another order is unchanged", "unread accounts never count",
              "past retry_at is not stale", "nanosecond retry_at with Z or offset parses and counts", "weekly at 100 keeps its cooldown",
              "five_hour at 100 or unreadable keeps its cooldown; null five_hour reads as 0",
              "Fable model cooldown kept while Fable is at 100; Opus one healed", "no cooldowns -> nothing", "non-quota reason is kept",
              "a Fable-out account at five-hour 100% or unreadable is no fallback; at 99.9% it is",
              "one valid future cooldown on the credential keeps every cooldown; past ones do not count"]


def routing_rules():
    """The Python pure-rule checks, now run as the Go rules tests that carry their numbers."""
    out = subprocess.run(["go", "test", "-count=1", "-v", "./rules/", "./rpc/", "-run", "^Test(ReadLimits|FableOut|Plan|Changed|StaleCooldowns|ExpiredFallbackDoesNotHoldReservation)"],
                         cwd=PLUGIN, capture_output=True, text=True)
    status = {}
    for m in re.finditer(r"--- (PASS|FAIL): (\S+)", out.stdout):
        status[m.group(2)] = m.group(1)
    checks = []
    for i, name in enumerate(RULE_NAMES, 1):
        if i in RULE_TESTS:
            got = {k: v for k, v in status.items() if k == RULE_TESTS[i]}
        else:
            got = {k: v for k, v in status.items() if re.search(rf"/{i}_", k)}
        checks.append((f"{i}. {name}", bool(got) and all(v == "PASS" for v in got.values()), got or out.stdout[-300:]))
    return checks


def replay_live_fixtures():
    def replay(prefix, now):
        files = sorted(os.path.join(HERE, "fixtures", f) for f in os.listdir(os.path.join(HERE, "fixtures")) if f.startswith(prefix))
        out = subprocess.run(["go", "run", "./cmd/replay", "--now", now] + files, cwd=PLUGIN, capture_output=True, text=True)
        return out, out.stdout.strip().splitlines()
    out, lines = replay("live-", "2026-11-09T20:20:00+00:00")
    out2, lines2 = replay("nov11-", "2026-11-11T13:00:00+00:00")
    fab, res = "['claude-fable-*']", "['claude-opus-*', 'claude-sonnet-*']"
    return [("replay exits 0", out.returncode == 0 and out2.returncode == 0, (out.stderr[-300:], out2.stderr[-300:])),
            ("2026-11-09 real data: no alerts, no schema problems; both weekly-out accounts lose Fable, nothing reserved",
             lines == ["acct167: none", "acctcs: none", "acctmain: none",
                       f"acct167: WOULD ROUTE weekly=100% fable=0% excluded_models None -> {fab}",
                       f"acctcs: WOULD ROUTE weekly=100% fable=0% excluded_models None -> {fab}",
                       "acctmain: routing unchanged weekly=47% fable=10% excluded_models None -> None"], lines),
            ("2026-11-11 real data: Fable-only limit offers launch-2610-fable, not full-reset-2611; Fable reserved on the account with Fable",
             lines2 == ["nov11-fable-left: none",
                        "nov11-fable-out: near_limit launch-2610-fable seven_day_overage_included 100",
                        "nov11-weekly-out: near_limit full-reset-2611 seven_day 100",
                        f"nov11-fable-left: WOULD ROUTE weekly=54% fable=0% excluded_models None -> {res}",
                        f"nov11-fable-out: WOULD ROUTE weekly=64% fable=100% excluded_models None -> {fab}",
                        f"nov11-weekly-out: WOULD ROUTE weekly=100% fable=0% excluded_models None -> {fab}"], lines2)]


# ---------------- new for the plugin ----------------

def s_panel_and_page_at_once():
    r = Run(one_near_limit_account(), mode={"claim": "slow"})
    try:
        url = claimed_offer(r)
        nonce = r.nonce(url)
        idx = r.auth_index("a")
        page, panel = parallel([lambda: r.post_claim(url, nonce=nonce), lambda: r.panel_claim("a", "g1", idx)])
        w = r.world()
        again = r.panel_claim("a", "g1", idx)
        answers = [page[1], panel[1].get("message", "")]
        claimed = [a for a in answers if "Reset claimed" in a]
        refused = [a for a in answers if "Reset claimed" not in a and ("is done" in a or "last offer is DONE" in a)]
        return [("panel and page tapped at once -> one claim, one spend", len(w["claims"]) == 1 and sum(w["spent"].values()) == 1, (len(w["claims"]), w["spent"])),
                ("one interface gets the reset, the other is told it is done, whichever ran first", len(claimed) == 1 and len(refused) == 1, (page[0], panel)),
                ("the panel answer carries the settled offer state", panel[1].get("state") == "DONE", panel[1]),
                ("a later panel claim of the spent grant names its DONE offer and sends nothing",
                 again[0] == 200 and "last offer is DONE" in again[1].get("message", "") and again[1].get("state") == "DONE" and len(r.world()["claims"]) == 1, again)]
    finally:
        r.close()


def s_lost_reply_then_other_interface():
    r = Run(one_near_limit_account(), mode={"claim": "drop_no_spend"})
    try:
        url = claimed_offer(r)
        r.post_claim(url)
        st1 = offer(r)["state"]
        code, body = r.panel_claim("a", "g1")
        w = r.world()
        ids = [c["request_id"] for c in w["claims"]]
        first = [
            ("page tap with a lost reply -> UNKNOWN", st1 == "UNKNOWN", st1),
            ("the panel re-sends the same request_id", len(ids) == 2 and ids[0] == ids[1], ids),
            ("the panel claim settles the same offer to DONE, one spend", code == 200 and offer(r)["state"] == "DONE" and sum(w["spent"].values()) == 1, (code, body, w["spent"])),
        ]
    finally:
        r.close()
    r = Run(one_near_limit_account(), mode={"claim": "drop_no_spend"})
    try:
        url = claimed_offer(r)
        code1, body1 = r.panel_claim("a", "g1")
        st1 = offer(r)["state"]
        code, html = r.post_claim(url)
        w = r.world()
        ids = [c["request_id"] for c in w["claims"]]
        return first + [
            ("panel claim with a lost reply -> the offer from the alert is UNKNOWN", code1 == 502 and st1 == "UNKNOWN" and len(r.state()["offers"]) == 1, (code1, body1, st1)),
            ("the page re-sends the same request_id", len(ids) == 2 and ids[0] == ids[1], ids),
            ("the page settles it to DONE, one spend", code == 200 and offer(r)["state"] == "DONE" and sum(w["spent"].values()) == 1, (code, w["spent"])),
        ]
    finally:
        r.close()


def s_hot_reload_during_claim():
    r = Run(one_near_limit_account(), mode={"claim": "slow", "slow_s": 4})
    try:
        url = claimed_offer(r)
        nonce = r.nonce(url)
        res = []
        t = threading.Thread(target=lambda: res.append(r.post_claim(url, nonce=nonce)))
        t.start()
        r.wait_for(lambda w: len(w["claims"]) >= 1, timeout=10)
        r.reload_plugin()
        reloaded = wait_until(lambda: "plugin hot reloaded" in r.logtext(), 30)
        t.join()
        wait_until(lambda: len(r.running_engines()) == 1 and sum("running (mode" in ln for ln in r.plugin_lines()) >= 2, 30)
        time.sleep(2.5)
        w = r.world()
        o = offer(r)
        again = r.post_claim(url, nonce=nonce)
        w2 = r.world()
        return [("the gateway hot reloaded while the claim was in flight", reloaded, None),
                ("the claim answered and was sent once", res and res[0][0] == 200 and "Reset claimed" in res[0][1] and len(w["claims"]) == 1, (res and res[0][0], len(w["claims"]))),
                ("the offer settled to DONE, not SENDING or UNKNOWN", o["state"] == "DONE", o["state"]),
                ("after the reload exactly one engine runs", len(r.running_engines()) == 1, r.running_engines()),
                ("a tap on the new copy is refused as done; nothing more is sent", again[0] == 409 and len(w2["claims"]) == 1, (again[0], len(w2["claims"])))]
    finally:
        r.close()


def s_stale_wider_offer_refused():
    full = grant("full-reset", ["seven_day", FABLE_W], 100, ends_h=24 * 30)
    full["percent_used"] = {"seven_day": 64, FABLE_W: 100}
    r = Run({"a": {"usage": usage([full], seven_pct=64, fable_pct=100)}})
    try:
        url = claimed_offer(r)
        first = offer(r)["grant_id"]
        w = r.world()
        token = next(iter(w["accounts"]))
        u = w["accounts"][token]
        u["cedar_ember"]["grants"].append(grant("fable-only", [FABLE_W], 100, ends_h=24 * 120))
        r.ctl("set", {"accounts": {token: u}})
        code, html = r.post_claim(url)
        w = r.world()
        return [("the first offer is for the only grant then, the wide one", first == "full-reset", first),
                ("the wide offer is refused once a narrower grant covers the window", code == 409 and "fable-only" in html, (code, html[-400:])),
                ("nothing was swapped: no claim, no email", w["claims"] == [] and w["emails"] == [], (w["claims"], len(w["emails"])))]
    finally:
        r.close()


def s_replaced_auth_file_refused():
    r = Run(one_near_limit_account())
    try:
        url = claimed_offer(r)
        bound = offer(r).get("org")
        r.set_auth("a", organization_uuid="org-someone-else")
        code, html = r.post_claim(url)
        w = r.world()
        return [("the offer is bound to the account's organization at creation", bound == "org-a", bound),
                ("an auth file that now holds another organization is refused", code == 409 and "organization" in html, (code, html[-300:])),
                ("no claim, no email", w["claims"] == [] and w["emails"] == [], (w["claims"], len(w["emails"])))]
    finally:
        r.close()


def s_natural_reset_every_account_excluded():
    soon = (dt.datetime.now(UTC) + dt.timedelta(seconds=14)).isoformat()
    accts = {lb: {"usage": usage([], seven_pct=60, fable_pct=100, reset_at=soon), "excluded_models": FABLE} for lb in ("x", "y")}
    r = Run(accts, interval="60s")
    try:
        r.wait_line(lambda ln: ln.startswith("plan 1 "))
        before = r.shadow_writes()
        w = r.world()
        later = (dt.datetime.now(UTC) + dt.timedelta(days=7)).isoformat()
        for tok in w["accounts"]:
            w["accounts"][tok] = usage([], seven_pct=0, fable_pct=0, reset_at=later)
        r.ctl("set", {"accounts": w["accounts"]})
        reset_at = dt.datetime.fromisoformat(soon)
        wait_until(lambda: len(r.shadow_writes()) >= 2, 25)
        got = {n: to for n, _, to in r.shadow_writes()}
        when = dt.datetime.now(UTC)
        return [("every account excludes Fable before the reset; nothing to write", before == [], before),
                ("at the window's reset time the plan frees Fable on every account, without waiting for the 60 s poll",
                 got == {"claude-x.json": None, "claude-y.json": None} and (when - reset_at).total_seconds() < 5, (got, (when - reset_at).total_seconds()))]
    finally:
        r.close()


def s_read_fails_during_swap():
    accts = {"a": {"usage": usage([], seven_pct=60, fable_pct=100)}, "b": {"usage": usage([], seven_pct=50, fable_pct=0)}}
    r = Run(accts, interval="2s")
    try:
        r.wait_line(lambda ln: ln.startswith("plan 1 "))
        first = {n: to for n, _, to in r.shadow_writes()}
        r.apply_shadow_writes()
        n = len(r.shadow_writes())
        w = r.world()
        tok_a = next(t for t, u in w["accounts"].items() if u["limits"][1]["percent"] == 100)
        r.ctl("mode", {"usage_fail": [tok_a]})
        mark = len(r.plugin_lines())
        wait_until(lambda: any("usage read failed" in ln for ln in r.plugin_lines()[mark:]), 8)
        wait_until(lambda: any(ln.startswith("plan ") for ln in r.plugin_lines()[mark:]), 8)
        time.sleep(0.5)
        after = {n2: to for n2, _, to in r.shadow_writes()[n:]}
        return [("cycle: Fable out on a, Opus/Sonnet reserved on b", first == {"claude-a.json": FABLE, "claude-b.json": RESERVED}, first),
                ("a's usage read fails: a is left out, so b's reservation is released (a is no fallback)",
                 after == {"claude-b.json": None}, after)]
    finally:
        r.close()


def s_python_reads_plugin_state():
    r = Run(one_near_limit_account())
    try:
        url = claimed_offer(r)
        nonce = r.nonce(url)
        r.post_claim(url, nonce=nonce)
        token = url.rsplit("/", 1)[1]
        path = r.state_path()
        with open(path, "rb") as f:
            plugin_bytes = f.read()
        copy = os.path.join(r.tmp, "python-copy", "state.json")
        os.makedirs(os.path.dirname(copy))
        shutil.copy(path, copy)
        sys.path.insert(0, os.path.join(HERE, "reference"))
        import decide  # noqa: E402
        from store import Store  # noqa: E402
        s = Store(copy)
        data = s.read()
        with s.tx():
            pass
        with open(copy, "rb") as f:
            python_bytes = f.read()
        oid = hashlib.sha256(token.encode()).hexdigest()
        py_nonce = hmac.new(bytes.fromhex(data["csrf_key"]), oid.encode(), "sha256").hexdigest()[:32]
        o = data["offers"].get(oid, {})
        times = [o.get(k) for k in ("created_at", "expires_at", "window_reset")] + [o.get("after", {}).get("at")] + list(data["sent"].values())
        return [("store.py reads the plugin's state file; the offer is under sha256(token)", o.get("state") == "DONE", sorted(data["offers"])),
                ("store.py writes the same bytes back", python_bytes == plugin_bytes, (len(plugin_bytes), len(python_bytes))),
                ("Python derives the page's nonce from the plugin's csrf_key", py_nonce == nonce, (py_nonce, nonce)),
                ("Python parses every time the plugin wrote", all(decide.parse_time(t) is not None for t in times), times)]
    finally:
        r.close()


def s_caddy_paths():
    r = Run(one_near_limit_account())
    try:
        url = claimed_offer(r)
        token = url.rsplit("/", 1)[1]
        nonce = r.nonce(url)
        injected = r.get(url + "?token=" + "x" * 30)
        mismatch = r.post_claim(url, nonce=nonce, fields={"token": "y" * 43})
        big = r._send(urllib.request.Request(url + "/claim", b"nonce=" + nonce.encode() + b"&pad=" + b"z" * 5000,
                                             {"Origin": r.origin, "Content-Type": "application/x-www-form-urlencoded"}))
        direct = r._send(urllib.request.Request(r.gw + ROUTE + "/offer/claim?token=" + token, f"nonce={nonce}".encode(),
                                                {"Origin": r.origin, "Content-Type": "application/x-www-form-urlencoded"}))
        other = r.get(r.origin + "/v0/management/config")
        health_via_reset = r.get(r.base + "/offer/" + token + "/health")
        w = r.world()
        return [("a client ?token= on the page URL is dropped by the rewrite (page still for the path token)", injected[0] == 200 and "g1" in injected[1], injected[0]),
                ("a form token that differs from the path token is refused", mismatch[0] == 400, mismatch),
                ("a claim body over 4 KB is refused", big[0] == 413, big[0]),
                ("the claim route without the management key is refused by the gateway", direct[0] == 401, direct[0]),
                ("Caddy adds no key to other management paths", other[0] == 401, other[0]),
                ("Caddy adds no key to other /reset/offer/... paths", health_via_reset[0] == 404, health_via_reset[0]),
                ("none of these claimed or emailed", w["claims"] == [] and w["emails"] == [], (len(w["claims"]), len(w["emails"])))]
    finally:
        r.close()


def s_credentials_read_again_after_boot():
    accts = {"fableleft": {"usage": usage([], seven_pct=54, fable_pct=0),
                           "cooldowns": [{"scope": "credential", "reason": "credential_quota", "retry_at": nano(80)}]}}
    r = Run(accts, interval="60s", mode={"gw_down": 1})
    try:
        r.wait_line(lambda ln: ln.startswith("plan 1 "))
        skipped = r.wait_line(lambda ln: ln.startswith("cooldown check skipped"), 2)
        at_start = r.cooldown_resets()
        r.ctl("mode", {"gw_down": 0})
        t0 = time.time()
        healed = wait_until(lambda: r.cooldown_resets(), 25)
        took = round(time.time() - t0, 1)
        retried = [ln for ln in r.plugin_lines() if ln.startswith("plan ") and "(credentials retry)" in ln]
        reads = r.world()["status_reads"]
        return [("the start cycle's credentials read fails, as at gateway boot, and heals nothing", skipped and at_start == [], at_start),
                ("the credentials are read again within seconds and the stale cooldown is healed, without the 60 s poll",
                 healed and took < 20 and retried, (r.cooldown_resets(), took, retried)),
                ("the retry reads no usage", reads == 1, reads)]
    finally:
        r.close()


def expiring_account():
    """A grant that ends in 20 h with two resets left and nothing used: only the 24 h expiry reminder offers it."""
    return {"a": {"usage": usage([grant("g1", ["seven_day"], 0, left=2, ends_h=20)], seven_pct=0)}}


def resets_left(w):
    return next(iter(w["accounts"].values()))["cedar_ember"]["grants"][0]["resets_left"]


def s_panel_after_page_claim_spends_once():
    r = Run(expiring_account(), mode={"claim": "slow", "slow_s": 2})
    try:
        url = claimed_offer(r)
        page = []
        t = threading.Thread(target=lambda: page.append(r.post_claim(url)))
        t.start()
        r.wait_for(lambda w: len(w["claims"]) >= 1, timeout=10)
        panel = r.panel_claim("a", "g1")
        t.join()
        time.sleep(2.5)
        w = r.world()
        offers = r.state()["offers"]
        queued = [
            ("the page claims the 24 h expiry offer", page and page[0][0] == 200 and "Reset claimed" in page[0][1], page and page[0][0]),
            ("a panel tap queued behind it sends no second claim: one spend, one reset left",
             len(w["claims"]) == 1 and sum(w["spent"].values()) == 1 and resets_left(w) == 1, (len(w["claims"]), w["spent"], resets_left(w))),
            ("the panel answer names the page's DONE offer", panel[0] == 200 and panel[1].get("state") == "DONE" and panel[1].get("offer_id") in offers, panel),
            ("no new offer or alert for the used reminder", len(offers) == 1 and len(r.offer_urls(w)) == 1, (len(offers), len(r.offer_urls(w)))),
        ]
    finally:
        r.close()
    r = Run(expiring_account())
    try:
        url = claimed_offer(r)
        nonce = r.nonce(url)
        panel = r.panel_claim("a", "g1")
        page = r.post_claim(url, nonce=nonce)
        w = r.world()
        reverse = [
            ("reverse order: the panel claims the alert's offer", panel[0] == 200 and "Reset claimed" in panel[1].get("message", "") and len(r.state()["offers"]) == 1, panel),
            ("reverse order: the page tap is refused as done; one claim, one spend",
             page[0] == 409 and len(w["claims"]) == 1 and sum(w["spent"].values()) == 1, (page[0], len(w["claims"]), w["spent"])),
        ]
    finally:
        r.close()
    both = grant("g1", [FABLE_W], 95, left=2, ends_h=20)
    r = Run({"a": {"usage": usage([both], fable_pct=95)}}, interval="60s", mode={"bark_fail": 1})
    try:
        url = claimed_offer(r)
        kinds = [o["kind"] for o in r.state()["offers"].values()]
        page = r.post_claim(url)
        panel = r.panel_claim("a", "g1")
        w = r.world()
        return queued + reverse + [
            ("the expiry reminder's push failed, so only the near-limit offer exists", kinds == ["near_limit"], kinds),
            ("the page claims the near-limit offer", page[0] == 200 and "Reset claimed" in page[1], page[0]),
            ("a panel tap after it makes no offer from the unsent reminder of the same grant: one claim, one spend",
             len(w["claims"]) == 1 and sum(w["spent"].values()) == 1 and len(r.state()["offers"]) == 1, (len(w["claims"]), w["spent"], panel)),
        ]
    finally:
        r.close()


def s_email_change_keeps_the_claim_on_the_account():
    r = Run(one_near_limit_account(), mode={"claim": "drop_no_spend"})
    try:
        url = claimed_offer(r)
        first_id = offer_id_of(url)
        r.post_claim(url)
        st1 = offer(r)["state"]
        r.set_auth("a", email="a-renamed@example.com")
        polls = len([ln for ln in r.plugin_lines() if "(poll)" in ln])
        polled = wait_until(lambda: len([ln for ln in r.plugin_lines() if "(poll)" in ln]) >= polls + 2, 8)
        repeated = r.offer_urls()[1:]
        w = r.world()
        token = next(iter(w["accounts"]))
        u = w["accounts"][token]
        moved = iso(75)
        u["seven_day"]["resets_at"] = moved
        for lim in u["limits"]:
            lim["resets_at"] = moved
        r.ctl("set", {"accounts": {token: u}})
        w = r.wait_for(lambda w: len(r.offer_urls(w)) >= 2)
        urls = r.offer_urls(w)
        again = r.post_claim(urls[-1]) if len(urls) >= 2 else (0, "no second alert")
        claims_after_page = len(r.world()["claims"])
        code, body = r.panel_claim("a", "g1")
        w = r.world()
        ids = [c["request_id"] for c in w["claims"]]
        offers = r.state()["offers"]
        others = [o["state"] for k, o in offers.items() if k != first_id]
        unknown = [
            ("a page tap with a lost reply -> UNKNOWN", st1 == "UNKNOWN", st1),
            ("after the account's email changes, the same alert is not sent again: the account's UNKNOWN offer holds it",
             polled and repeated == [], (polled, repeated)),
            ("once the window's reset moves (a new alert), a tap on it is refused while the first claim is unknown",
             again[0] == 409 and "unknown outcome" in again[1] and claims_after_page == 1, (again[0], claims_after_page)),
            ("the panel re-sends the first claim's request_id", len(ids) == 2 and ids[0] == ids[1], ids),
            ("the panel settles the first offer to DONE, one spend", code == 200 and body.get("offer_id") == first_id and offers[first_id]["state"] == "DONE" and sum(w["spent"].values()) == 1, (code, body, w["spent"])),
            ("the offer made under the new email expires as the claimed offer's sibling", others and all(s == "EXPIRED" for s in others), others),
        ]
    finally:
        r.close()
    r = Run(one_near_limit_account(), mode={"claim": "drop_after_spend"})
    try:
        url = claimed_offer(r)
        r.post_claim(url)
        st1 = offer(r)["state"]
        r.set_auth("a", email="a-renamed@example.com")
        settled = wait_until(lambda: offer(r)["state"] == "DONE", 8)
        w = r.world()
        return unknown + [
            ("a lost reply after the spend -> UNKNOWN", st1 == "UNKNOWN", st1),
            ("after the email change a status read still settles it to DONE; nothing is re-sent", settled and len(w["claims"]) == 1, (offer(r)["state"], len(w["claims"]))),
        ]
    finally:
        r.close()


def nearest_hour(t):
    return (dt.datetime.fromisoformat(t) + dt.timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0).isoformat()


def s_legacy_offers_used_after_email_change():
    reset, ends = iso(72), iso(20)
    near = grant("g1", [FABLE_W], 95, left=3)
    soon = grant("g2", ["seven_day"], 0, left=2)
    soon["ends_at"] = ends

    def python_state(auth):
        """Offers as the Python service stored them (no key, no org), made while the account's email was a-old@."""
        common = {"label": "a-old@example.com", "auth_file": os.path.join(auth, "claude-a.json"), "created_at": iso(-0.5)}
        return {"offers": {
            "legacy-near": {**common, "kind": "near_limit", "grant_id": "g1", "clears": [FABLE_W], "window": FABLE_W,
                            "window_reset": reset, "pct_at_alert": 95, "expires_at": iso(48), "state": "DONE", "result": "reset",
                            "title": "Claude Fable weekly limit 95% used", "after": {"resets_left": 3, "pct": 0, "at": iso(-0.4)}},
            "legacy-expiring": {**common, "kind": "expiring", "grant_id": "g2", "clears": ["seven_day"], "window": "seven_day",
                                "window_reset": None, "pct_at_alert": None, "expires_at": ends, "state": "CLOSED", "result": "unavailable_forever",
                                "title": "Claude reset expires in 20 h", "after": {"resets_left": 2, "pct": 0, "at": iso(-0.4)}}},
            "sent": {f"a-old@example.com|near|{FABLE_W}|{nearest_hour(reset)}": iso(-0.5),
                     f"a-old@example.com|expiring-24h|g2|{ends}": iso(-0.5)}}

    r = Run({"a": {"usage": usage([near, soon], fable_pct=95, reset_at=reset)}}, state=python_state)
    try:
        polled = r.wait_line(lambda ln: "(poll)" in ln and ln.startswith("plan "), 10)
        alerts = r.offer_urls()
        p_near = r.panel_claim("a", "g1")
        p_soon = r.panel_claim("a", "g2")
        w = r.world()
        offers = r.state()["offers"]
        return [("the account (email now a@) is read and planned at least twice", polled, polled),
                ("no new alert for the alerts the Python offers (made under a-old@) already used", alerts == [], alerts),
                ("the panel refuses g1: its near-limit alert was used by the legacy DONE offer",
                 p_near[0] == 200 and "already used" in p_near[1].get("message", "") and p_near[1].get("offer_id") == "legacy-near", p_near),
                ("the panel refuses g2: its 24 h expiry alert was used by the legacy CLOSED offer",
                 p_soon[0] == 200 and "already used" in p_soon[1].get("message", "") and p_soon[1].get("offer_id") == "legacy-expiring", p_soon),
                ("no claim, no new offer", w["claims"] == [] and sorted(offers) == ["legacy-expiring", "legacy-near"], (w["claims"], sorted(offers)))]
    finally:
        r.close()


def s_narrower_grant_after_wide_alert_claims_from_panel():
    full = grant("full-reset", ["seven_day", FABLE_W], 100, ends_h=24 * 30)
    full["percent_used"] = {"seven_day": 64, FABLE_W: 100}
    r = Run({"a": {"usage": usage([full], seven_pct=64, fable_pct=100)}})
    try:
        url = claimed_offer(r)
        nonce = r.nonce(url)
        w = r.world()
        token = next(iter(w["accounts"]))
        u = w["accounts"][token]
        u["cedar_ember"]["grants"].append(grant("fable-only", [FABLE_W], 100, left=2, ends_h=24 * 120))
        r.ctl("set", {"accounts": {token: u}})
        page = r.post_claim(url, nonce=nonce)
        panel = r.panel_claim("a", "fable-only")
        again = r.post_claim(url, nonce=nonce)
        w = r.world()
        states = {o["grant_id"]: o["state"] for o in r.state()["offers"].values()}
        return [("the page refuses the wide offer and names the narrower grant", page[0] == 409 and "fable-only" in page[1], page[0]),
                ("the panel claims the narrower grant: the open wide offer sent nothing, so the alert is not used",
                 panel[0] == 200 and "Reset claimed" in panel[1].get("message", ""), panel),
                ("one claim, on the narrower grant", [c["grant_id"] for c in w["claims"]] == ["fable-only"] and w["spent"] == {"org-a|fable-only": 1},
                 (w["claims"], w["spent"])),
                ("the wide offer expires as the claim's sibling and a later tap on it is refused",
                 states.get("full-reset") == "EXPIRED" and again[0] == 409 and len(w["claims"]) == 1, (states, again[0]))]
    finally:
        r.close()


def s_same_email_other_org_claims_from_panel():
    reset = iso(72)
    accts = {label: {"email": "same@example.com", "usage": usage([grant("g1", [FABLE_W], 95, left=2)], fable_pct=95, reset_at=reset)}
             for label in ("a", "b")}
    r = Run(accts)
    try:
        url = claimed_offer(r)
        polled = r.wait_line(lambda ln: "(poll)" in ln and ln.startswith("plan "), 10)
        alerts = r.offer_urls()
        offers = list(r.state()["offers"].values())
        # Both accounts share the dedupe key, so whichever is planned first gets the one alert.
        alerted = offers[0]["org"] if len(offers) == 1 else None
        other = "b" if alerted == "org-a" else "a"
        panel = r.panel_claim(other, "g1")
        page = r.post_claim(url)
        w = r.world()
        return [("one organization gets the alert; the other, same email and same dedupe key, gets none (the Python sent-map dedupe)",
                 polled and len(alerts) == 1 and alerted in ("org-a", "org-b"), (polled, alerts, alerted)),
                ("the panel claims g1 on the other organization: one org's alert is not the other's", panel[0] == 200 and "Reset claimed" in panel[1].get("message", ""), panel),
                ("the alerted organization's page tap still claims its own offer", page[0] == 200 and "Reset claimed" in page[1], page[0]),
                ("one spend per organization", w["spent"] == {"org-a|g1": 1, "org-b|g1": 1}, w["spent"])]
    finally:
        r.close()


def offer_id_of(url):
    return hashlib.sha256(url.rsplit("/", 1)[1].encode()).hexdigest()


SCENARIOS = [replay_live_fixtures, routing_rules, s_routing_busy_fallback_and_partial_heal, s_routing_failed_free_skips_reserve,
             s_claim_reroutes_now, s_removed_account_is_no_fallback_after_claim, s_expiring_offer_shows_windows, s_real_browser_claim, s_jittered_reset_one_alert,
             s_fable_only_limit_offers_narrow_grant, s_claim_clears_gateway_cooldown, s_claim_gateway_down_still_done,
             s_routing_applies_and_heals, s_routing_no_reserve_clears_old_list, s_routing_gateway_down_alerts_still_work, s_near_limit_alert_once, s_below_threshold_and_near_reset_no_alert, s_two_grants_one_offer,
             s_get_is_read_only_and_post_guards, s_happy_claim, s_concurrent_taps, s_lost_response_after_spend,
             s_lost_response_no_spend_retry_same_id, s_late_tap_refused, s_before_email_fails_no_claim,
             s_after_email_fails_bark_fallback, s_cooldown_back_to_offered, s_off_switch, s_bark_fail_retries,
             s_expiry_alerts, s_schema_problem_isolated, s_expired_token_skipped, s_no_secrets_in_logs,
             s_two_offers_same_grant_concurrent, s_retry_form_action_absolute, s_disabled_account_refused,
             s_malformed_claim_reply_unknown, s_missing_grant_not_confirmed, s_expired_unknown_no_resend,
             s_crash_in_sending_recovers, s_config_typo_exits, s_revoked_token_alerts,
             s_sibling_after_lost_reply_refused, s_multi_window_grant_siblings_expire, s_malformed_fields_fail_closed,
             s_bad_interval_exits, s_email_protocol_error_bark_fallback, s_string_eligible_blocks_claim]
NEW = [s_panel_and_page_at_once, s_lost_reply_then_other_interface, s_hot_reload_during_claim, s_stale_wider_offer_refused,
       s_replaced_auth_file_refused, s_natural_reset_every_account_excluded, s_read_fails_during_swap,
       s_python_reads_plugin_state, s_caddy_paths, s_panel_after_page_claim_spends_once,
       s_email_change_keeps_the_claim_on_the_account, s_credentials_read_again_after_boot,
       s_legacy_offers_used_after_email_change, s_narrower_grant_after_wide_alert_claims_from_panel,
       s_same_email_other_org_claims_from_panel]


def main():
    only = sys.argv[1:]
    build()
    lines, failed, total = [], 0, 0
    for group, scenarios in (("moved from fleet services/claude-reset", SCENARIOS), ("new for the plugin", NEW)):
        lines.append(f"# {group}")
        for sc in scenarios:
            if only and sc.__name__ not in only:
                continue
            try:
                checks = sc()
            except Exception as e:  # report a crashed scenario as a failure
                checks = [("scenario ran", False, repr(e))]
            lines.append(f"## {sc.__name__}")
            for name, ok, detail in checks:
                total += 1
                failed += not ok
                lines.append(f"  {'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"   -> {str(detail)[:400]}"))
            print("\n".join(lines[-len(checks) - 1:]), flush=True)
    lines.append(f"\n{total - failed} of {total} checks passed")
    report = "\n".join(lines)
    print(lines[-1])
    with open(os.path.join(HERE, "e2e-report.txt"), "w") as f:
        f.write(f"claude-quota claim e2e run {dt.datetime.now(UTC).isoformat()}\n"
                f"gateway built from {REPO}, plugin built with -tags claude_quota_e2e, caddy/reset.caddy on Caddy\n\n{report}\n")
    shutil.rmtree(BUILD["dir"], ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
