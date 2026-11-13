"""Small builders shared by tests."""
import datetime as dt

from tradebot.models import Bar


def make_bars(closes, start=dt.date(2020, 1, 1), spread=1.0, opens=None, highs=None, lows=None):
    """One bar per close on consecutive calendar days. High/low default to close +/- spread."""
    bars = []
    for i, c in enumerate(closes):
        bars.append(
            Bar(
                date=start + dt.timedelta(days=i),
                open=opens[i] if opens else c,
                high=highs[i] if highs else c + spread,
                low=lows[i] if lows else c - spread,
                close=c,
            )
        )
    return bars
