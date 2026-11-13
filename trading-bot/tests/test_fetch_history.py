import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "fetch_history", Path(__file__).parent.parent / "tools" / "fetch_history.py"
)
fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fh)


def test_parse_tiingo_uses_adjusted_prices_and_sorts():
    payload = [
        {"date": "2024-01-03T00:00:00.000Z", "open": 400, "high": 420, "low": 390, "close": 410,
         "adjOpen": 100.0, "adjHigh": 105.0, "adjLow": 97.5, "adjClose": 102.5},
        {"date": "2024-01-02T00:00:00.000Z", "open": 396, "high": 404, "low": 392, "close": 400,
         "adjOpen": 99.0, "adjHigh": 101.0, "adjLow": 98.0, "adjClose": 100.0},
    ]
    assert fh.parse_tiingo(payload) == [
        ("2024-01-02", 99.0, 101.0, 98.0, 100.0),
        ("2024-01-03", 100.0, 105.0, 97.5, 102.5),
    ]


def test_parse_tiingo_skips_broken_records_and_error_payloads():
    assert fh.parse_tiingo([{"date": "2024-01-02T00:00:00.000Z", "adjOpen": None}]) == []
    assert fh.parse_tiingo({"detail": "Invalid token."}) == []


def test_metals_use_etf_stand_ins():
    assert fh.TICKERS["GOLD"] == "GLD"
    assert fh.TICKERS["SILVER"] == "SLV"
    assert fh.TICKERS["AAPL"] == "AAPL"


def test_write_csv_round_trips_through_the_loader(tmp_path):
    from tradebot.history import load_history

    fh.write_csv(tmp_path / "AAPL.csv", [("2024-01-02", 99.0, 101.0, 98.0, 100.0)])
    bar = load_history(tmp_path)["AAPL"][0]
    assert (bar.date.isoformat(), bar.open, bar.high, bar.low, bar.close) == ("2024-01-02", 99.0, 101.0, 98.0, 100.0)
