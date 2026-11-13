import datetime as dt

import pytest

from tests.fakebroker import FakeBroker
from tests.test_engine import FLAT_BARS, NOW, SMALL, TODAY
from tradebot.config import Config
from tradebot.models import Instrument
from tradebot.state import State
from tradebot.watch import run_watch

CFG = Config(instruments=(Instrument("AAA", "Alpha", "AAA", "stock"), Instrument("BBB", "Beta", "BBB", "stock")),
             strategy=SMALL)


@pytest.fixture
def state(tmp_path):
    s = State(tmp_path / "state.json")
    s.start_day(TODAY, 10_000.0)
    return s


def calm_broker():
    b = FakeBroker()
    b.add_market("AAA", bid=10.0, ask=10.0, bars=FLAT_BARS, day_change=0.001)
    b.add_market("BBB", bid=10.0, ask=10.0, bars=FLAT_BARS, day_change=-0.002)
    return b


def keys(alerts):
    return [a.key for a in alerts]


def test_quiet_market_gives_no_alerts(state):
    assert run_watch(calm_broker(), CFG, state, NOW) == []


def test_big_move_is_reported_once(state):
    b = calm_broker()
    b.add_market("AAA", bid=10.4, ask=10.4, bars=FLAT_BARS, day_change=0.041)
    first = run_watch(b, CFG, state, NOW)
    assert "move:AAA:up" in keys(first)
    assert any("Alpha" in a.text and "4.1%" in a.text for a in first)
    assert "move:AAA:up" not in keys(run_watch(b, CFG, state, NOW))


def test_big_fall_is_reported(state):
    b = calm_broker()
    b.add_market("BBB", bid=9.6, ask=9.6, bars=FLAT_BARS, day_change=-0.035)
    assert "move:BBB:down" in keys(run_watch(b, CFG, state, NOW))


def test_heads_up_when_price_crosses_the_buy_level(state):
    b = calm_broker()
    b.add_market("AAA", bid=10.2, ask=10.2, bars=FLAT_BARS, day_change=0.02)  # buy level is 10.1
    alerts = run_watch(b, CFG, state, NOW)
    assert keys(alerts) == ["cross-buy:AAA"]
    assert "tomorrow" in alerts[0].text


def test_no_buy_heads_up_for_something_already_held(state):
    b = calm_broker()
    b.add_market("AAA", bid=10.2, ask=10.2, bars=FLAT_BARS, day_change=0.02)
    b.hold("AAA", 10, 10.0, 9.0)
    state.set_known_positions({"AAA": {"stop": 9.0, "name": "Alpha"}})
    assert run_watch(b, CFG, state, NOW) == []


def test_heads_up_when_a_held_trade_falls_below_its_sell_level(state):
    b = calm_broker()
    b.add_market("AAA", bid=9.8, ask=9.8, bars=FLAT_BARS, day_change=-0.02)  # sell level is 9.9
    b.hold("AAA", 10, 10.0, 9.0)
    state.set_known_positions({"AAA": {"stop": 9.0, "name": "Alpha"}})
    assert keys(run_watch(b, CFG, state, NOW)) == ["cross-sell:AAA"]


def test_stop_hit_detected_when_a_known_trade_is_gone(state):
    b = calm_broker()
    state.set_known_positions({"AAA": {"stop": 9.0, "name": "Alpha"}})
    alerts = run_watch(b, CFG, state, NOW)
    assert keys(alerts) == ["closed:AAA"]
    assert "no longer open" in alerts[0].text and "9" in alerts[0].text
    assert state.known_positions() == {}
    assert run_watch(b, CFG, state, NOW) == []


def test_new_trades_are_remembered_for_next_time(state):
    b = calm_broker()
    b.hold("BBB", 10, 10.0, 9.0)
    run_watch(b, CFG, state, NOW)
    assert state.known_positions()["BBB"]["stop"] == 9.0


def test_trade_without_a_stop_is_flagged(state):
    b = calm_broker()
    b.hold("BBB", 10, 10.0, None)
    assert "nostop:BBB" in keys(run_watch(b, CFG, state, NOW))


def test_brake_is_announced_once(state):
    b = FakeBroker(equity=9_650.0)
    b.add_market("AAA", bid=10.0, ask=10.0, bars=FLAT_BARS, day_change=0.0)
    b.add_market("BBB", bid=10.0, ask=10.0, bars=FLAT_BARS, day_change=0.0)
    assert "brake" in keys(run_watch(b, CFG, state, NOW))
    assert "brake" not in keys(run_watch(b, CFG, state, NOW))
