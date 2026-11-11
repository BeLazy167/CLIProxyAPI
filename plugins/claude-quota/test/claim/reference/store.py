"""State file with one in-process lock. The service is the only writer."""

import contextlib
import json
import os
import secrets
import threading


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        os.makedirs(os.path.dirname(path), exist_ok=True)

    def _load(self):
        try:
            with open(self.path) as f:
                data = json.load(f)
        except FileNotFoundError:
            data = {}
        data.setdefault("offers", {})
        data.setdefault("sent", {})
        data.setdefault("csrf_key", secrets.token_hex(32))
        return data

    def _save(self, data):
        tmp = self.path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=1, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)

    @contextlib.contextmanager
    def tx(self):
        """Read, change and write the state under the lock."""
        with self.lock:
            data = self._load()
            yield data
            self._save(data)

    def read(self):
        with self.lock:
            return self._load()
