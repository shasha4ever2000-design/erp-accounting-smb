"""Command line entry point:  python -m tradebot <command>"""

from __future__ import annotations

import argparse
from pathlib import Path

from .backtest import run_backtest
from .config import load_config
from .history import load_history
from .report import render_backtest


def cmd_backtest(args) -> int:
    config = load_config(args.config)
    history = load_history(args.history)
    if not history:
        print(
            f"No price history found in {args.history}.\n"
            "Download it first:  python tools/fetch_history.py --out data/history"
        )
        return 1
    try:
        result = run_backtest(history, config, start_equity=args.equity)
    except ValueError as exc:
        print(f"Cannot run the test: {exc}")
        return 1
    print(render_backtest(result, config))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="tradebot", description="Personal trading assistant")
    ap.add_argument("--config", default="config.yaml", help="settings file")
    sub = ap.add_subparsers(dest="command", required=True)

    bt = sub.add_parser("backtest", help="test the strategy on past prices")
    bt.add_argument("--config", default=argparse.SUPPRESS)
    bt.add_argument("--history", default=str(Path("data") / "history"))
    bt.add_argument("--equity", type=float, default=10_000.0, help="starting account size")
    bt.set_defaults(func=cmd_backtest)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)
