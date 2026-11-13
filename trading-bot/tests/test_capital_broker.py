import datetime as dt

import pytest

from tests.fakehttp import LOGIN_OK, FakeResponse, FakeSession
from tradebot.broker.base import BrokerError
from tradebot.broker.capital import CapitalBroker

S = "/api/v1/session"


def broker(session, demo=True):
    return CapitalBroker("KEY-123", "me@example.com", "hunter2-secret", demo=demo, session=session, sleep=lambda s: None)


def test_login_sends_key_and_keeps_tokens_for_later_calls():
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/ping", FakeResponse(200, {"status": "OK"}))
    b = broker(s)
    b.ping()
    login = s.calls_to("POST", S)[0]
    assert login[2]["X-CAP-API-KEY"] == "KEY-123"
    assert login[3] == {"identifier": "me@example.com", "password": "hunter2-secret", "encryptedPassword": False}
    ping = s.calls_to("GET", "/api/v1/ping")[0]
    assert ping[2]["CST"] == "cst-token" and ping[2]["X-SECURITY-TOKEN"] == "sec-token"


def test_demo_and_live_use_different_addresses():
    for demo, host in ((True, "demo-api-capital.backend-capital.com"), (False, "api-capital.backend-capital.com")):
        s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/ping", FakeResponse(200, {}))
        broker(s, demo=demo).ping()
        assert s.last_url.startswith(f"https://{host}/")


def test_expired_session_logs_in_again_once():
    s = (FakeSession().on("POST", S, LOGIN_OK)
         .on("GET", "/api/v1/ping", FakeResponse(401, {"errorCode": "error.invalid.session.token"}), FakeResponse(200, {})))
    broker(s).ping()
    assert len(s.calls_to("POST", S)) == 2


def test_repeated_401_gives_up_with_a_clear_error():
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/ping", FakeResponse(401, {"errorCode": "nope"}))
    with pytest.raises(BrokerError):
        broker(s).ping()
    assert len(s.calls_to("POST", S)) == 2


def test_wrong_login_error_never_contains_secrets():
    s = FakeSession().on("POST", S, FakeResponse(401, {"errorCode": "error.invalid.details hunter2-secret KEY-123"}))
    with pytest.raises(BrokerError) as exc:
        broker(s).ping()
    assert "hunter2-secret" not in str(exc.value) and "KEY-123" not in str(exc.value)
    assert "hunter2-secret" not in repr(broker(s))


def test_account_reads_balance_and_marks_demo():
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/accounts", FakeResponse(200, {"accounts": [
        {"accountId": "999", "preferred": False, "currency": "EUR",
         "balance": {"balance": 1.0, "deposit": 1.0, "profitLoss": 0.0, "available": 1.0}},
        {"accountId": "111", "preferred": True, "currency": "USD",
         "balance": {"balance": 10250.0, "deposit": 10000.0, "profitLoss": 250.0, "available": 8000.0}},
    ]}))
    a = broker(s).account()
    assert (a.equity, a.balance, a.available, a.currency, a.is_demo) == (10250.0, 10000.0, 8000.0, "USD", True)


MARKET = {
    "instrument": {"epic": "AAPL", "name": "Apple Inc", "lotSize": 1, "currency": "USD",
                   "overnightFee": {"longRate": -0.0198, "shortRate": -0.0025}},
    "dealingRules": {"minDealSize": {"unit": "POINTS", "value": 0.1},
                     "minSizeIncrement": {"unit": "POINTS", "value": 0.01}},
    "snapshot": {"marketStatus": "TRADEABLE", "bid": 199.9, "offer": 200.1, "percentageChange": 1.5},
}


def test_market_reads_prices_and_size_rules():
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/markets/AAPL", FakeResponse(200, MARKET))
    m = broker(s).market("AAPL")
    assert (m.bid, m.ask, m.tradeable, m.min_size, m.size_step) == (199.9, 200.1, True, 0.1, 0.01)
    assert (m.currency, m.contract_size, m.day_change, m.overnight_long_rate) == ("USD", 1.0, 0.015, -0.0198)


def test_closed_market_is_not_tradeable():
    closed = {**MARKET, "snapshot": {**MARKET["snapshot"], "marketStatus": "CLOSED"}}
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/markets/AAPL", FakeResponse(200, closed))
    assert broker(s).market("AAPL").tradeable is False


def test_daily_bars_use_middle_of_bid_and_ask():
    prices = {"prices": [
        {"snapshotTimeUTC": "2026-11-11T00:00:00", "openPrice": {"bid": 99, "ask": 101},
         "highPrice": {"bid": 109, "ask": 111}, "lowPrice": {"bid": 89, "ask": 91}, "closePrice": {"bid": 104, "ask": 106}},
        {"snapshotTimeUTC": "2026-11-12T00:00:00", "openPrice": {"bid": 105, "ask": 105},
         "highPrice": {"bid": 106, "ask": 106}, "lowPrice": {"bid": 104, "ask": 104}, "closePrice": {"bid": 105, "ask": 105}},
    ]}
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/prices/AAPL", FakeResponse(200, prices))
    bars = broker(s).daily_bars("AAPL", 250)
    assert s.calls_to("GET", "/api/v1/prices/AAPL")[0][4] == {"resolution": "DAY", "max": 250}
    assert (bars[0].date, bars[0].open, bars[0].high, bars[0].low, bars[0].close) == (dt.date(2026, 11, 11), 100, 110, 90, 105)
    assert bars[1].date == dt.date(2026, 11, 12)


