from pathlib import Path

import pytest

from tradebot.config import ConfigError, load_config

ROOT = Path(__file__).parent.parent


def write(tmp_path, text):
    p = tmp_path / "config.yaml"
    p.write_text(text)
    return p


MINIMAL = """
instruments:
  - {symbol: AAPL, name: Apple, epic: AAPL, kind: stock}
"""


def test_default_mode_is_signals(tmp_path):
    cfg = load_config(write(tmp_path, MINIMAL))
    assert cfg.mode == "signals"
    assert cfg.trading_enabled is True


def test_defaults_match_the_design(tmp_path):
    cfg = load_config(write(tmp_path, MINIMAL))
    s, r = cfg.strategy, cfg.risk
    assert (s.trend_days, s.entry_days, s.exit_days, s.atr_days, s.stop_atr) == (200, 20, 10, 20, 2.0)
    assert (r.risk_per_trade, r.max_trade_fraction, r.max_total_fraction) == (0.01, 0.20, 1.0)
    assert (r.max_open_trades, r.daily_brake) == (5, 0.03)


def test_unknown_mode_rejected(tmp_path):
    with pytest.raises(ConfigError, match="mode"):
        load_config(write(tmp_path, "mode: yolo\n" + MINIMAL))


def test_unknown_instrument_kind_rejected(tmp_path):
    bad = "instruments:\n  - {symbol: X, name: X, epic: X, kind: crypto}\n"
    with pytest.raises(ConfigError, match="kind"):
        load_config(write(tmp_path, bad))


def test_empty_watchlist_rejected(tmp_path):
    with pytest.raises(ConfigError, match="instruments"):
        load_config(write(tmp_path, "mode: signals\n"))


def test_borrowing_cannot_be_switched_on(tmp_path):
    with pytest.raises(ConfigError, match="max_total_fraction"):
        load_config(write(tmp_path, MINIMAL + "risk: {max_total_fraction: 3.0}\n"))


def test_shipped_config_loads_with_14_instruments():
    cfg = load_config(ROOT / "config.yaml")
    assert cfg.mode == "signals"
    assert len(cfg.instruments) == 14
    assert {i.symbol for i in cfg.instruments if i.kind == "metal"} == {"GOLD", "SILVER"}
