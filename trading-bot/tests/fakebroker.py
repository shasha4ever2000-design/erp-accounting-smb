"""An in-memory broker for tests. Follows tradebot.broker.base.Broker."""

import datetime as dt

from tradebot.broker.base import Account, Market, OrderResult, Position


class FakeBroker:
    def __init__(self, equity=10_000.0, is_demo=True, currency="USD"):
        self._account = Account(equity=equity, balance=equity, available=equity, currency=currency, is_demo=is_demo)
        self.markets: dict[str, Market] = {}
        self.bars: dict[str, list] = {}
        self._positions: list[Position] = []
        self.traded: set[str] = set()
        self.opened: list[tuple] = []   # (epic, size, stop_price)
        self.closed: list[str] = []
        self.reject_with: str | None = None
        self.fail_reading: Exception | None = None
        self._next_id = 1

    # setup helpers
    def add_market(self, epic, bid, ask, tradeable=True, min_size=0.0, size_step=0.0, bars=(), **kw):
        self.markets[epic] = Market(epic, epic, bid, ask, tradeable, min_size, size_step, **kw)
        self.bars[epic] = list(bars)

    def hold(self, epic, size, entry_price, stop_price, price=None, pnl=0.0, deal_id=None):
        deal_id = deal_id or f"D{self._next_id}"
        self._next_id += 1
        self._positions.append(Position(deal_id, epic, size, entry_price, stop_price,
                                        dt.datetime(2026, 1, 1, tzinfo=dt.UTC), pnl, price or entry_price, epic))
        return deal_id

    def drop(self, epic):
        self._positions = [p for p in self._positions if p.epic != epic]

    # Broker interface
    def account(self):
        if self.fail_reading:
            raise self.fail_reading
        return self._account

    def market(self, epic):
        return self.markets[epic]

    def daily_bars(self, epic, count):
        return self.bars[epic][-count:]

    def positions(self):
        return list(self._positions)

    def traded_today(self, day):
        return set(self.traded)

    def open_long(self, epic, size, stop_price):
        if not stop_price or stop_price <= 0:
            raise ValueError("a trade is never opened without a stop-loss")
        self.opened.append((epic, size, stop_price))
        if self.reject_with:
            return OrderResult(False, reason=self.reject_with)
        deal_id = self.hold(epic, size, self.markets[epic].ask, stop_price)
        self.traded.add(epic)
        return OrderResult(True, deal_id, self.markets[epic].ask, "accepted")

    def close(self, deal_id):
        self.closed.append(deal_id)
        if self.reject_with:
            return OrderResult(False, reason=self.reject_with)
        pos = next(p for p in self._positions if p.deal_id == deal_id)
        self._positions.remove(pos)
        self.traded.add(pos.epic)
        return OrderResult(True, deal_id, self.markets[pos.epic].bid, "accepted")
