"""Replays the strategy over past daily prices.

Uses the same `evaluate` and `plan_trade` as the live bot, so what is tested
here is what trades.

Order of events on each day:
  1. overnight fee for trades carried into the day
  2. sells decided at yesterday's close, at today's open
  3. stops that the open has already jumped past, at the open
  4. buys decided at yesterday's close, at today's open (strongest first)
  5. stops touched during the day, at the stop price
  6. value the account at the close
  7. judge today's close -> decisions for the next open
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Literal

from .config import Config
from .models import Bar, Signal
from .risk import TradePlan, plan_trade
from .strategy import evaluate


@dataclass(frozen=True)
class Trade:
    symbol: str
    entry_date: dt.date
    entry_price: float
    exit_date: dt.date
    exit_price: float
    size: float
    pnl: float
    exit_reason: Literal["signal", "stop", "end"]

    @property
    def pnl_pct(self) -> float:
        return self.pnl / (self.size * self.entry_price)

    @property
    def days_held(self) -> int:
        return (self.exit_date - self.entry_date).days


@dataclass
class BacktestResult:
    trades: list[Trade]
    equity_curve: list[tuple[dt.date, float]]
    start_equity: float
    end_equity: float
    start_date: dt.date
    end_date: dt.date
    stats: dict
    buy_hold: dict
    by_year: dict[int, dict[str, float]]
    by_symbol: dict[str, dict[str, float]]
    skipped: list[str] = field(default_factory=list)


@dataclass
class _Open:
    size: float
    entry_date: dt.date
    entry_price: float
    stop: float
    overnight: float = 0.0


def max_drawdown(curve: list[tuple[dt.date, float]]) -> float:
    """Worst fall from a peak, as a share of the peak."""
    peak, worst = float("-inf"), 0.0
    for _, value in curve:
        peak = max(peak, value)
        if peak > 0:
            worst = max(worst, (peak - value) / peak)
    return worst


def longest_losing_streak(pnls: list[float]) -> int:
    best = run = 0
    for p in pnls:
        run = run + 1 if p < 0 else 0
        best = max(best, run)
    return best


def _yearly_returns(curve: list[tuple[dt.date, float]], start_value: float) -> dict[int, float]:
    out: dict[int, float] = {}
    prev = start_value
    last_by_year: dict[int, float] = {}
    for d, v in curve:
        last_by_year[d.year] = v
    for year in sorted(last_by_year):
        out[year] = last_by_year[year] / prev - 1 if prev else 0.0
        prev = last_by_year[year]
    return out


def _cagr(start: float, end: float, days: int) -> float:
    if start <= 0 or end <= 0 or days <= 0:
        return 0.0
    return (end / start) ** (365.25 / days) - 1


def run_backtest(history: dict[str, list[Bar]], config: Config, start_equity: float = 10_000.0) -> BacktestResult:
    p = config.strategy
    warm = p.trend_days
    window = max(p.trend_days, p.entry_days + 1, p.exit_days + 1, p.atr_days + 1) + 1

    usable: dict[str, list[Bar]] = {}
    skipped: list[str] = []
    for inst in config.instruments:
        bars = history.get(inst.symbol, [])
        if len(bars) > warm:
            usable[inst.symbol] = bars
        else:
            skipped.append(inst.symbol)
    if not usable:
        raise ValueError("no instrument has enough price history to test")

    kind = {i.symbol: i.kind for i in config.instruments}
    half_spread = {s: config.costs.spread.get(kind[s], 0.0) / 2 for s in usable}
    night_rate = {s: config.costs.overnight_rate.get(kind[s], 0.0) for s in usable}

    start_date = max(bars[warm].date for bars in usable.values())
    index = {s: {b.date: i for i, b in enumerate(bars)} for s, bars in usable.items()}
    dates = sorted({b.date for bars in usable.values() for b in bars if b.date >= start_date})

    cash = start_equity
    open_pos: dict[str, _Open] = {}
    pending_buy: dict[str, Signal] = {}
    pending_sell: set[str] = set()
    last_close: dict[str, float] = {}
    last_date: dict[str, dt.date] = {}
    for s, bars in usable.items():
        before = [b for b in bars if b.date < start_date]
        if before:
            last_close[s], last_date[s] = before[-1].close, before[-1].date

    trades: list[Trade] = []
    curve: list[tuple[dt.date, float]] = []
    equity_prev = start_equity
    max_open = 0
    exposure_sum = 0.0
    overnight_total = 0.0
    spread_total = 0.0

    def close_position(symbol: str, day: dt.date, price: float, reason: str) -> None:
        nonlocal cash, spread_total
        pos = open_pos.pop(symbol)
        fill = price * (1 - half_spread[symbol])
        spread_total += pos.size * price * half_spread[symbol]
        cash += pos.size * fill
        pnl = pos.size * (fill - pos.entry_price) - pos.overnight
        trades.append(Trade(symbol, pos.entry_date, pos.entry_price, day, fill, pos.size, pnl, reason))

    for d in dates:
        today = {s: usable[s][index[s][d]] for s in usable if d in index[s]}

        # 1. overnight fee
        for s, pos in open_pos.items():
            if s in today and s in last_date:
                nights = (d - last_date[s]).days
                fee = pos.size * last_close[s] * night_rate[s] * nights / 365
                pos.overnight += fee
                cash -= fee
                overnight_total += fee

        # 2. sells at the open
        for s in sorted(pending_sell):
            if s in today:
                pending_sell.discard(s)
                if s in open_pos:
                    close_position(s, d, today[s].open, "signal")

        # 3. stops the open has jumped past
        for s in sorted(open_pos):
            if s in today and today[s].open <= open_pos[s].stop:
                close_position(s, d, today[s].open, "stop")

        # 4. buys at the open, strongest first
        ready = [(s, sig) for s, sig in pending_buy.items() if s in today]
        ready.sort(key=lambda x: (-(x[1].close - x[1].entry_level) / x[1].atr, x[0]))
        for s, sig in ready:
            del pending_buy[s]
            if s in open_pos:
                continue
            fill = today[s].open * (1 + half_spread[s])
            open_notional = sum(
                pos.size * (pos.entry_price if pos.entry_date == d else last_close[o])
                for o, pos in open_pos.items()
            )
            plan = plan_trade(s, fill, sig.atr, equity_prev, open_notional, len(open_pos), config.risk, p.stop_atr)
            if isinstance(plan, TradePlan):
                cash -= plan.size * fill
                spread_total += plan.size * today[s].open * half_spread[s]
                open_pos[s] = _Open(plan.size, d, fill, plan.stop_price)
        max_open = max(max_open, len(open_pos))

        # 5. stops touched during the day
        for s in sorted(open_pos):
            if s in today and today[s].low <= open_pos[s].stop:
                close_position(s, d, open_pos[s].stop, "stop")

        # 6. value the account at the close
        for s, bar in today.items():
            last_close[s], last_date[s] = bar.close, bar.date
        invested = sum(pos.size * last_close[s] for s, pos in open_pos.items())
        equity = cash + invested
        curve.append((d, equity))
        exposure_sum += invested / equity if equity > 0 else 0.0
        equity_prev = equity

        # 7. judge today's close
        for s in today:
            i = index[s][d]
            bars = usable[s][max(0, i + 1 - window): i + 1]
            sig = evaluate(bars, p, holding=s in open_pos)
            if sig.action == "buy":
                pending_buy[s] = sig
            elif sig.action == "sell":
                pending_sell.add(s)

    # close whatever is still open at the last known price
    for s in sorted(open_pos):
        close_position(s, last_date[s], last_close[s], "end")
    end_equity = cash
    if curve:
        curve[-1] = (curve[-1][0], end_equity)

    end_date = dates[-1]
    days = (end_date - start_date).days
    pnls = [t.pnl for t in trades]
    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x < 0]
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0

    stats = {
        "total_return": end_equity / start_equity - 1,
        "yearly_return": _cagr(start_equity, end_equity, days),
        "years": days / 365.25,
        "trades": len(trades),
        "wins": len(wins),
        "win_rate": len(wins) / len(trades) if trades else 0.0,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "win_loss_ratio": avg_win / abs(avg_loss) if avg_loss else 0.0,
        "max_drawdown": max_drawdown(curve),
        "longest_losing_streak": longest_losing_streak(pnls),
        "max_open_trades": max_open,
        "avg_exposure": exposure_sum / len(dates) if dates else 0.0,
        "avg_days_held": sum(t.days_held for t in trades) / len(trades) if trades else 0.0,
        "stop_exits": sum(1 for t in trades if t.exit_reason == "stop"),
        "overnight_fees": overnight_total,
        "spread_costs": spread_total,
    }

    # buy and hold: equal money in every instrument from the first day, no costs
    share = start_equity / len(usable)
    units, bh_last = {}, {}
    for s, bars in usable.items():
        first = next(b for b in bars if b.date >= start_date)
        units[s] = share / first.close
        bh_last[s] = first.close
    bh_curve = []
    for d in dates:
        for s in usable:
            if d in index[s]:
                bh_last[s] = usable[s][index[s][d]].close
        bh_curve.append((d, sum(units[s] * bh_last[s] for s in usable)))
    bh_end = bh_curve[-1][1]
    buy_hold = {
        "total_return": bh_end / start_equity - 1,
        "yearly_return": _cagr(start_equity, bh_end, days),
        "max_drawdown": max_drawdown(bh_curve),
        "end_equity": bh_end,
    }

    strat_years = _yearly_returns(curve, start_equity)
    bh_years = _yearly_returns(bh_curve, start_equity)
    by_year = {y: {"strategy": strat_years[y], "buy_hold": bh_years.get(y, 0.0)} for y in strat_years}

    by_symbol: dict[str, dict[str, float]] = {s: {"trades": 0, "wins": 0, "pnl": 0.0} for s in usable}
    for t in trades:
        row = by_symbol[t.symbol]
        row["trades"] += 1
        row["wins"] += 1 if t.pnl > 0 else 0
        row["pnl"] += t.pnl

    return BacktestResult(
        trades=trades, equity_curve=curve, start_equity=start_equity, end_equity=end_equity,
        start_date=start_date, end_date=end_date, stats=stats, buy_hold=buy_hold,
        by_year=by_year, by_symbol=by_symbol, skipped=skipped,
    )
