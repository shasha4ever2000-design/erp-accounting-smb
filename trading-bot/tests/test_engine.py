import datetime as dt

import pytest

from tests.fakebroker import FakeBroker
from tradebot.config import Config, RiskParams
from tradebot.engine import completed_bars, effective_mode, run_daily_decisions
from tradebot.journal import Journal
from tradebot.models import Bar, Instrument, StrategyParams
from tradebot.state import State

SMALL = StrategyParams(trend_days=5, entry_days=3, exit_days=2, atr_days=2, stop_atr=2.0)
NOW = dt.datetime(2026, 11, 13, 14, 45, tzinfo=dt.UTC)  # Friday, 09:45 in New York
TODAY = NOW.date()


def days_ending_yesterday(rows):
    n = len(rows)
    return [Bar(TODAY - dt.timedelta(days=n - i), *map(float, r)) for i, r in enumerate(rows)]


BUY_BARS = days_ending_yesterday([(10, 10.1, 9.9, 10)] * 6 + [(10, 12.1, 9.9, 12)])   # ATR 1.2
SELL_BARS = days_ending_yesterday([(10, 10.1, 9.9, 10)] * 6 + [(10, 10.0, 9.0, 9.2)])  # below the 2-day low
FLAT_BARS = days_ending_yesterday([(10, 10.1, 9.9, 10)] * 7)


def cfg(symbols=("AAA",), mode="demo", **kw):
    return Config(instruments=tuple(Instrument(s, s.title(), s, "stock") for s in symbols),
                  mode=mode, strategy=SMALL, **kw)


@pytest.fixture
def env(tmp_path):
    return State(tmp_path / "state.json"), Journal(tmp_path / "journal.csv")


def run(broker, config, env, mode=None, now=NOW):
    state, journal = env
    return run_daily_decisions(broker, config, state, journal, now, mode or config.mode)


def buy_broker(**kw):
    b = FakeBroker(**kw)
    b.add_market("AAA", bid=12.4, ask=12.5, bars=BUY_BARS)
    return b


def test_signals_mode_places_nothing(env):
    b = buy_broker()
    decisions = run(b, cfg(mode="signals"), env)
    assert b.opened == []
    assert [(d.symbol, d.action) for d in decisions] == [("AAA", "buy")]
    assert decisions[0].result is None and decisions[0].plan is not None


def test_buy_places_order_with_stop(env):
    b = buy_broker()
    d = run(b, cfg(), env)[0]
    epic, size, stop = b.opened[0]
    assert epic == "AAA"
    assert size == pytest.approx(100 / 2.4)
    assert stop == pytest.approx(12.5 - 2.4)
    assert d.action == "buy" and d.result.ok


def test_size_respects_the_brokers_step_and_rounds_down(env):
    b = FakeBroker()
    b.add_market("AAA", bid=12.4, ask=12.5, size_step=1.0, min_size=1.0, bars=BUY_BARS)
    run(b, cfg(), env)
    assert b.opened[0][1] == 41.0


def test_no_second_trade_in_held_instrument(env):
    b = buy_broker()
    b.hold("AAA", 10, 11.0, 9.0)
    decisions = run(b, cfg(), env)
    assert b.opened == []
    assert decisions[0].action == "hold"


def test_no_rebuy_if_traded_today(env):
    b = buy_broker()
    b.traded.add("AAA")  # another copy of the bot already bought and was stopped out today
    d = run(b, cfg(), env)[0]
    assert b.opened == []
    assert d.action == "skip" and "today" in d.reason


def test_todays_unfinished_bar_ignored(env):
    b = buy_broker()
    b.bars["AAA"] = BUY_BARS + [Bar(TODAY, 12, 12.1, 5.0, 5.0)]  # a crash in progress today
    assert run(b, cfg(), env)[0].action == "buy"


