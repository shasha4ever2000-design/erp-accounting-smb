"""The live watch: what is worth a ping right now. Each ping is sent once a day."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from .broker.base import Broker
from .config import Config
from .engine import market_day
from .risk import brake_on
from .scan import scan
from .state import State


@dataclass(frozen=True)
class Alert:
    key: str
    text: str


def run_watch(broker: Broker, config: Config, state: State, now: dt.datetime) -> list[Alert]:
    day = market_day(now)
    account = broker.account()
    state.start_day(day, account.equity)
    positions = broker.positions()
    held = {p.epic: p for p in positions}
    found: list[Alert] = []

    # trades that were open last time and are gone now
    known = state.known_positions()
    for epic, info in known.items():
        if epic not in held:
            name = info.get("name") or epic
            stop = info.get("stop")
            where = f" Its stop-loss was at {stop:g}." if stop else ""
            found.append(Alert(f"closed:{epic}", f"{name} is no longer open. It was closed, most likely by its stop-loss.{where}"))
    state.set_known_positions({p.epic: {"stop": p.stop_price, "name": p.name or p.epic} for p in positions})

    start = state.day_start_equity(day) or account.equity
    if brake_on(start, account.equity, config.risk):
        found.append(Alert("brake", f"The account is down {config.risk.daily_brake:.0%} or more today. "
                                    "The bot will open no new trades until tomorrow."))

    for row in scan(broker, config, positions, now.astimezone(dt.UTC).date()):
        inst, pos = row.inst, row.held
        market = broker.market(inst.epic)
        price = market.bid

        if pos and not pos.stop_price:
            found.append(Alert(f"nostop:{inst.symbol}", f"{inst.name} is open WITHOUT a stop-loss. Set one in the Capital.com app."))

        if market.day_change is not None and abs(market.day_change) >= config.alerts.big_move:
            direction = "up" if market.day_change > 0 else "down"
            found.append(Alert(f"move:{inst.symbol}:{direction}",
                               f"{inst.name} is {direction} {abs(market.day_change) * 100:.1f}% today, now at {price:g}."))

        if price <= 0:
            continue
        if pos and row.sell_level and price < row.sell_level:
            found.append(Alert(f"cross-sell:{inst.symbol}",
                               f"Heads-up: {inst.name} is at {price:g}, below its sell level of {row.sell_level:g}. "
                               "If it closes here, the bot sells at tomorrow's open."))
        elif (not pos and row.buy_level and row.trend_avg
              and price > row.buy_level and price > row.trend_avg):
            found.append(Alert(f"cross-buy:{inst.symbol}",
                               f"Heads-up: {inst.name} is at {price:g}, above its buy level of {row.buy_level:g}. "
                               "If it closes here, the bot buys at tomorrow's open."))

    fresh = [a for a in found if state.mark_alert(day, a.key)]
    state.save()
    return fresh
