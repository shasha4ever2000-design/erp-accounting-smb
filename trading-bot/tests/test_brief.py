import datetime as dt

from tradebot.brief import build_brief
from tradebot.broker.base import Account, Position
from tradebot.config import Config
from tradebot.models import Instrument, Signal
from tradebot.scan import Row

DAY = dt.date(2026, 11, 13)
ACCOUNT = Account(equity=10_240.0, balance=10_000.0, available=6_000.0, currency="USD", is_demo=True)
I = {s: Instrument(s, n, s, "stock") for s, n in
     [("NVDA", "Nvidia"), ("COST", "Costco"), ("AAPL", "Apple"), ("TSLA", "Tesla"), ("XOM", "Exxon Mobil")]}
CFG = Config(instruments=tuple(I.values()))


def pos(epic, size, entry, stop, pnl):
    return Position("D1", epic, size, entry, stop, None, pnl, entry, epic)


def rows():
    return [
        Row(I["NVDA"], Signal("hold", "still above its 10-day low of 168", exit_level=168.0, close=175.0),
            pos("NVDA", 10, 170.0, 160.5, 50.0), 175.0, 172.0),
        Row(I["COST"], Signal("buy", "closed at 912.4, a new 20-day high, and above its 200-day average",
                              entry_level=905.0, trend_avg=850.0, atr=12.0, close=912.4), None, 912.4, 900.0),
        Row(I["AAPL"], Signal("none", "in an uptrend but not above its 20-day high of 243.1",
                              entry_level=243.1, trend_avg=220.0, atr=4.0, close=241.2), None, 241.2, 240.0,
            buy_level=243.1, trend_avg=220.0),
        Row(I["TSLA"], Signal("none", "below its 200-day average, so not in an uptrend",
                              entry_level=300.0, trend_avg=320.0, atr=9.0, close=299.0), None, 299.0, 287.0,
            buy_level=300.0, trend_avg=320.0),
        Row(I["XOM"], Signal("none", "not enough price history (needs 200 days)"), None, None, None),
    ]


def brief(mode="demo", r=None, news=None):
    return build_brief(mode, DAY, ACCOUNT, r if r is not None else rows(), news or {}, CFG)


def test_brief_starts_with_the_mode_tag_and_date():
    assert brief().splitlines()[0] == "[DEMO] Good morning. Friday 13 Nov"
    assert brief("signals").startswith("[SIGNALS]")
    assert brief("live").startswith("[LIVE]")


def test_brief_shows_account_and_open_trades_with_stops():
    text = brief()
    assert "$10,240" in text and "Open trades: 1" in text
    assert "Nvidia" in text and "+2.9%" in text and "stop-loss 160.5" in text


def test_brief_flags_a_trade_without_a_stop():
    r = rows()
    r[0] = Row(I["NVDA"], r[0].signal, pos("NVDA", 10, 170.0, None, 50.0), 175.0, 172.0)
    assert "NO STOP-LOSS" in brief(r=r)


def test_brief_lists_what_happens_at_the_open_with_reasons():
    text = brief()
    assert "BUY Costco: closed at 912.4, a new 20-day high" in text


def test_brief_says_so_when_nothing_to_do():
    quiet = [x for x in rows() if x.signal.action != "buy"]
    assert "Nothing to buy or sell today" in brief(r=quiet)


def test_signals_mode_says_no_orders_are_placed():
    assert "will not place" in brief("signals")
    assert "will not place" not in brief("demo")


def test_brief_lists_instruments_close_to_a_buy_level():
    text = brief()
    assert "Apple is 0.8% below its buy level (243.1)" in text
    assert "Tesla is" not in text  # not in an uptrend, so not "close"


def test_brief_lists_held_instruments_close_to_a_sell_level():
    r = rows()
    r[0] = Row(I["NVDA"], Signal("hold", "x", exit_level=170.0, close=175.0), r[0].held, 175.0, 172.0, sell_level=174.0)
    assert "Nvidia is 0.6% above its sell level (174)" in brief(r=r)


def test_brief_shows_yesterdays_biggest_moves():
    text = brief()
    assert "Tesla +4.2%" in text
    assert text.index("Tesla +4.2%") < text.index("Nvidia +1.7%")


def test_brief_includes_headlines_only_when_there_are_some():
    assert "Headlines" not in brief()
    text = brief(news={"COST": ["Costco beats forecasts"]})
    assert "Headlines" in text and "Costco: Costco beats forecasts" in text


def test_brief_mentions_instruments_without_enough_history():
    assert "Exxon Mobil" in brief() and "not enough price history" in brief()
