"""Once a day: judge yesterday's close for every instrument and act on it.

Safety comes from reading the broker first. Open trades at the broker are the
truth, so a trade is never doubled even if two copies of the bot run.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal
from zoneinfo import ZoneInfo

from .broker.base import Broker, OrderResult, Position
from .config import Config
from .journal import Journal
from .models import Bar, Instrument, Mode, Signal
from .risk import Skip, TradePlan, brake_on, plan_trade
from .state import State
from .strategy import evaluate

NEW_YORK = ZoneInfo("America/New_York")
LIVE_CONFIRM_ENV = "TRADEBOT_CONFIRM_LIVE"
LIVE_CONFIRM_VALUE = "I_UNDERSTAND_REAL_MONEY"


@dataclass(frozen=True)
class Decision:
    symbol: str
    action: Literal["buy", "sell", "hold", "none", "skip", "failed"]
    reason: str
    plan: TradePlan | None = None
    result: OrderResult | None = None
    signal: Signal | None = None


def market_day(now: dt.datetime) -> dt.date:
    """The calendar day in New York, which is what a 'trading day' means here."""
    return now.astimezone(NEW_YORK).date()


def completed_bars(bars: Sequence[Bar], today: dt.date) -> list[Bar]:
    """Finished days only. The broker's list can include today's unfinished day."""
    return [b for b in bars if b.date < today]


def effective_mode(config: Config, env: Mapping[str, str]) -> tuple[Mode, str | None]:
    """Real money needs two switches. With only one, fall back to signals and say so."""
    if config.mode == "live" and env.get(LIVE_CONFIRM_ENV) != LIVE_CONFIRM_VALUE:
        return "signals", (
            "config.yaml says 'live' but the second switch is not set, "
            "so no orders are placed (running as signals only)"
        )
    return config.mode, None


def bars_needed(config: Config) -> int:
    p = config.strategy
    return max(p.trend_days, p.entry_days, p.exit_days, p.atr_days) + 60


def read_signal(broker: Broker, config: Config, inst: Instrument, holding: bool, utc_today: dt.date) -> Signal:
    bars = completed_bars(broker.daily_bars(inst.epic, bars_needed(config)), utc_today)
    return evaluate(bars, config.strategy, holding)


def run_daily_decisions(broker: Broker, config: Config, state: State, journal: Journal,
                        now: dt.datetime, mode: Mode) -> list[Decision]:
    day = market_day(now)
    if state.decisions_done(day):
        return []

    account = broker.account()
    state.start_day(day, account.equity)
    positions = broker.positions()
    held: dict[str, Position] = {p.epic: p for p in positions}
    place = mode in ("demo", "live")
    utc_today = now.astimezone(dt.UTC).date()

    blocked: str | None = None
    if place and account.is_demo != (mode == "demo"):
        blocked = (
            f"the bot is set to {mode} but is connected to a "
            f"{'demo' if account.is_demo else 'live'} account, so no orders are placed"
        )

    decisions: list[Decision] = []
    buys: list[tuple[Instrument, Signal]] = []
    retry_later = False

    # 1. judge every instrument; sells go first because they lower risk
    for inst in config.instruments:
        pos = held.get(inst.epic)
        sig = read_signal(broker, config, inst, pos is not None, utc_today)
        if sig.action == "sell" and pos is not None:
            if not place:
                decisions.append(Decision(inst.symbol, "sell", sig.reason, signal=sig))
            elif blocked:
                decisions.append(Decision(inst.symbol, "skip", blocked, signal=sig))
            else:
                res = broker.close(pos.deal_id)
                journal.write(now, mode, inst.symbol, "sell", pos.size, res.fill_price, None, res.ok,
                              sig.reason if res.ok else res.reason)
                if res.ok:
                    decisions.append(Decision(inst.symbol, "sell", sig.reason, result=res, signal=sig))
                else:
                    decisions.append(Decision(inst.symbol, "failed", f"could not sell: {res.reason}", result=res, signal=sig))
        elif sig.action == "buy":
            buys.append((inst, sig))
        else:
            decisions.append(Decision(inst.symbol, sig.action, sig.reason, signal=sig))

    # 2. buys, strongest first, each one checked against every safety rule
    buys.sort(key=lambda x: (-(x[1].close - x[1].entry_level) / x[1].atr, x[0].symbol))
    open_count = len(positions)
    open_notional = sum(p.size * p.price for p in positions)
    traded = broker.traded_today(utc_today) if place and buys and not blocked else set()
    start_equity = state.day_start_equity(day) or account.equity
    brake = brake_on(start_equity, account.equity, config.risk)

    for inst, sig in buys:
        def skip(reason: str) -> None:
            if place:
                journal.write(now, mode, inst.symbol, "skip", reason=reason)
            decisions.append(Decision(inst.symbol, "skip", reason, signal=sig))

        if not config.trading_enabled:
            skip("the off switch is on (trading_enabled: false)")
            continue
        if blocked:
            skip(blocked)
            continue
        if brake:
            skip(f"the account is down {config.risk.daily_brake:.0%} or more today, so no new trades until tomorrow")
            continue
        if inst.epic in traded:
            skip("this instrument was already traded today")
            continue
        market = broker.market(inst.epic)
        if place and not market.tradeable:
            retry_later = True
            skip("the market is closed right now; the bot will try again at the next check")
            continue
        if market.currency != account.currency:
            skip(f"the account is in {account.currency} but {inst.name} is priced in {market.currency}; "
                 "the bot does not convert currencies yet")
            continue
        if market.contract_size != 1:
            skip(f"{inst.name} has an unusual contract size ({market.contract_size:g}), which the bot does not handle yet")
            continue
        price = market.ask if market.ask > 0 else sig.close
        plan = plan_trade(inst.symbol, price, sig.atr, account.equity, open_notional, open_count,
                          config.risk, config.strategy.stop_atr, market.min_size, market.size_step)
        if isinstance(plan, Skip):
            skip(plan.reason)
            continue
        stop = round(plan.stop_price, market.price_decimals)
        if not 0 < stop < price:
            skip("the stop-loss could not be placed below the price")
            continue
        plan = replace(plan, stop_price=stop, risk_amount=plan.size * (price - stop))
        if not place:
            decisions.append(Decision(inst.symbol, "buy", sig.reason, plan=plan, signal=sig))
            open_count += 1
            open_notional += plan.notional
            continue
        res = broker.open_long(inst.epic, plan.size, plan.stop_price)
        journal.write(now, mode, inst.symbol, "buy", plan.size, res.fill_price or price, plan.stop_price, res.ok,
                      sig.reason if res.ok else res.reason)
        if res.ok:
            open_count += 1
            open_notional += plan.notional
            decisions.append(Decision(inst.symbol, "buy", sig.reason, plan=plan, result=res, signal=sig))
        else:
            decisions.append(Decision(inst.symbol, "failed", f"could not buy: {res.reason}", plan=plan, result=res, signal=sig))

    if not retry_later:
        state.mark_decisions_done(day)
    state.save()
    order = {i.symbol: n for n, i in enumerate(config.instruments)}
    decisions.sort(key=lambda d: order.get(d.symbol, 0))
    return decisions
