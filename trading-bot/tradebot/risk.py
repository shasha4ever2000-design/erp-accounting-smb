"""Trade sizing and the safety rules. No trade leaves here without a stop price."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .config import RiskParams


@dataclass(frozen=True)
class TradePlan:
    symbol: str
    size: float
    entry_price: float
    stop_price: float
    risk_amount: float  # loss if the stop is hit
    notional: float     # value of the trade
    reason: str


@dataclass(frozen=True)
class Skip:
    symbol: str
    reason: str


def _round_down(size: float, step: float) -> float:
    if step <= 0:
        return size
    steps = math.floor(size / step + 1e-9)
    return round(steps * step, 10)


def plan_trade(
    symbol: str,
    price: float,
    atr: float | None,
    equity: float,
    open_notional: float,
    open_count: int,
    p: RiskParams,
    stop_atr: float,
    min_size: float = 0.0,
    size_step: float = 0.0,
) -> TradePlan | Skip:
    """Decide how big a new trade may be, or why it must be skipped."""
    if open_count >= p.max_open_trades:
        return Skip(symbol, f"already {p.max_open_trades} open trades, the most allowed")
    if atr is None or atr <= 0:
        return Skip(symbol, "cannot work out a stop-loss (normal daily movement unknown)")
    if price <= 0 or equity <= 0:
        return Skip(symbol, "price or account value is not usable")

    stop_distance = stop_atr * atr
    stop_price = price - stop_distance
    if stop_price <= 0:
        return Skip(symbol, "the stop-loss would be at or below zero")

    room = p.max_total_fraction * equity - open_notional
    if room <= 0:
        return Skip(symbol, "the account is fully used by open trades")

    limits = {
        f"{p.risk_per_trade:.0%} loss rule": p.risk_per_trade * equity / stop_distance,
        f"{p.max_trade_fraction:.0%} per-trade cap": p.max_trade_fraction * equity / price,
        "room left in the account": room / price,
    }
    binding = min(limits, key=limits.get)
    size = _round_down(limits[binding], size_step)

    if size <= 0 or size < min_size:
        smallest = min_size if min_size > 0 else size_step
        return Skip(
            symbol,
            f"the smallest trade the broker allows ({smallest:g}) is bigger than "
            f"the safety rules allow ({limits[binding]:.4g})",
        )

    return TradePlan(
        symbol=symbol,
        size=size,
        entry_price=price,
        stop_price=stop_price,
        risk_amount=size * stop_distance,
        notional=size * price,
        reason=f"size set by the {binding}",
    )


def brake_on(day_start_equity: float, equity_now: float, p: RiskParams) -> bool:
    """True when the account is down by the daily limit since the day began."""
    if day_start_equity <= 0:
        return False
    return equity_now <= day_start_equity * (1 - p.daily_brake) + 1e-9
