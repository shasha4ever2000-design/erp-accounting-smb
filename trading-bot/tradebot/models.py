"""Plain data shapes shared across the bot."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Literal

Kind = Literal["stock", "metal"]
Mode = Literal["signals", "demo", "live"]


@dataclass(frozen=True)
class Bar:
    """One day of prices."""

    date: dt.date
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    epic: str  # the instrument's code at Capital.com
    kind: Kind


@dataclass(frozen=True)
class StrategyParams:
    trend_days: int = 200
    entry_days: int = 20
    exit_days: int = 10
    atr_days: int = 20
    stop_atr: float = 2.0


@dataclass(frozen=True)
class Signal:
    action: Literal["buy", "sell", "hold", "none"]
    reason: str
    entry_level: float | None = None
    exit_level: float | None = None
    atr: float | None = None
    trend_avg: float | None = None
    close: float | None = None
