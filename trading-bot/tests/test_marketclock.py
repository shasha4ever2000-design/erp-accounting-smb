import datetime as dt

import pytest

from tradebot.marketclock import brief_time_utc, is_market_day, market_close_utc, market_open_utc

D = dt.date
UTC = dt.UTC


@pytest.mark.parametrize("day,why", [
    (D(2026, 11, 14), "Saturday"),
    (D(2026, 11, 15), "Sunday"),
    (D(2026, 11, 26), "Thanksgiving"),
    (D(2026, 12, 25), "Christmas"),
    (D(2026, 7, 3), "Independence Day falls on Saturday, kept on Friday"),
    (D(2026, 4, 3), "Good Friday"),
    (D(2026, 1, 19), "Martin Luther King Day"),
    (D(2026, 2, 16), "Presidents Day"),
    (D(2026, 5, 25), "Memorial Day"),
    (D(2026, 6, 19), "Juneteenth"),
    (D(2026, 9, 7), "Labor Day"),
    (D(2027, 1, 1), "New Year"),
    (D(2023, 1, 2), "New Year falls on Sunday, kept on Monday"),
])
def test_closed_days(day, why):
    assert is_market_day(day) is False, why


@pytest.mark.parametrize("day", [D(2026, 11, 13), D(2026, 11, 27), D(2027, 12, 31), D(2026, 7, 6)])
def test_open_days(day):
    assert is_market_day(day) is True


def test_open_time_follows_daylight_saving():
    assert market_open_utc(D(2026, 11, 13)) == dt.datetime(2026, 11, 13, 14, 30, tzinfo=UTC)  # winter
    assert market_open_utc(D(2026, 7, 1)) == dt.datetime(2026, 7, 1, 13, 30, tzinfo=UTC)      # summer


def test_brief_is_one_hour_before_the_open_and_close_is_4pm():
    assert brief_time_utc(D(2026, 11, 13)) == dt.datetime(2026, 11, 13, 13, 30, tzinfo=UTC)
    assert market_close_utc(D(2026, 11, 13)) == dt.datetime(2026, 11, 13, 21, 0, tzinfo=UTC)