POSITIONS = {"positions": [
    {"position": {"dealId": "D1", "size": 5, "direction": "BUY", "level": 190.0, "stopLevel": 180.0,
                  "upl": 49.5, "createdDateUTC": "2026-11-10T14:31:02.123", "contractSize": 1},
     "market": {"epic": "AAPL", "instrumentName": "Apple Inc", "bid": 199.9, "offer": 200.1}},
    {"position": {"dealId": "D2", "size": 1, "direction": "BUY", "level": 4000.0,
                  "upl": -3.0, "createdDateUTC": "2026-11-12T08:00:00.000"},
     "market": {"epic": "GOLD", "instrumentName": "Gold", "bid": 3997.0, "offer": 3997.5}},
]}


def test_positions_are_read_including_a_missing_stop():
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/positions", FakeResponse(200, POSITIONS))
    p1, p2 = broker(s).positions()
    assert (p1.deal_id, p1.epic, p1.size, p1.entry_price, p1.stop_price, p1.pnl, p1.price) == ("D1", "AAPL", 5, 190.0, 180.0, 49.5, 199.9)
    assert p1.opened == dt.datetime(2026, 11, 10, 14, 31, 2, 123000, tzinfo=dt.UTC)
    assert p2.stop_price is None


def order_session(confirm):
    return (FakeSession().on("POST", S, LOGIN_OK)
            .on("POST", "/api/v1/positions", FakeResponse(200, {"dealReference": "o_ref"}))
            .on("DELETE", "/api/v1/positions/D1", FakeResponse(200, {"dealReference": "p_ref"}))
            .on("GET", "/api/v1/confirms/o_ref", confirm)
            .on("GET", "/api/v1/confirms/p_ref", confirm))


ACCEPTED = FakeResponse(200, {"dealStatus": "ACCEPTED", "status": "OPEN", "level": 200.1, "size": 5,
                              "affectedDeals": [{"dealId": "D9", "status": "OPENED"}]})


def test_open_long_sends_the_stop_and_reads_the_confirmation():
    s = order_session(ACCEPTED)
    r = broker(s).open_long("AAPL", 5, stop_price=190.0)
    body = s.calls_to("POST", "/api/v1/positions")[0][3]
    assert body == {"epic": "AAPL", "direction": "BUY", "size": 5, "stopLevel": 190.0, "guaranteedStop": False}
    assert (r.ok, r.deal_id, r.fill_price) == (True, "D9", 200.1)


def test_rejected_order_is_reported_not_assumed_open():
    s = order_session(FakeResponse(200, {"dealStatus": "REJECTED", "rejectReason": "RISK_CHECK"}))
    r = broker(s).open_long("AAPL", 5, stop_price=190.0)
    assert r.ok is False and "RISK_CHECK" in r.reason
    assert len(s.calls_to("POST", "/api/v1/positions")) == 1  # no retry


def test_order_refused_by_the_server_is_reported():
    s = (FakeSession().on("POST", S, LOGIN_OK)
         .on("POST", "/api/v1/positions", FakeResponse(400, {"errorCode": "error.invalid.stoploss.minvalue: 195"})))
    r = broker(s).open_long("AAPL", 5, stop_price=199.99)
    assert r.ok is False and "stoploss" in r.reason


@pytest.mark.parametrize("stop", [None, 0, -5])
def test_no_stop_no_trade(stop):
    s = order_session(ACCEPTED)
    with pytest.raises(ValueError):
        broker(s).open_long("AAPL", 5, stop_price=stop)
    assert s.calls == []


def test_confirmation_is_retried_briefly_then_reported_unknown():
    s = order_session(FakeResponse(404, {"errorCode": "error.not-found.dealReference"}))
    r = broker(s).open_long("AAPL", 5, stop_price=190.0)
    assert r.ok is False and "confirm" in r.reason
    assert len(s.calls_to("POST", "/api/v1/positions")) == 1
    assert len(s.calls_to("GET", "/api/v1/confirms/o_ref")) == 3


def test_close_deletes_the_position_and_confirms():
    s = order_session(FakeResponse(200, {"dealStatus": "ACCEPTED", "level": 199.9,
                                         "affectedDeals": [{"dealId": "D1", "status": "FULLY_CLOSED"}]}))
    r = broker(s).close("D1")
    assert r.ok is True and r.fill_price == 199.9


def test_traded_today_reads_recent_position_activity():
    acts = {"activities": [
        {"epic": "AAPL", "type": "POSITION", "status": "ACCEPTED", "dateUTC": "2026-11-13T14:31:00.000"},
        {"epic": "MSFT", "type": "POSITION", "status": "REJECTED", "dateUTC": "2026-11-13T14:31:00.000"},
        {"epic": "NVDA", "type": "POSITION", "status": "ACCEPTED", "dateUTC": "2026-11-12T20:00:00.000"},
        {"epic": "TSLA", "type": "SYSTEM", "status": "ACCEPTED", "dateUTC": "2026-11-13T14:31:00.000"},
    ]}
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/history/activity", FakeResponse(200, acts))
    assert broker(s).traded_today(dt.date(2026, 11, 13)) == {"AAPL"}
    assert s.calls_to("GET", "/api/v1/history/activity")[0][4] == {"lastPeriod": 86400}


def test_market_reads_how_many_decimals_prices_use():
    with_places = {**MARKET, "snapshot": {**MARKET["snapshot"], "decimalPlacesFactor": 3}}
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/markets/AAPL", FakeResponse(200, with_places))
    assert broker(s).market("AAPL").price_decimals == 3
    s = FakeSession().on("POST", S, LOGIN_OK).on("GET", "/api/v1/markets/AAPL", FakeResponse(200, MARKET))
    assert broker(s).market("AAPL").price_decimals == 2
