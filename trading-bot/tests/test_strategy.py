from tests.helpers import make_bars
from tradebot.models import StrategyParams
from tradebot.strategy import evaluate

P = StrategyParams()  # 200 / 20 / 10 / 20 / 2.0


def rising(n=220, start=100.0, step=0.1):
    return [start + i * step for i in range(n)]


def test_buy_when_close_above_trend_and_prior_20_day_high():
    closes = rising(220) + [130.0]  # last day jumps above everything before
    bars = make_bars(closes)
    sig = evaluate(bars, P, holding=False)
    assert sig.action == "buy"
    assert sig.entry_level == max(b.high for b in bars[-21:-1])
    assert sig.close == 130.0
    assert sig.atr is not None and sig.atr > 0
    assert sig.reason


def test_no_buy_below_200_day_average():
    # long fall, then a small 20-day-high breakout that is still far below the average
    closes = [300 - i for i in range(220)] + [79.5] * 20 + [82.0]
    sig = evaluate(make_bars(closes, spread=0.5), P, holding=False)
    assert sig.action == "none"
    assert "average" in sig.reason


def test_no_buy_when_close_equals_prior_high():
    closes = rising(220)
    bars = make_bars(closes)
    prior_high = max(b.high for b in bars[-20:])
    bars = bars + make_bars([prior_high], start=bars[-1].date.replace(year=2021))
    sig = evaluate(bars, P, holding=False)
    assert sig.action == "none"


def test_sell_when_holding_and_close_below_prior_10_day_low():
    closes = rising(220) + [100.0]  # drops below the lows of the 10 days before
    sig = evaluate(make_bars(closes), P, holding=True)
    assert sig.action == "sell"
    assert sig.exit_level is not None and sig.close < sig.exit_level


def test_hold_when_holding_and_no_exit():
    sig = evaluate(make_bars(rising(221)), P, holding=True)
    assert sig.action == "hold"


def test_holding_never_gives_buy():
    closes = rising(220) + [130.0]
    assert evaluate(make_bars(closes), P, holding=True).action == "hold"


def test_not_holding_never_gives_sell():
    closes = rising(220) + [100.0]
    assert evaluate(make_bars(closes), P, holding=False).action == "none"


def test_short_history_gives_none_with_reason():
    sig = evaluate(make_bars(rising(150)), P, holding=False)
    assert sig.action == "none"
    assert "history" in sig.reason


def test_holding_with_short_history_still_checks_exit():
    # only 30 days of prices, but enough for the 10-day exit rule
    closes = [100.0] * 29 + [90.0]
    assert evaluate(make_bars(closes), P, holding=True).action == "sell"
