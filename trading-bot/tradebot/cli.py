"""Command line entry point:  python -m tradebot <command>

  check     one pass: brief if due, today's orders if due, then the live watch
  loop      run `check` again and again (for your own computer)
  brief     build the morning brief right now
  doctor    test the connection and the watchlist
  backtest  test the strategy on past prices
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import time
from pathlib import Path

from .backtest import run_backtest
from .brief import tag
from .broker.base import BrokerError
from .broker.capital import CapitalBroker
from .config import ConfigError, load_config
from .engine import effective_mode
from .history import load_history
from .journal import Journal
from .notify import ConsoleNotifier, TelegramNotifier
from .report import render_backtest
from .runner import _send_brief, run_check, run_doctor
from .state import State

REQUIRED = ("CAPITAL_API_KEY", "CAPITAL_IDENTIFIER", "CAPITAL_PASSWORD")


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def load_env_file(path: str | Path, env) -> None:
    """Read KEY=VALUE lines from a private .env file. Values already set are kept."""
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip("'\"")
        if key and key not in env:
            env[key] = value


def make_notifier(env, to_screen: bool):
    token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    if to_screen or not (token and chat):
        return ConsoleNotifier()
    return TelegramNotifier(token, chat)


def _setup(args, env):
    """Shared start-up for commands that talk to Capital.com. Returns None after printing why not."""
    missing = [k for k in REQUIRED if not env.get(k)]
    if missing:
        print("These settings are missing: " + ", ".join(missing))
        print("Put them in a .env file next to config.yaml, or in GitHub Secrets. See README.md.")
        return None
    config = load_config(args.config)
    mode, note = effective_mode(config, env)
    broker = CapitalBroker(env["CAPITAL_API_KEY"], env["CAPITAL_IDENTIFIER"], env["CAPITAL_PASSWORD"],
                           demo=(mode != "live"))
    data = Path(args.data_dir)
    notifier = make_notifier(env, args.print)
    if isinstance(notifier, ConsoleNotifier) and not args.print:
        print("(Telegram is not set up, so messages are shown here instead.)")
    return config, mode, note, broker, State(data / "state.json"), Journal(data / "journal.csv"), notifier


def cmd_check(args, env) -> int:
    ready = _setup(args, env)
    if ready is None:
        return 2
    config, mode, note, broker, state, journal, notifier = ready
    return run_check(broker, config, state, journal, notifier, utc_now(), mode, mode_note=note)


def cmd_loop(args, env) -> int:
    ready = _setup(args, env)
    if ready is None:
        return 2
    config, mode, note, broker, state, journal, notifier = ready
    minutes = max(1, config.check_minutes)
    print(f"Running in {mode} mode, checking every {minutes} minutes. Press Ctrl+C to stop.")
    try:
        while True:
            code = run_check(broker, config, state, journal, notifier, utc_now(), mode, mode_note=note)
            print(f"{utc_now():%Y-%m-%d %H:%M} UTC  check {'ok' if code == 0 else 'had a problem'}")
            time.sleep(minutes * 60)
    except KeyboardInterrupt:
        print("Stopped.")
        return 0


def cmd_brief(args, env) -> int:
    ready = _setup(args, env)
    if ready is None:
        return 2
    config, mode, note, broker, state, journal, notifier = ready
    try:
        _send_brief(broker, config, state, notifier, utc_now(), mode, None)
    except BrokerError as exc:
        print(f"{tag(mode)} Could not build the brief: {exc}")
        return 1
    state.save()
    return 0


def cmd_doctor(args, env) -> int:
    ready = _setup(args, env)
    if ready is None:
        return 2
    config, mode, note, broker, state, journal, notifier = ready
    print(f"Mode: {mode}" + (f"  ({note})" if note else ""))
    try:
        code = run_doctor(broker, config, utc_now())
    except BrokerError as exc:
        print(f"Problem: {exc}")
        return 1
    if isinstance(notifier, TelegramNotifier):
        sent = notifier.send(f"{tag(mode)} Test message from your trading bot. Telegram works.")
        print("Telegram: test message sent." if sent else "Telegram: could NOT send. Check the bot token and chat id.")
        code = code or (0 if sent else 1)
    else:
        print("Telegram: not set up (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).")
    return code


def cmd_backtest(args, env) -> int:
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
    ap = argparse.ArgumentParser(prog="tradebot", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.yaml", help="settings file")
    ap.add_argument("--data-dir", default=".", help="where state.json and journal.csv are kept")
    ap.add_argument("--print", action="store_true", help="show messages here instead of sending to Telegram")
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="one pass: brief, orders, watch").set_defaults(func=cmd_check)
    sub.add_parser("loop", help="keep checking (own computer)").set_defaults(func=cmd_loop)
    sub.add_parser("brief", help="build the morning brief now").set_defaults(func=cmd_brief)
    sub.add_parser("doctor", help="test the connection and the watchlist").set_defaults(func=cmd_doctor)

    bt = sub.add_parser("backtest", help="test the strategy on past prices")
    bt.add_argument("--config", default=argparse.SUPPRESS)
    bt.add_argument("--history", default=str(Path("data") / "history"))
    bt.add_argument("--equity", type=float, default=10_000.0, help="starting account size")
    bt.set_defaults(func=cmd_backtest)
    return ap


def main(argv: list[str] | None = None, env=None) -> int:
    args = build_parser().parse_args(argv)
    if env is None:
        env = os.environ
        load_env_file(Path(args.config).resolve().parent / ".env", env)
    try:
        return args.func(args, env)
    except ConfigError as exc:
        print(f"Problem in {args.config}: {exc}")
        return 2
