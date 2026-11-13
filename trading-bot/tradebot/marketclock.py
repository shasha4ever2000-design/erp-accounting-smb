"""When the US stock market is open. Handles weekends, holidays and daylight saving."""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
OPEN = dt.time(9, 30)
CLOSE = dt.time(16, 0)


def _easter(year: int) -> dt.date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    first = dt.date(year, month, 1)
    return first + dt.timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> dt.date:
    last = dt.date(year + (month == 12), month % 12 + 1, 1) - dt.timedelta(days=1)
    return last - dt.timedelta(days=(last.weekday() - weekday) % 7)


def _observed(day: dt.date) -> dt.date | None:
    if day.weekday() == 5:   # Saturday -> kept on Friday
        return day - dt.timedelta(days=1)
    if day.weekday() == 6:   # Sunday -> kept on Monday
        return day + dt.timedelta(days=1)
    return day


def holidays(year: int) -> set[dt.date]:
    days = {
        _nth_weekday(year, 1, 0, 3),              # Martin Luther King Day
        _nth_weekday(year, 2, 0, 3),              # Presidents Day
        _easter(year) - dt.timedelta(days=2),     # Good Friday
        _last_weekday(year, 5, 0),                # Memorial Day
        _nth_weekday(year, 9, 0, 1),              # Labor Day
        _nth_weekday(year, 11, 3, 4),             # Thanksgiving
        _observed(dt.date(year, 7, 4)),           # Independence Day
        _observed(dt.date(year, 12, 25)),         # Christmas
    }
    if year >= 2022:
        days.add(_observed(dt.date(year, 6, 19)))  # Juneteenth
    new_year = dt.date(year, 1, 1)
    if new_year.weekday() != 5:                    # a Saturday New Year is not made up
        days.add(_observed(new_year))
    return days


def is_market_day(day: dt.date) -> bool:
    return day.weekday() < 5 and day not in holidays(day.year)


def _at(day: dt.date, t: dt.time) -> dt.datetime:
    return dt.datetime.combine(day, t, tzinfo=NEW_YORK).astimezone(dt.UTC)


def market_open_utc(day: dt.date) -> dt.datetime:
    return _at(day, OPEN)


def market_close_utc(day: dt.date) -> dt.datetime:
    return _at(day, CLOSE)


def brief_time_utc(day: dt.date) -> dt.datetime:
    return market_open_utc(day) - dt.timedelta(hours=1)
