"""Download daily price history for the watchlist into data/history/.

Source: Tiingo end-of-day prices (free account, https://www.tiingo.com).
Prices are adjusted for splits and dividends. Gold and silver use the
GLD and SLV funds as stand-ins, because they follow the metal prices closely
and have long daily history.

One CSV per symbol: date,open,high,low,close (oldest first).

    TIINGO_API_KEY=... python tools/fetch_history.py --out data/history --start 2014-01-01

Standard library only, so it runs anywhere with plain Python.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

Row = tuple[str, float, float, float, float]

TICKERS: dict[str, str] = {
    "AAPL": "AAPL", "MSFT": "MSFT", "NVDA": "NVDA", "GOOGL": "GOOGL", "META": "META",
    "AMZN": "AMZN", "TSLA": "TSLA", "JPM": "JPM", "LLY": "LLY", "XOM": "XOM",
    "WMT": "WMT", "COST": "COST",
    "GOLD": "GLD", "SILVER": "SLV",
}


def parse_tiingo(payload) -> list[Row]:
    if not isinstance(payload, list):
        return []
    rows: list[Row] = []
    for rec in payload:
        try:
            rows.append((
                str(rec["date"])[:10],
                float(rec["adjOpen"]), float(rec["adjHigh"]), float(rec["adjLow"]), float(rec["adjClose"]),
            ))
        except (KeyError, TypeError, ValueError):
            continue
    rows.sort(key=lambda r: r[0])
    return rows


def fetch(ticker: str, start: str) -> list[Row]:
    url = f"https://api.tiingo.com/tiingo/daily/{ticker}/prices?startDate={start}&format=json"
    headers = {"Content-Type": "application/json", "User-Agent": "tradebot-history-fetcher"}
    key = os.environ.get("TIINGO_API_KEY")
    if key:
        headers["Authorization"] = f"Token {key}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return parse_tiingo(json.loads(resp.read().decode("utf-8")))


def write_csv(path: Path, rows: list[Row]) -> None:
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "open", "high", "low", "close"])
        for r in rows:
            w.writerow([r[0], *[f"{v:.6f}".rstrip("0").rstrip(".") for v in r[1:]]])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="data/history")
    ap.add_argument("--start", default="2014-01-01")
    ap.add_argument("symbols", nargs="*", default=list(TICKERS))
    args = ap.parse_args(argv)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    failed = []
    for symbol in args.symbols:
        try:
            rows = fetch(TICKERS[symbol], args.start)
        except urllib.error.HTTPError as exc:
            print(f"{symbol}: FAILED (the data service answered {exc.code})", file=sys.stderr)
            rows = []
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            print(f"{symbol}: FAILED ({type(exc).__name__})", file=sys.stderr)
            rows = []
        if not rows:
            failed.append(symbol)
            continue
        write_csv(out / f"{symbol}.csv", rows)
        print(f"{symbol}: {len(rows)} days ({rows[0][0]} to {rows[-1][0]})")
        time.sleep(0.5)
    if failed:
        print("Could not download: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
