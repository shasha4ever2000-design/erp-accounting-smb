"""Download daily price history for the watchlist into data/history/.

Standard library only, so it runs anywhere with plain Python.
Tries Stooq first, then Yahoo Finance. One CSV per symbol:
date,open,high,low,close  (oldest first, split-adjusted).

    python tools/fetch_history.py --out data/history --start 2014-01-01
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

Row = tuple[str, float, float, float, float]

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# symbol -> (stooq code, yahoo code)
SOURCES: dict[str, tuple[str, str]] = {
    "AAPL": ("aapl.us", "AAPL"),
    "MSFT": ("msft.us", "MSFT"),
    "NVDA": ("nvda.us", "NVDA"),
    "GOOGL": ("googl.us", "GOOGL"),
    "META": ("meta.us", "META"),
    "AMZN": ("amzn.us", "AMZN"),
    "TSLA": ("tsla.us", "TSLA"),
    "JPM": ("jpm.us", "JPM"),
    "LLY": ("lly.us", "LLY"),
    "XOM": ("xom.us", "XOM"),
    "WMT": ("wmt.us", "WMT"),
    "COST": ("cost.us", "COST"),
    "GOLD": ("xauusd", "GC=F"),
    "SILVER": ("xagusd", "SI=F"),
}


def parse_stooq_csv(text: str) -> list[Row]:
    rows: list[Row] = []
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or [h.strip().lower() for h in header[:5]] != [
        "date", "open", "high", "low", "close",
    ]:
        return []
    for rec in reader:
        try:
            rows.append((rec[0], float(rec[1]), float(rec[2]), float(rec[3]), float(rec[4])))
        except (IndexError, ValueError):
            continue
    rows.sort(key=lambda r: r[0])
    return rows


def parse_yahoo_chart(payload: dict) -> list[Row]:
    results = (payload.get("chart") or {}).get("result") or []
    if not results:
        return []
    res = results[0]
    offset = (res.get("meta") or {}).get("gmtoffset", 0)
    stamps = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    rows: list[Row] = []
    for i, ts in enumerate(stamps):
        try:
            values = [quote[k][i] for k in ("open", "high", "low", "close")]
        except (KeyError, IndexError):
            continue
        if any(v is None for v in values):
            continue
        day = dt.datetime.fromtimestamp(ts + offset, dt.UTC).date().isoformat()
        rows.append((day, *[float(v) for v in values]))
    rows.sort(key=lambda r: r[0])
    return rows


def filter_start(rows: list[Row], start: str) -> list[Row]:
    return [r for r in rows if r[0] >= start]


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_stooq(code: str) -> list[Row]:
    return parse_stooq_csv(_get(f"https://stooq.com/q/d/l/?s={code}&i=d"))


def fetch_yahoo(code: str) -> list[Row]:
    now = int(time.time())
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{urllib.request.quote(code)}?period1=0&period2={now}&interval=1d&events=split"
    )
    return parse_yahoo_chart(json.loads(_get(url)))


def fetch_symbol(symbol: str) -> tuple[list[Row], str]:
    stooq_code, yahoo_code = SOURCES[symbol]
    for name, fn, code in (("stooq", fetch_stooq, stooq_code), ("yahoo", fetch_yahoo, yahoo_code)):
        for attempt in range(3):
            try:
                rows = fn(code)
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                print(f"  {symbol}: {name} attempt {attempt + 1} failed: {exc}", file=sys.stderr)
                time.sleep(2 * (attempt + 1))
                continue
            if len(rows) > 250:
                return rows, name
            print(f"  {symbol}: {name} gave only {len(rows)} rows", file=sys.stderr)
            break
    return [], "none"


def write_csv(path: Path, rows: list[Row]) -> None:
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "open", "high", "low", "close"])
        for r in rows:
            w.writerow([r[0], *[f"{v:.6g}" for v in r[1:]]])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="data/history")
    ap.add_argument("--start", default="2014-01-01")
    ap.add_argument("symbols", nargs="*", default=list(SOURCES))
    args = ap.parse_args(argv)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    failed = []
    for symbol in args.symbols:
        rows, source = fetch_symbol(symbol)
        rows = filter_start(rows, args.start)
        if not rows:
            failed.append(symbol)
            print(f"{symbol}: FAILED")
            continue
        write_csv(out / f"{symbol}.csv", rows)
        print(f"{symbol}: {len(rows)} days from {source} ({rows[0][0]} to {rows[-1][0]})")
        time.sleep(1)
    if failed:
        print("Could not download: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
