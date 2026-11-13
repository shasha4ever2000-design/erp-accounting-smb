"""Reads saved daily prices from data/history/<SYMBOL>.csv."""

from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path

from .models import Bar


def _read(path: Path) -> list[Bar]:
    by_date: dict[dt.date, Bar] = {}
    with path.open(newline="") as fh:
        for rec in csv.DictReader(fh):
            try:
                day = dt.date.fromisoformat(rec["date"])
                o, h, l, c = (float(rec[k]) for k in ("open", "high", "low", "close"))
            except (KeyError, ValueError, TypeError):
                continue
            if min(o, h, l, c) <= 0 or h < l:
                continue
            by_date[day] = Bar(day, o, h, l, c)
    return [by_date[d] for d in sorted(by_date)]


def load_history(directory: str | Path) -> dict[str, list[Bar]]:
    out: dict[str, list[Bar]] = {}
    for path in sorted(Path(directory).glob("*.csv")):
        bars = _read(path)
        if bars:
            out[path.stem] = bars
    return out
