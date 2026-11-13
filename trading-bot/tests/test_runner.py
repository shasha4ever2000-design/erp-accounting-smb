import datetime as dt

import pytest

from tests.fakebroker import FakeBroker
from tests.test_engine import BUY_BARS, FLAT_BARS, SELL_BARS, SMALL
from tradebot.broker.base import BrokerError
from tradebot.config import Config
from tradebot.journal import Journal
from tradebot.models import Instrument
from tradebot.runner import run_check, run_doctor
from tradebot.state import State

UTC = dt.UTC
FRIDAY = dt.date(2026, 11, 13)


def at(hour, minute=0, day=FRIDAY):
    return dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


class Box:
    def __init__(self):
        self.messages = []

    def send(self, text):
        self.messages.append(text)
        return True


@pytest.fixture
def kit(tmp_path):
    return State(tmp_path / "state.json"), Journal(tmp_path / "journal.csv"), Box()


def cfg(mode="demo"):
    return Config(instruments=(Instrument("AAA", "Alpha", "AAA", "stock"),), mode=mode, strategy=SMALL)


def broker(bars=BUY_BARS, **kw):
    b = FakeBroker(**kw)
    b.add_market("AAA", bid=12.4, ask=12.5, bars=bars, day_change=0.001)
    return b


def check(b, kit, now, mode="demo", **kw):
    state, journal, box = kit
    return run_check(b, cfg(mode), state, journal, box, now, mode, news_fetch=lambda url: "", **kw)


def test_closed_day_does_nothing_at_all(kit):
    b = broker()
    b.fail_reading = RuntimeError("the broker must not even be asked")
    assert check(b, kit, at(15, day=dt.date(2026, 11, 14))) == 0     # Saturday
    assert check(b, kit, at(15, day=dt.date(2026, 11, 26))) == 0     # Thanksgiving
    assert kit[2].messages == []


def test_nothing_before_the_brief_time(kit):
    assert check(broker(), kit, at(12, 0)) == 0
    assert kit[2].messages == []


def test_brief_is_sent_once_before_the_open_and_no_orders_yet(kit):
    b = broker()
    check(b, kit, at(13, 35))
    check(b, kit, at(13, 50))
    briefs = [m for m in kit[2].messages if "Good morning" in m]
    assert len(briefs) == 1 and briefs[0].startswith("[DEMO]")
    assert "BUY Alpha" in briefs[0]
    assert b.opened == []


def test_orders_go_in_after_the_open_and_are_reported(kit):
    b = broker()
    check(b, kit, at(14, 45))
    assert len(b.opened) == 1
    report = next(m for m in kit[2].messages if "Orders at the open" in m)
    assert "BOUGHT Alpha" in report and "stop-loss 10.1" in report


def test_no_orders_in_the_first_two_minutes(kit):
    b = broker()
    check(b, kit, at(14, 31))
    assert b.opened == []


def test_orders_are_not_placed_late_in_the_day(kit):
    b = broker()
    check(b, kit, at(18, 0))
    assert b.opened == []


def test_nothing_new_after_the_close(kit):
    b = broker()
    check(b, kit, at(21, 30))
    assert kit[2].messages == [] and b.opened == []


def test_signals_mode_reports_signals_and_places_nothing(kit):
    b = broker()
    check(b, kit, at(14, 45), mode="signals")
    assert b.opened == []
    report = next(m for m in kit[2].messages if "Signals for today" in m)
    assert report.startswith("[SIGNALS]") and "BUY signal Alpha" in report and "no orders" in report


def test_quiet_day_sends_no_order_report(kit):
    check(broker(bars=FLAT_BARS), kit, at(14, 45))
    assert not any("Orders at the open" in m for m in kit[2].messages)


def test_selling_does_not_also_raise_a_stop_alert(kit):
    state, _, box = kit
    b = broker(bars=SELL_BARS)
    b.hold("AAA", 10, 10.0, 8.0)
    state.set_known_positions({"AAA": {"stop": 8.0, "name": "Alpha"}})
    check(b, kit, at(14, 45))
    assert any("SOLD Alpha" in m for m in box.messages)
    assert not any("no longer open" in m for m in box.messages)


def test_watch_alerts_are_sent_during_market_hours(kit):
    b = broker(bars=FLAT_BARS)
    b.add_market("AAA", bid=10.5, ask=10.5, bars=FLAT_BARS, day_change=0.05)
    check(b, kit, at(18, 0))
    assert any("Alpha is up 5.0% today" in m for m in kit[2].messages)


def test_every_message_carries_the_mode_tag(kit):
    b = broker(bars=FLAT_BARS)
    b.add_market("AAA", bid=10.5, ask=10.5, bars=FLAT_BARS, day_change=0.05)
    check(b, kit, at(14, 45))
    assert kit[2].messages and all(m.startswith("[DEMO]") for m in kit[2].messages)


def test_a_failure_is_reported_once_and_the_run_fails(kit):
    b = broker()
    b.fail_reading = BrokerError("could not reach Capital.com (ConnectionError)")
    assert check(b, kit, at(14, 45)) == 1
    assert check(b, kit, at(15, 0)) == 1
    problems = [m for m in kit[2].messages if "Something went wrong" in m]
    assert len(problems) == 1 and "could not reach Capital.com" in problems[0]


def test_the_live_fallback_note_is_sent_once_a_day(kit):
    b = broker(bars=FLAT_BARS)
    note = "config.yaml says 'live' but the second switch is not set"
    check(b, kit, at(14, 45), mode="signals", mode_note=note)
    check(b, kit, at(15, 0), mode="signals", mode_note=note)
    assert sum(note in m for m in kit[2].messages) == 1


def test_doctor_reports_the_account_and_each_instrument():
    b = broker(bars=FLAT_BARS)
    b.markets["AAA"] = b.markets["AAA"].__class__(**{**b.markets["AAA"].__dict__, "overnight_long_rate": -0.021})
    config = Config(instruments=(Instrument("AAA", "Alpha", "AAA", "stock"),
                                 Instrument("ZZZ", "Missing", "ZZZ", "stock")), strategy=SMALL)
    lines = []
    code = run_doctor(b, config, at(14, 45), out=lines.append)
    text = "\n".join(lines)
    assert code == 1                                  # one instrument is missing
    assert "DEMO" in text and "10,000" in text
    assert "Alpha" in text and "-0.021" in text
    assert "Missing" in text and "NOT FOUND" in text