def test_completed_bars_drops_today_and_later():
    bars = FLAT_BARS + [Bar(TODAY, 1, 1, 1, 1), Bar(TODAY + dt.timedelta(days=1), 1, 1, 1, 1)]
    assert completed_bars(bars, TODAY) == FLAT_BARS


def test_rejected_order_journaled_and_not_retried(env):
    state, journal = env
    b = buy_broker()
    b.reject_with = "RISK_CHECK"
    d = run(b, cfg(), env)[0]
    assert d.action == "failed" and "RISK_CHECK" in d.reason
    assert len(b.opened) == 1
    run(b, cfg(), env)                       # a later check the same day
    assert len(b.opened) == 1
    assert "RISK_CHECK" in journal.path.read_text()


def test_brake_blocks_new_buys_but_allows_sells(env):
    state, journal = env
    b = buy_broker(equity=9_600.0)
    b.add_market("BBB", bid=9.2, ask=9.3, bars=SELL_BARS)
    deal = b.hold("BBB", 10, 10.0, 8.0)
    state.start_day(dt.date(2026, 11, 13), 10_000.0)   # down 4% since the morning
    decisions = {d.symbol: d for d in run(b, cfg(("AAA", "BBB")), env)}
    assert b.opened == []
    assert decisions["AAA"].action == "skip" and "3%" in decisions["AAA"].reason
    assert b.closed == [deal] and decisions["BBB"].action == "sell"


def test_trading_disabled_blocks_new_buys(env):
    b = buy_broker()
    d = run(b, cfg(trading_enabled=False), env)[0]
    assert b.opened == []
    assert d.action == "skip" and "off switch" in d.reason


def test_sell_closes_the_held_trade(env):
    b = FakeBroker()
    b.add_market("AAA", bid=9.2, ask=9.3, bars=SELL_BARS)
    deal = b.hold("AAA", 10, 10.0, 8.0)
    d = run(b, cfg(), env)[0]
    assert b.closed == [deal]
    assert d.action == "sell" and d.result.ok


def test_market_not_tradeable_skips_and_tries_again_later(env):
    state, _ = env
    b = FakeBroker()
    b.add_market("AAA", bid=12.4, ask=12.5, tradeable=False, bars=BUY_BARS)
    d = run(b, cfg(), env)[0]
    assert b.opened == [] and d.action == "skip" and "closed" in d.reason
    assert not state.decisions_done(dt.date(2026, 11, 13))
    b.add_market("AAA", bid=12.4, ask=12.5, tradeable=True, bars=BUY_BARS)
    run(b, cfg(), env)
    assert len(b.opened) == 1


def test_runs_once_per_day(env):
    b = buy_broker()
    assert len(run(b, cfg(), env)) == 1
    b.drop("AAA"); b.traded.clear()
    assert run(b, cfg(), env) == []
    assert len(b.opened) == 1


def test_runs_again_the_next_day(env):
    b = buy_broker()
    run(b, cfg(), env)
    b.drop("AAA"); b.traded.clear()
    b.bars["AAA"] = [Bar(x.date + dt.timedelta(days=3), x.open, x.high, x.low, x.close) for x in BUY_BARS]
    run(b, cfg(), env, now=NOW + dt.timedelta(days=3))
    assert len(b.opened) == 2


def test_five_trade_limit_counts_what_is_already_open(env):
    symbols = tuple(f"S{i}" for i in range(7))
    b = FakeBroker()
    for s in symbols[:4]:
        b.add_market(s, bid=10, ask=10, bars=FLAT_BARS)
        b.hold(s, 10, 10.0, 9.0)
    for s in symbols[4:]:
        b.add_market(s, bid=12.4, ask=12.5, bars=BUY_BARS)
    decisions = run(b, cfg(symbols), env)
    assert len(b.opened) == 1
    assert sum(1 for d in decisions if d.action == "skip" and "5" in d.reason) == 2


