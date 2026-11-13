import datetime as dt

from tradebot.history import load_history


def test_load_sorts_and_drops_bad_rows(tmp_path):
    (tmp_path / "AAPL.csv").write_text(
        "date,open,high,low,close\n"
        "2024-01-03,10.5,11,10,10.8\n"
        "2024-01-02,10,10.6,9.9,10.5\n"
        "2024-01-04,,11,10,10.8\n"        # missing open
        "2024-01-05,10,11,0,10.8\n"       # zero low
        "not-a-date,1,1,1,1\n"
        "2024-01-08,10,9,10,10\n"         # high below low
    )
    bars = load_history(tmp_path)["AAPL"]
    assert [b.date for b in bars] == [dt.date(2024, 1, 2), dt.date(2024, 1, 3)]
    assert bars[0].close == 10.5


def test_load_dedupes_dates(tmp_path):
    (tmp_path / "GOLD.csv").write_text(
        "date,open,high,low,close\n"
        "2024-01-02,1,2,1,2\n"
        "2024-01-02,1,2,1,1.5\n"
    )
    bars = load_history(tmp_path)["GOLD"]
    assert len(bars) == 1
    assert bars[0].close == 1.5  # the later row wins


def test_load_ignores_other_files_and_empty_dir(tmp_path):
    (tmp_path / "notes.txt").write_text("hello")
    assert load_history(tmp_path) == {}
