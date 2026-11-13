"""Small price calculations. Each returns None when there is not enough data."""

from __future__ import annotations

from collections.abc import Sequence

from .models import Bar


def sma(values: Sequence[float], n: int) -> float | None:
    """Average of the last n values."""
    if n <= 0 or len(values) < n:
        return None
    return sum(values[-n:]) / n


def highest(values: Sequence[float], n: int) -> float | None:
    if n <= 0 or len(values) < n:
        return None
    return max(values[-n:])


def lowest(values: Sequence[float], n: int) -> float | None:
    if n <= 0 or len(values) < n:
        return None
    return min(values[-n:])


def atr(bars: Sequence[Bar], n: int) -> float | None:
    """How much the price normally moves in a day: the average 'true range'
    of the last n days. True range also counts a jump from yesterday's close."""
    if n <= 0 or len(bars) < n + 1:
        return None
    total = 0.0
    for i in range(len(bars) - n, len(bars)):
        prev_close = bars[i - 1].close
        b = bars[i]
        total += max(b.high - b.low, abs(b.high - prev_close), abs(b.low - prev_close))
    return total / n
