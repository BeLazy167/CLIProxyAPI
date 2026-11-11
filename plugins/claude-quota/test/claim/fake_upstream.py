"""Fake Anthropic, Bark and Resend endpoints, and a recording proxy to the real gateway's management API.

One HTTP server stands in for the three upstreams. The plugin's management_base points here: reads of
/v8/management/credentials go to the real gateway under test, and the test's cooldowns are laid over its
reply, since a gateway with fake tokens never sees a real 429. Tests drive the server through /_ctl/* and
read back every request it received.
"""

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCK = threading.Lock()
WORLD = {
    "accounts": {},  # bearer token -> usage JSON (with cedar_ember)
    "orgs": {},  # org uuid -> bearer token
    "claims": [],  # every claim request body received
    "spent": {},  # "org|grant" -> number of resets actually spent
    "bark": [],
    "emails": [],
    "status_reads": 0,
    "mode": {},  # claim, usage, bark, email, gateway behaviour switches
    "gateway": {"key": "", "real": "", "cooldowns": {}},  # cooldowns: auth file name -> list laid over the real reply
    "gw_calls": [],  # every management request from the plugin: method, path, body, authorized
}
GW_PATHS = ("/v8/management/credentials", "/v8/management/credentials/fields", "/v8/management/routing/cooldown/reset")


def _grant(usage, grant_id):
    for g in usage["cedar_ember"]["grants"]:
        if g["id"] == grant_id:
            return g
    return None


def _apply_claim(token, grant_id):
    usage = WORLD["accounts"][token]
    g = _grant(usage, grant_id)
    if g is None or g["resets_left"] <= 0:
        return {"result": "already_used", "resets_left": 0}
    g["resets_left"] -= 1
    g["usable_now"] = g["resets_left"] > 0
    for w in g["clears"]:
        g["percent_used"][w] = 0
        if w == "seven_day":
            usage["seven_day"]["utilization"] = 0.0
        for lim in usage.get("limits", []):
            if (w, lim["kind"]) in (("seven_day_overage_included", "weekly_scoped"), ("seven_day", "weekly_all")):
                lim["percent"] = 0
    return {"result": "reset", "resets_left": g["resets_left"], "cleared": g["clears"]}


