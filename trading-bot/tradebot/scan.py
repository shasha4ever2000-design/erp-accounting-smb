"""One pass over the watchlist: where each instrument stands. Used by the brief and the watch."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from .broker.base import Broker, Position
from .config import Config
from .engine import bars_needed, completed_bars
from .models import Instrument, Signal
from .strategy import evaluate, next_levels


@dataclass(frozen=True)
class Row:
    inst: Instrument
    signal: Signal                 # judgement of the latest finished day
    held: Position | None
    last_close: float | None
    prev_close: float | None
    buy_level: float | None = None   # for the next close
    sell_level: float | None = None
    trend_avg: float | None = None

    @property
    def last_move(self) -> float | None:
        if self.last_close and self.prev_close:
            return self.last_close / self.prev_close - 1
        return None


def scan(broker: Broker, config: Config, positions: list[Position], utc_today: dt.date) -> list[Row]:
    held = {p.epic: p for p in positions}
    rows = []
    for inst in config.instruments:
        bars = completed_bars(broker.daily_bars(inst.epic, bars_needed(config)), utc_today)
        pos = held.get(inst.epic)
        buy, sell, trend = next_levels(bars, config.strategy)
        rows.append(Row(
            inst=inst,
            signal=evaluate(bars, config.strategy, pos is not None),
            held=pos,
            last_close=bars[-1].close if bars else None,
            prev_close=bars[-2].close if len(bars) > 1 else None,
            buy_level=buy, sell_level=sell, trend_avg=trend,
        ))
    return rows
