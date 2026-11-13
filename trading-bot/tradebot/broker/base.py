"""What the bot needs from a broker. Capital.com and the test stand-in both follow this."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Protocol

from ..models import Bar


class BrokerError(Exception):
    """Something went wrong talking to the broker. The text never contains secrets."""


@dataclass(frozen=True)
class Account:
    equity: float     # what the account is worth right now, open trades included
    balance: float    # cash, without open trades
    available: float
    currency: str
    is_demo: bool


@dataclass(frozen=True)
class Market:
    epic: str
    name: str
    bid: float
    ask: float
    tradeable: bool
    min_size: float
    size_step: float
    currency: str = "USD"
    contract_size: float = 1.0
    day_change: float | None = None           # today's move, 0.015 = +1.5%
    overnight_long_rate: float | None = None  # the broker's own overnight fee figure for a buy
    price_decimals: int = 2                   # how many decimals the broker accepts in a price


@dataclass(frozen=True)
class Position:
    deal_id: str
    epic: str
    size: float
    entry_price: float
    stop_price: float | None
    opened: dt.datetime | None
    pnl: float
    price: float  # what it could be sold for now
    name: str = ""


@dataclass(frozen=True)
class OrderResult:
    ok: bool
    deal_id: str | None = None
    fill_price: float | None = None
    reason: str = ""


class Broker(Protocol):
    def account(self) -> Account: ...
    def market(self, epic: str) -> Market: ...
    def daily_bars(self, epic: str, count: int) -> list[Bar]: ...
    def positions(self) -> list[Position]: ...
    def traded_today(self, day: dt.date) -> set[str]: ...
    def open_long(self, epic: str, size: float, stop_price: float) -> OrderResult: ...
    def close(self, deal_id: str) -> OrderResult: ...
