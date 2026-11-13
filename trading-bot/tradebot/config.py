"""Reads config.yaml and checks it."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .models import Instrument, Mode, StrategyParams

MODES = ("signals", "demo", "live")
KINDS = ("stock", "metal")


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class RiskParams:
    risk_per_trade: float = 0.01      # loss if a trade hits its stop, as a share of the account
    max_trade_fraction: float = 0.20  # biggest single trade
    max_total_fraction: float = 1.0   # all open trades together; 1.0 means no borrowing
    max_open_trades: int = 5
    daily_brake: float = 0.03         # down this much in a day -> no new trades


@dataclass(frozen=True)
class Costs:
    # full gap between buy and sell price, as a share of the price
    spread: dict[str, float] = field(default_factory=lambda: {"stock": 0.0015, "metal": 0.0005})
    # yearly overnight fee on the value of an open trade
    overnight_rate: dict[str, float] = field(default_factory=lambda: {"stock": 0.07, "metal": 0.06})


@dataclass(frozen=True)
class Alerts:
    big_move: float = 0.03    # ping when a watchlist item moves this much in a day
    near_level: float = 0.01  # "getting close" when within this of a buy level


@dataclass(frozen=True)
class Config:
    instruments: tuple[Instrument, ...]
    mode: Mode = "signals"
    trading_enabled: bool = True
    strategy: StrategyParams = StrategyParams()
    risk: RiskParams = RiskParams()
    costs: Costs = Costs()
    alerts: Alerts = Alerts()
    check_minutes: int = 5

    def instrument(self, symbol: str) -> Instrument:
        for i in self.instruments:
            if i.symbol == symbol:
                return i
        raise KeyError(symbol)


def _section(cls, raw, name):
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ConfigError(f"'{name}' must be a list of settings")
    try:
        return cls(**raw)
    except TypeError as exc:
        raise ConfigError(f"unknown setting in '{name}': {exc}") from None


def load_config(path: str | Path) -> Config:
    raw = yaml.safe_load(Path(path).read_text()) or {}

    mode = raw.get("mode", "signals")
    if mode not in MODES:
        raise ConfigError(f"mode must be one of {', '.join(MODES)} (got {mode!r})")

    items = raw.get("instruments") or []
    if not items:
        raise ConfigError("instruments: the watchlist is empty")
    instruments = []
    for item in items:
        try:
            inst = Instrument(**item)
        except TypeError as exc:
            raise ConfigError(f"instruments: bad entry {item!r}: {exc}") from None
        if inst.kind not in KINDS:
            raise ConfigError(f"instruments: {inst.symbol} has unknown kind {inst.kind!r}")
        instruments.append(inst)
    if len({i.symbol for i in instruments}) != len(instruments):
        raise ConfigError("instruments: the same symbol is listed twice")

    risk = _section(RiskParams, raw.get("risk"), "risk")
    if not 0 < risk.max_total_fraction <= 1.0:
        raise ConfigError("risk.max_total_fraction must be between 0 and 1 (the bot never borrows)")
    if not 0 < risk.risk_per_trade <= 0.05:
        raise ConfigError("risk.risk_per_trade must be between 0 and 0.05")
    if not 0 < risk.max_trade_fraction <= risk.max_total_fraction:
        raise ConfigError("risk.max_trade_fraction must be between 0 and max_total_fraction")
    if risk.max_open_trades < 1:
        raise ConfigError("risk.max_open_trades must be at least 1")

    return Config(
        instruments=tuple(instruments),
        mode=mode,
        trading_enabled=bool(raw.get("trading_enabled", True)),
        strategy=_section(StrategyParams, raw.get("strategy"), "strategy"),
        risk=risk,
        costs=_section(Costs, raw.get("costs"), "costs"),
        alerts=_section(Alerts, raw.get("alerts"), "alerts"),
        check_minutes=int((raw.get("schedule") or {}).get("check_minutes", 5)),
    )
