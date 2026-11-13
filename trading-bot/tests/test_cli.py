import datetime as dt
from pathlib import Path

from tradebot.cli import main

ROOT = Path(__file__).parent.parent


def write_history(directory, symbol, n=260):
    rows = ["date,open,high,low,close"]
    price = 100.0
    for i in range(n):
        price *= 1.004 if i % 7 else 0.985
        d = dt.date(2020, 1, 1) + dt.timedelta(days=i)
        rows.append(f"{d},{price:.4f},{price * 1.01:.4f},{price * 0.99:.4f},{price:.4f}")
    (directory / f"{symbol}.csv").write_text("\n".join(rows) + "\n")


def test_backtest_command_prints_the_report(tmp_path, capsys):
    write_history(tmp_path, "AAPL")
    code = main(["backtest", "--config", str(ROOT / "config.yaml"), "--history", str(tmp_path)])
    out = capsys.readouterr().out
    assert code == 0
    assert "TEST ON PAST PRICES" in out
    assert "Not tested" in out  # the other 13 have no files here


def test_backtest_command_explains_missing_history(tmp_path, capsys):
    code = main(["backtest", "--config", str(ROOT / "config.yaml"), "--history", str(tmp_path)])
    out = capsys.readouterr().out
    assert code == 1
    assert "fetch_history" in out
