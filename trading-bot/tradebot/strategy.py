"""The trading rules. Used by both the test on past prices and the live bot.

Buy:  the day's close is above its long-term average AND above the highest
      price of the previous `entry_days` days.
Sell: the day's close is below the lowest price of the previous `exit_days` days.

`bars` must hold finished days only; the last bar is the day being judged.
"""

from __future__ import annotations

from collections.abc import Sequence

from .indicators import atr, highest, lowest, sma
from .models import Bar, Signal, StrategyParams


def evaluate(bars: Sequence[Bar], p: StrategyParams, holding: bool) -> Signal:
    if not bars:
        return Signal("hold" if holding else "none", "no price history")

    today = bars[-1]
    before = bars[:-1]
    exit_level = lowest([b.low for b in before], p.exit_days)
    atr_now = atr(bars, p.atr_days)

    if holding:
        if exit_level is None:
            return Signal("hold", "not enough price history to judge an exit", close=today.close, atr=atr_now)
        if today.close < exit_level:
            return Signal(
                "sell",
                f"closed at {today.close:g}, below its {p.exit_days}-day low of {exit_level:g}",
                exit_level=exit_level, atr=atr_now, close=today.close,
            )
        return Signal(
            "hold",
            f"still above its {p.exit_days}-day low of {exit_level:g}",
            exit_level=exit_level, atr=atr_now, close=today.close,
        )

    trend_avg = sma([b.close for b in bars], p.trend_days)
    entry_level = highest([b.high for b in before], p.entry_days)
    common = dict(entry_level=entry_level, exit_level=exit_level, atr=atr_now, trend_avg=trend_avg, close=today.close)

    if trend_avg is None or entry_level is None or atr_now is None:
        return Signal("none", f"not enough price history (needs {p.trend_days} days)", **common)
    if today.close <= trend_avg:
        return Signal("none", f"below its {p.trend_days}-day average, so not in an uptrend", **common)
    if today.close <= entry_level:
        return Signal("none", f"in an uptrend but not above its {p.entry_days}-day high of {entry_level:g}", **common)
    return Signal(
        "buy",
        f"closed at {today.close:g}, a new {p.entry_days}-day high, and above its {p.trend_days}-day average",
        **common,
    )


def next_levels(bars: Sequence[Bar], p: StrategyParams) -> tuple[float | None, float | None, float | None]:
    """The prices that matter for the NEXT close: (buy level, sell level, long-term average).

    `bars` are finished days. A close above the buy level (and the average) is a buy;
    a close below the sell level is a sell.
    """
    return (
        highest([b.high for b in bars], p.entry_days),
        lowest([b.low for b in bars], p.exit_days),
        sma([b.close for b in bars], p.trend_days),
    )
