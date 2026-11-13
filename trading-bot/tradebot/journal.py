"""The trade journal: one line for every order and every skipped order."""

from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path

FIELDS = ["time_utc", "mode", "symbol", "action", "size", "price", "stop", "ok", "reason"]


class Journal:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def write(self, when: dt.datetime, mode: str, symbol: str, action: str, size=None, price=None,
              stop=None, ok=None, reason: str = "") -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        new = not self.path.exists()
        with self.path.open("a", newline="") as fh:
            w = csv.writer(fh)
            if new:
                w.writerow(FIELDS)
            fmt = lambda v: "" if v is None else (f"{v:.6g}" if isinstance(v, float) else str(v))
            w.writerow([when.strftime("%Y-%m-%d %H:%M:%S"), mode, symbol, action,
                        fmt(size), fmt(price), fmt(stop), fmt(ok), reason])