def test_account_in_another_currency_is_skipped(env):
    b = buy_broker(currency="EUR")
    d = run(b, cfg(), env)[0]
    assert b.opened == [] and d.action == "skip" and "EUR" in d.reason


def test_demo_mode_refuses_a_live_connection(env):
    b = buy_broker(is_demo=False)
    d = run(b, cfg(mode="demo"), env)[0]
    assert b.opened == [] and d.action == "skip" and "demo" in d.reason.lower()


def test_short_history_is_reported_not_fatal(env):
    b = FakeBroker()
    b.add_market("AAA", bid=10, ask=10, bars=FLAT_BARS[:3])
    d = run(b, cfg(), env)[0]
    assert d.action == "none" and "history" in d.reason


def test_every_order_is_written_to_the_journal(env):
    _, journal = env
    run(buy_broker(), cfg(), env)
    text = journal.path.read_text()
    assert "AAA" in text and "buy" in text and "demo" in text


def test_live_needs_both_switches():
    live = cfg(mode="live")
    assert effective_mode(live, {})[0] == "signals"
    assert "second switch" in effective_mode(live, {})[1]
    assert effective_mode(live, {"TRADEBOT_CONFIRM_LIVE": "yes"})[0] == "signals"
    assert effective_mode(live, {"TRADEBOT_CONFIRM_LIVE": "I_UNDERSTAND_REAL_MONEY"}) == ("live", None)
    assert effective_mode(cfg(mode="demo"), {"TRADEBOT_CONFIRM_LIVE": "I_UNDERSTAND_REAL_MONEY"}) == ("demo", None)


def test_stop_price_is_rounded_to_the_markets_decimals(env):
    bars = days_ending_yesterday([(10, 10.1, 9.9, 10)] * 6 + [(10, 12.1234, 9.9, 12)])  # ATR 1.2117
    b = FakeBroker()
    b.add_market("AAA", bid=12.4, ask=12.5, bars=bars, price_decimals=2)
    run(b, cfg(), env)
    assert b.opened[0][2] == 10.08      # 12.5 - 2 * 1.2117 = 10.0766 -> 10.08


def test_price_read_failure_for_one_instrument_does_not_stop_the_others(env):
    state, _ = env
    b = buy_broker()
    b.add_market("BBB", bid=12.4, ask=12.5, bars=BUY_BARS)
    b.fail_bars_for = {"AAA"}
    decisions = {d.symbol: d for d in run(b, cfg(("AAA", "BBB")), env)}
    assert decisions["AAA"].action == "failed" and "prices" in decisions["AAA"].reason
    assert decisions["BBB"].action == "buy" and [o[0] for o in b.opened] == ["BBB"]
    assert not state.decisions_done(dt.date(2026, 11, 13))   # AAA is tried again at the next check
    b.fail_bars_for = set()
    run(b, cfg(("AAA", "BBB")), env)
    assert [o[0] for o in b.opened] == ["BBB", "AAA"]


def test_connection_lost_while_buying_is_reported_as_failed_not_a_crash(env):
    from tradebot.broker.base import BrokerError

    _, journal = env
    b = buy_broker()
    b.order_error = BrokerError("could not reach Capital.com (ConnectionError)")
    d = run(b, cfg(), env)[0]
    assert d.action == "failed"
    assert "check the Capital.com app" in d.reason
    assert "could not reach" in journal.path.read_text()
    run(b, cfg(), env)
    assert len(b.opened) == 1          # not sent a second time


def test_connection_lost_while_selling_is_reported_as_failed_not_a_crash(env):
    from tradebot.broker.base import BrokerError

    b = FakeBroker()
    b.add_market("AAA", bid=9.2, ask=9.3, bars=SELL_BARS)
    b.hold("AAA", 10, 10.0, 8.0)
    b.order_error = BrokerError("could not reach Capital.com (Timeout)")
    d = run(b, cfg(), env)[0]
    assert d.action == "failed" and "could not sell" in d.reason
