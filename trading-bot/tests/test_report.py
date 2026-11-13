import datetime as dt

from tradebot.backtest import BacktestResult, Trade
from tradebot.config import Config
from tradebot.models import Instrument
from tradebot.report import render_backtest, verdict

CFG = Config(instruments=(Instrument("AAPL", "Apple", "AAPL", "stock"), Instrument("GOLD", "Gold", "GOLD", "metal")))


def result(end=12_000.0, bh_end=15_000.0, dd=0.10, bh_dd=0.30):
    d = dt.date
    trades = [
        Trade("AAPL", d(2020, 1, 2), 100.0, d(2020, 2, 3), 130.0, 10.0, 300.0, "signal"),
        Trade("GOLD", d(2020, 3, 2), 50.0, d(2020, 3, 9), 45.0, 20.0, -100.0, "stop"),
    ]
    return BacktestResult(
        trades=trades,
        equity_curve=[(d(2020, 1, 1), 10_000.0), (d(2021, 12, 31), end)],
        start_equity=10_000.0, end_equity=end, start_date=d(2020, 1, 1), end_date=d(2021, 12, 31),
        stats={
            "total_return": end / 10_000 - 1, "yearly_return": 0.095, "years": 2.0, "trades": 2, "wins": 1,
            "win_rate": 0.5, "avg_win": 300.0, "avg_loss": -100.0, "win_loss_ratio": 3.0,
            "max_drawdown": dd, "longest_losing_streak": 1, "max_open_trades": 1, "avg_exposure": 0.25,
            "avg_days_held": 19.5, "stop_exits": 1, "overnight_fees": 12.0, "spread_costs": 8.0,
        },
        buy_hold={"total_return": bh_end / 10_000 - 1, "yearly_return": 0.22, "max_drawdown": bh_dd, "end_equity": bh_end},
        by_year={2020: {"strategy": 0.15, "buy_hold": 0.30}, 2021: {"strategy": 0.043, "buy_hold": 0.154}},
        by_symbol={"AAPL": {"trades": 1, "wins": 1, "pnl": 300.0}, "GOLD": {"trades": 1, "wins": 0, "pnl": -100.0}},
        skipped=[],
    )


def test_report_shows_money_in_and_out():
    text = render_backtest(result(), CFG)
    assert "Started with" in text and "$10,000" in text
    assert "Ended with" in text and "$12,000" in text
    assert "+20%" in text


def test_report_compares_with_buy_and_hold():
    text = render_backtest(result(), CFG)
    assert "Buy and hold" in text and "$15,000" in text


def test_report_shows_the_hard_parts():
    text = render_backtest(result(), CFG)
    assert "Worst drop" in text and "-10%" in text
    assert "losing streak" in text


def test_report_has_year_and_instrument_tables_with_names():
    text = render_backtest(result(), CFG)
    assert "2020" in text and "+15.0%" in text
    assert "Apple" in text and "Gold" in text


def test_report_always_carries_the_warnings():
    text = render_backtest(result(), CFG)
    assert "picked today" in text
    assert "do not promise" in text


def test_report_names_skipped_instruments():
    r = result()
    r.skipped = ["GOLD"]
    assert "Not tested" in render_backtest(r, CFG)


def test_verdict_says_plainly_when_buy_and_hold_won():
    v = verdict(result(end=12_000, bh_end=15_000, dd=0.10, bh_dd=0.30))
    assert "less than" in v
    assert "smaller" in v  # but the falls were smaller


def test_verdict_says_plainly_when_strategy_lost_money():
    assert "lost money" in verdict(result(end=9_000, bh_end=15_000))


def test_verdict_when_strategy_beat_buy_and_hold():
    assert "more than" in verdict(result(end=20_000, bh_end=15_000))
