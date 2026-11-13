import pytest

from tradebot.config import RiskParams
from tradebot.risk import Skip, TradePlan, brake_on, plan_trade

P = RiskParams()


def plan(**kw):
    args = dict(symbol="AAPL", price=100.0, atr=2.0, equity=10_000.0, open_notional=0.0,
                open_count=0, p=P, stop_atr=2.0)
    args.update(kw)
    return plan_trade(**args)


def test_size_risks_one_percent():
    t = plan(atr=4.0)  # stop 8 below the price -> 12.5 units lose 100 at the stop
    assert isinstance(t, TradePlan)
    assert t.stop_price == 92.0
    assert t.size == 12.5
    assert t.risk_amount == pytest.approx(100.0)
    assert t.notional == pytest.approx(1250.0)


def test_trade_capped_at_20_percent():
    t = plan(atr=0.5)  # tight stop would mean a huge trade; the cap wins
    assert isinstance(t, TradePlan)
    assert t.size == 20.0
    assert t.notional == pytest.approx(2000.0)
    assert t.risk_amount < 100.0


def test_one_percent_rule_wins_when_it_is_smaller_than_the_cap():
    t = plan(atr=5.0)  # stop 10 away -> 10 units -> 1000 of value, under the 2000 cap
    assert t.size == 10.0
    assert t.risk_amount == pytest.approx(100.0)


def test_total_open_never_above_account():
    t = plan(open_notional=9_500.0)
    assert isinstance(t, TradePlan)
    assert t.notional <= 500.0 + 1e-9
    assert t.size == 5.0


def test_skip_when_account_fully_used():
    s = plan(open_notional=10_000.0)
    assert isinstance(s, Skip)
    assert "account" in s.reason


def test_skip_at_five_open_trades():
    s = plan(open_count=5)
    assert isinstance(s, Skip)
    assert "5" in s.reason


def test_size_rounds_down_to_step():
    t = plan(price=30.0, atr=1.0, size_step=1.0)  # 1% rule -> 50; 20% cap -> 66.67 -> 50
    assert t.size == 50.0
    t = plan(price=33.0, atr=0.4, size_step=1.0)  # cap: 2000/33 = 60.6 -> 60
    assert t.size == 60.0
    t = plan(price=4000.0, atr=40.0, size_step=0.01)  # 1%: 100/80 = 1.25; cap: 0.5 -> 0.5
    assert t.size == 0.5


def test_skip_when_min_size_breaks_risk():
    # the rules allow 0.5 units, but the broker's smallest trade is 1
    s = plan(price=4000.0, atr=40.0, min_size=1.0, size_step=0.01)
    assert isinstance(s, Skip)
    assert "smallest" in s.reason


def test_skip_when_rounding_leaves_nothing():
    s = plan(price=3000.0, atr=30.0, size_step=1.0)  # cap allows 0.66 -> rounds down to 0
    assert isinstance(s, Skip)


@pytest.mark.parametrize("bad_atr", [None, 0.0, -1.0])
def test_skip_when_atr_missing_or_zero(bad_atr):
    s = plan(atr=bad_atr)
    assert isinstance(s, Skip)
    assert "stop" in s.reason


def test_skip_when_stop_would_be_at_or_below_zero():
    s = plan(price=3.0, atr=2.0)
    assert isinstance(s, Skip)


def test_brake_at_three_percent():
    assert brake_on(10_000.0, 9_700.0, P) is True
    assert brake_on(10_000.0, 9_701.0, P) is False
    assert brake_on(10_000.0, 10_500.0, P) is False
