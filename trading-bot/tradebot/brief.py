"""The morning brief: one plain message before the US market opens."""

from __future__ import annotations

import datetime as dt

from .broker.base import Account
from .config import Config
from .scan import Row


def tag(mode: str) -> str:
    return f"[{mode.upper()}]"


def cash(amount: float, currency: str) -> str:
    symbol = "$" if currency == "USD" else f"{currency} "
    return f"-{symbol}{abs(amount):,.0f}" if amount < 0 else f"{symbol}{amount:,.0f}"


def build_brief(mode: str, day: dt.date, account: Account, rows: list[Row],
                news: dict[str, list[str]], config: Config) -> str:
    held = [r for r in rows if r.held]
    lines = [
        f"{tag(mode)} Good morning. {day:%A} {day.day} {day:%b}",
        "",
        f"Account: {cash(account.equity, account.currency)}   Open trades: {len(held)}",
    ]
    for r in held:
        p = r.held
        cost = p.size * p.entry_price
        change = f"{p.pnl / cost * 100:+.1f}%" if cost else "n/a"
        stop = f"stop-loss {p.stop_price:g}" if p.stop_price else "NO STOP-LOSS (set one in the app)"
        lines.append(f"  {r.inst.name}  {change} ({cash(p.pnl, account.currency)})  {stop}")

    lines += ["", "Today at the open"]
    actions = [r for r in rows if r.signal.action in ("buy", "sell")]
    for r in actions:
        lines.append(f"  {r.signal.action.upper()} {r.inst.name}: {r.signal.reason}")
    if not actions:
        lines.append("  Nothing to buy or sell today.")
    elif mode == "signals":
        lines.append("  Signals only: the bot will not place these orders.")
    elif not config.trading_enabled:
        lines.append("  The off switch is on: the bot will sell but will not buy.")

    near = []
    limit = config.alerts.near_level
    for r in rows:
        if r.last_close is None or r.signal.action in ("buy", "sell"):
            continue
        if r.held and r.sell_level:
            gap = r.last_close / r.sell_level - 1
            if 0 <= gap <= limit:
                near.append(f"  {r.inst.name} is {gap * 100:.1f}% above its sell level ({r.sell_level:g})")
        elif not r.held and r.buy_level and r.trend_avg and r.last_close > r.trend_avg:
            gap = 1 - r.last_close / r.buy_level
            if 0 <= gap <= limit:
                near.append(f"  {r.inst.name} is {gap * 100:.1f}% below its buy level ({r.buy_level:g})")
    if near:
        lines += ["", "Getting close"] + near

    movers = sorted((r for r in rows if r.last_move is not None), key=lambda r: -abs(r.last_move))[:3]
    if movers:
        lines += ["", "Yesterday's biggest moves",
                  "  " + ", ".join(f"{r.inst.name} {r.last_move * 100:+.1f}%" for r in movers)]

    stories = [(r.inst.name, t) for r in rows for t in news.get(r.inst.symbol, [])]
    if stories:
        lines += ["", "Headlines"] + [f"  {name}: {title}" for name, title in stories]

    short = [r.inst.name for r in rows if r.last_close is None or "not enough price history" in r.signal.reason]
    if short:
        lines += ["", "Cannot judge yet (not enough price history): " + ", ".join(short)]
    return "\n".join(lines)