def _spend(org, token, grant_id):
    res = _apply_claim(token, grant_id)
    if res["result"] == "reset":
        key = f"{org}|{grant_id}"
        WORLD["spent"][key] = WORLD["spent"].get(key, 0) + 1
    return res


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, obj):
        # Python writes an infinite float as the non-JSON token Infinity; 1e400 is the JSON a server sends,
        # and both Python and Go read it as infinity.
        body = json.dumps(obj).replace("Infinity", "1e400").encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        return json.loads(raw) if raw else {}

    def _gateway(self, method):
        body = self._body() if method != "GET" else None
        with LOCK:
            gw = WORLD["gateway"]
            ok = self.headers.get("Authorization") == f"Bearer {gw['key']}"
            WORLD["gw_calls"].append({"method": method, "path": self.path, "body": body, "authorized": ok})
            down = WORLD["mode"].get("gw_down")
            real, key, overlay = gw["real"], gw["key"], dict(gw["cooldowns"])
        if not ok:
            return self._send(401, {"error": "bad management key"})
        if down:
            return self._send(500, {"error": "down"})
        if method != "GET":
            return self._send(500, {"error": "the plugin under test must not write to the gateway"})
        req = urllib.request.Request(real + self.path, headers={"Authorization": f"Bearer {key}"})
        # The plugin's first cycle runs while the gateway is still booting; wait for its HTTP server, as the
        # Python service's gateway was always up when it started.
        for _ in range(100):
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    reply = json.loads(r.read())
                break
            except ConnectionRefusedError:
                time.sleep(0.1)
            except urllib.error.URLError as e:
                if not isinstance(e.reason, ConnectionRefusedError):
                    return self._send(502, {"error": f"real gateway: {type(e).__name__}"})
                time.sleep(0.1)
            except (OSError, ValueError) as e:
                return self._send(502, {"error": f"real gateway: {type(e).__name__}"})
        else:
            return self._send(502, {"error": "real gateway not listening"})
        for f in reply.get("files") or []:
            if f.get("name") in overlay:
                f["cooldowns"] = overlay[f["name"]]
        return self._send(200, reply)

    def do_PATCH(self):
        if self.path in GW_PATHS:
            return self._gateway("PATCH")
        self._send(404, {})

    def do_GET(self):
        if self.path in GW_PATHS:
            return self._gateway("GET")
        if self.path == "/_ctl/world":
            with LOCK:
                return self._send(200, WORLD)
        if self.path.startswith("/api/oauth/usage"):
            token = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
            with LOCK:
                WORLD["status_reads"] += 1
                usage = WORLD["accounts"].get(token)
                if token in WORLD["mode"].get("usage_fail", []):
                    return self._send(500, {"error": "fake usage failure"})
                if usage is None:
                    return self._send(401, {"error": {"message": "bad token"}})
                return self._send(200, usage)
        self._send(404, {})

    def do_POST(self):
        if self.path in GW_PATHS:
            return self._gateway("POST")
        body = self._body()
        if self.path == "/_ctl/set":
            with LOCK:
                WORLD.update(body)
            return self._send(200, {"ok": True})
        if self.path == "/_ctl/mode":
            with LOCK:
                WORLD["mode"].update(body)
            return self._send(200, {"ok": True})
        if self.path.startswith("/api/organizations/") and self.path.endswith("/reset_rate_limits"):
            return self._claim(body)
        if self.path == "/emails":
            with LOCK:
                if WORLD["mode"].get("email_garbage") and not WORLD["mode"].get("email_ok_first"):
                    WORLD["mode"]["email_garbage"] = 0
                    WORLD["emails"].append({**body, "auth": self.headers.get("Authorization"), "failed": True})
                    self.wfile.write(b"NOT-HTTP garbage\r\n\r\n")
                    self.close_connection = True
                    return None
                skip = WORLD["mode"].get("email_ok_first", 0)
                fail = 0 if skip else WORLD["mode"].get("email_fail", 0)
                if skip:
                    WORLD["mode"]["email_ok_first"] = skip - 1
                WORLD["emails"].append({**body, "auth": self.headers.get("Authorization"), "failed": bool(fail)})
                if fail:
                    WORLD["mode"]["email_fail"] = fail - 1
                    return self._send(500, {"error": "boom"})
            return self._send(200, {"id": "em_1"})
        # Bark: POST /<device key>
        with LOCK:
            fail = WORLD["mode"].get("bark_fail", 0)
            WORLD["bark"].append({"path": self.path, **body, "failed": bool(fail)})
            if fail:
                WORLD["mode"]["bark_fail"] = fail - 1
                return self._send(500, {"code": 500})
        return self._send(200, {"code": 200})

    def _claim(self, body):
        org = self.path.split("/")[3]
        with LOCK:
            WORLD["claims"].append({"org": org, **body})
            token = WORLD["orgs"].get(org)
            mode = WORLD["mode"].get("claim", "normal")
            slow = WORLD["mode"].get("slow_s", 0.5)
            if mode == "cooldown":
                WORLD["mode"]["claim"] = "normal"
                return self._send(200, {"result": "cooldown", "cooldown_until": body.get("_cd") or "2026-01-01T00:00:00Z"})
            if mode == "drop_after_spend":
                WORLD["mode"]["claim"] = "normal"
                _spend(org, token, body["grant_id"])
                self.close_connection = True
                self.send_response(502)
                self.end_headers()
                return None
            if mode == "drop_no_spend":
                WORLD["mode"]["claim"] = "normal"
                self.send_response(502)
                self.end_headers()
                return None
            if mode == "empty_200":
                WORLD["mode"]["claim"] = "normal"
                return self._send(200, {})
        if mode == "slow":
            time.sleep(slow)  # outside the lock, so the test can read the world while a claim is in flight
        with LOCK:
            res = _spend(org, token, body["grant_id"])
        try:
            return self._send(200, res)
        except OSError:
            return None  # the caller is gone (killed mid-claim); the spend above still happened


def main():
    port = int(sys.argv[1])
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
