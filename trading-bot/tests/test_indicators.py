import datetime as dt

from tradebot.indicators import atr, highest, lowest, sma
from tradebot.models import Bar


def test_sma_needs_full_window():
    assert sma([1, 2, 3], 4) is None
    assert sma([1, 2, 3, 4], 4) == 2.5


def test_sma_uses_only_the_last_n_values():
    assert sma([100, 1, 2, 3], 3) == 2.0


def test_highest_and_lowest_use_last_n_values():
    assert highest([9, 1, 5, 3], 3) == 5
    assert lowest([0, 4, 5, 3], 3) == 3
    assert highest([1, 2], 3) is None
    assert lowest([1, 2], 3) is None


def test_atr_uses_gaps():
    d = dt.date(2024, 1, 1)
    bars = [
        Bar(d, 10, 10, 10, 10),
        # gap up: range within the day is 1, but distance from yesterday's close is 5
        Bar(d + dt.timedelta(days=1), 14, 15, 14, 15),
        Bar(d + dt.timedelta(days=2), 15, 16, 13, 14),  # true range 3
    ]
    assert atr(bars, 2) == 4.0


def test_atr_needs_n_plus_one_bars():
    d = dt.date(2024, 1, 1)
    bars = [Bar(d, 10, 11, 9, 10), Bar(d + dt.timedelta(days=1), 10, 11, 9, 10)]
    assert atr(bars, 2) is None
