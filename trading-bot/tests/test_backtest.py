import datetime as dt
import random

import pytest

from tests.helpers import make_bars
from tradebot.backtest import longest_losing_streak, max_drawdown, run_backtest
from tradebot.config import Config, Costs, RiskParams
from tradebot.models import Bar, Instrument, StrategyParams

SMALL = StrategyParams(trend_days=5, entry_days=3, exit_days=2, atr_days=2, stop_atr=2.0)
FREE = Costs(spread={"stock": 0.0, "metal": 0.0}, overnight_rate={"stock": 0.0, "metal": 0.0})
D0 = dt.date(2020, 1, 1)


def day(i):
    return D0 + dt.timedelta(days=i)


def cfg(symbols=("AAA",), costs=FREE, risk=RiskParams(), strategy=SMALL):
    return Config(
        instruments=tuple(Instrument(s, s, s, "stock") for s in symbols),
        strategy=strategy, risk=risk, costs=costs,
    )


def breakout_then(tail):
    """7 days: six flat at 10, then a close at 12 (the buy signal on day 6).
    `tail` is a list of (open, high, low, close) for the days after."""
    rows = [(10, 10.1, 9.9, 10)] * 6 + [(10, 12.1, 9.9, 12)] + list(tail)
    return [Bar(day(i), *map(float, r)) for i, r in enumerate(rows)]


# With SMALL params the signal-day ATR is (0.2 + 2.2) / 2 = 1.2, so the stop sits 2.4 below entry.


def test_enters_next_open_after_signal():
    res = run_backtest({"AAA": breakout_then([(12.5, 12.7, 12.4, 12.6)])}, cfg())
    assert len(res.trades) == 1
    t = res.trades[0]
    assert t.entry_date == day(7)
    assert t.entry_price == 12.5
    assert t.exit_reason == "end"


def test_size_follows_the_one_percent_rule():
    res = run_backtest({"AAA": breakout_then([(12.5, 12.7, 12.4, 12.6)])}, cfg(), start_equity=10_000)
    assert res.trades[0].size == pytest.approx(100 / 2.4)


def test_exits_next_open_after_exit_signal():
    tail = [
        (12.5, 12.7, 12.4, 12.6),
        (12.9, 13.2, 12.9, 13.0),
        (12.8, 12.9, 11.9, 12.0),   # closes below the low of the two days before (12.4)
        (11.8, 12.0, 11.7, 11.9),   # sold at this open
        (11.9, 12.0, 11.8, 11.9),
    ]
    res = run_backtest({"AAA": breakout_then(tail)}, cfg())
    t = res.trades[0]
    assert (t.exit_date, t.exit_price, t.exit_reason) == (day(10), 11.8, "signal")
    assert t.pnl == pytest.approx(t.size * (11.8 - 12.5))


def test_stop_fills_at_stop_price():
    tail = [(12.5, 12.7, 12.4, 12.6), (12.4, 12.5, 10.0, 10.5), (10.5, 10.6, 10.4, 10.5)]
    t = run_backtest({"AAA": breakout_then(tail)}, cfg()).trades[0]
    assert (t.exit_date, t.exit_reason) == (day(8), "stop")
    assert t.exit_price == pytest.approx(12.5 - 2.4)


def test_gap_through_stop_fills_at_open():
    tail = [(12.5, 12.7, 12.4, 12.6), (9.5, 9.8, 9.4, 9.6), (9.6, 9.7, 9.5, 9.6)]
    t = run_backtest({"AAA": breakout_then(tail)}, cfg()).trades[0]
    assert (t.exit_date, t.exit_price, t.exit_reason) == (day(8), 9.5, "stop")


def test_stop_can_hit_on_entry_day():
    tail = [(12.5, 12.7, 10.0, 10.3), (10.3, 10.4, 10.2, 10.3)]
    t = run_backtest({"AAA": breakout_then(tail)}, cfg()).trades[0]
    assert (t.entry_date, t.exit_date, t.exit_reason) == (day(7), day(7), "stop")


def test_losing_at_the_stop_costs_about_one_percent():
    tail = [(12.5, 12.7, 12.4, 12.6), (12.4, 12.5, 10.0, 10.5), (10.5, 10.6, 10.4, 10.5)]
    res = run_backtest({"AAA": breakout_then(tail)}, cfg(), start_equity=10_000)
    assert res.end_equity == pytest.approx(9_900.0)


