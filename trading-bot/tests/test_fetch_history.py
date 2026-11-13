import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "fetch_history", Path(__file__).parent.parent / "tools" / "fetch_history.py"
)
fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fh)


def test_parse_stooq_csv_reads_rows_oldest_first():
    text = (
        "Date,Open,High,Low,Close,Volume\n"
        "2024-01-03,10.5,11,10,10.8,100\n"
        "2024-01-02,10,10.6,9.9,10.5,90\n"
    )
    rows = fh.parse_stooq_csv(text)
    assert rows == [
        ("2024-01-02", 10.0, 10.6, 9.9, 10.5),
        ("2024-01-03", 10.5, 11.0, 10.0, 10.8),
    ]


def test_parse_stooq_csv_returns_empty_for_a_refusal_page():
    assert fh.parse_stooq_csv("Get your apikey: https://stooq.com/...") == []
    assert fh.parse_stooq_csv("No data") == []


def test_parse_yahoo_chart_skips_days_with_missing_prices():
    payload = {
        "chart": {
            "result": [
                {
                    "meta": {"gmtoffset": -18000},
                    "timestamp": [1704205800, 1704292200],  # 2024-01-02, 2024-01-03 14:30 UTC
                    "indicators": {
                        "quote": [
                            {
                                "open": [10.0, None],
                                "high": [10.6, 11.0],
                                "low": [9.9, 10.0],
                                "close": [10.5, 10.8],
                            }
                        ]
                    },
                }
            ]
        }
    }
    assert fh.parse_yahoo_chart(payload) == [("2024-01-02", 10.0, 10.6, 9.9, 10.5)]


def test_parse_yahoo_chart_returns_empty_when_no_result():
    assert fh.parse_yahoo_chart({"chart": {"result": None, "error": {"code": "x"}}}) == []


def test_filter_start_drops_older_rows():
    rows = [("2013-12-31", 1, 1, 1, 1), ("2014-01-02", 2, 2, 2, 2)]
    assert fh.filter_start(rows, "2014-01-01") == [("2014-01-02", 2, 2, 2, 2)]