def test_costs_reduce_result():
    tail = [(12.5, 12.7, 12.4, 12.6), (12.9, 13.2, 12.9, 13.0), (13.1, 13.3, 13.0, 13.2)]
    hist = {"AAA": breakout_then(tail)}
    free = run_backtest(hist, cfg())
    costly = run_backtest(hist, cfg(costs=Costs(spread={"stock": 0.01, "metal": 0.01},
                                                overnight_rate={"stock": 0.10, "metal": 0.10})))
    assert costly.end_equity < free.end_equity
    assert costly.trades[0].entry_price == pytest.approx(12.5 * 1.005)


def test_never_more_than_five_open():
    symbols = tuple(f"S{i}" for i in range(7))
    hist = {s: breakout_then([(12.5, 12.7, 12.4, 12.6), (12.6, 12.8, 12.5, 12.7)]) for s in symbols}
    res = run_backtest(hist, cfg(symbols))
    assert len(res.trades) == 5
    assert res.stats["max_open_trades"] == 5


def test_total_of_open_trades_never_exceeds_account():
    symbols = tuple(f"S{i}" for i in range(7))
    hist = {s: breakout_then([(12.5, 12.7, 12.4, 12.6), (12.6, 12.8, 12.5, 12.7)]) for s in symbols}
    res = run_backtest(hist, cfg(symbols), start_equity=10_000)
    assert sum(t.size * t.entry_price for t in res.trades) <= 10_000 + 1e-6


def test_never_two_trades_same_symbol():
    tail = [(12.5, 12.7, 12.4, 12.6), (12.9, 14.2, 12.9, 14.0), (14.1, 16.2, 14.0, 16.0),
            (16.1, 18.2, 16.0, 18.0)]  # keeps making new highs while held
    res = run_backtest({"AAA": breakout_then(tail)}, cfg())
    assert len(res.trades) == 1


def test_strongest_signal_first_when_slots_limited():
    weak = breakout_then([(12.5, 12.7, 12.4, 12.6)])
    rows = [(10, 10.1, 9.9, 10)] * 6 + [(10, 15.1, 9.9, 15), (15.5, 15.7, 15.4, 15.6)]
    strong = [Bar(day(i), *map(float, r)) for i, r in enumerate(rows)]
    res = run_backtest({"WEAK": weak, "STRONG": strong},
                       cfg(("WEAK", "STRONG"), risk=RiskParams(max_open_trades=1)))
    assert [t.symbol for t in res.trades] == ["STRONG"]


def random_walk(seed, n):
    rng = random.Random(seed)
    price, bars = 100.0, []
    for i in range(n):
        o = price * (1 + rng.uniform(-0.01, 0.01))
        c = o * (1 + rng.uniform(-0.03, 0.035))
        h, l = max(o, c) * (1 + rng.uniform(0, 0.01)), min(o, c) * (1 - rng.uniform(0, 0.01))
        bars.append(Bar(day(i), o, h, l, c))
        price = c
    return bars


def test_no_lookahead():
    full = {f"R{s}": random_walk(s, 400) for s in range(4)}
    cut = 300
    part = {s: bars[:cut] for s, bars in full.items()}
    c = cfg(tuple(full))
    key = lambda t: (t.symbol, t.entry_date, t.entry_price, t.size, t.exit_date, t.exit_price, t.exit_reason)
    done_in_part = [key(t) for t in run_backtest(part, c).trades if t.exit_reason != "end"]
    in_full = {key(t) for t in run_backtest(full, c).trades}
    assert len(done_in_part) >= 5, "the random data should produce some trades"
    assert all(k in in_full for k in done_in_part)


def test_buy_and_hold_is_equal_money_in_everything():
    flat = make_bars([10.0] * 12, start=D0)
    doubles = make_bars([10.0] * 6 + [10, 12, 14, 16, 18, 20], start=D0)
    res = run_backtest({"FLAT": flat, "UP": doubles}, cfg(("FLAT", "UP")))
    # comparison starts once 5 days of history exist (day index 5), UP doubles after that
    assert res.buy_hold["total_return"] == pytest.approx(0.5)


def test_symbol_with_too_little_history_is_skipped_not_fatal():
    hist = {"AAA": breakout_then([(12.5, 12.7, 12.4, 12.6)]), "NEW": make_bars([5.0, 5.1], start=day(6))}
    res = run_backtest(hist, cfg(("AAA", "NEW")))
    assert [t.symbol for t in res.trades] == ["AAA"]
    assert "NEW" in res.skipped


def test_max_drawdown():
    curve = [(day(0), 100.0), (day(1), 120.0), (day(2), 90.0), (day(3), 130.0), (day(4), 117.0)]
    assert max_drawdown(curve) == pytest.approx(0.25)


def test_longest_losing_streak():
    assert longest_losing_streak([5, -1, -2, 3, -1, -1, -1, 2]) == 3
    assert longest_losing_streak([1, 2]) == 0
