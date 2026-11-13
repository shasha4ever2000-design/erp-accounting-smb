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


# ---- running the bot -------------------------------------------------------

import tradebot.cli as cli
from tests.fakebroker import FakeBroker

SECRETS = {"CAPITAL_API_KEY": "k", "CAPITAL_IDENTIFIER": "me@example.com", "CAPITAL_PASSWORD": "p"}


def test_check_names_the_missing_settings_without_running(tmp_path, capsys):
    code = main(["--config", str(ROOT / "config.yaml"), "--data-dir", str(tmp_path), "check"],
                env={"CAPITAL_API_KEY": "k"})
    out = capsys.readouterr().out
    assert code == 2
    assert "CAPITAL_IDENTIFIER" in out and "CAPITAL_PASSWORD" in out and "CAPITAL_API_KEY" not in out


def test_env_file_is_read_but_never_overrides_real_settings(tmp_path):
    f = tmp_path / ".env"
    f.write_text("# comment\nCAPITAL_API_KEY=from-file\nTELEGRAM_CHAT_ID = '42'\n\nbroken line\n")
    env = {"CAPITAL_API_KEY": "already-set"}
    cli.load_env_file(f, env)
    assert env == {"CAPITAL_API_KEY": "already-set", "TELEGRAM_CHAT_ID": "42"}
    cli.load_env_file(tmp_path / "missing.env", env)  # no file is fine


def test_telegram_is_used_only_when_both_values_are_set():
    assert isinstance(cli.make_notifier({"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_CHAT_ID": "1"}, False), cli.TelegramNotifier)
    assert isinstance(cli.make_notifier({"TELEGRAM_BOT_TOKEN": "t"}, False), cli.ConsoleNotifier)
    assert isinstance(cli.make_notifier({"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_CHAT_ID": "1"}, True), cli.ConsoleNotifier)


def test_broker_is_demo_unless_live_is_fully_switched_on(monkeypatch, tmp_path):
    made = []
    monkeypatch.setattr(cli, "CapitalBroker", lambda key, ident, pw, demo: made.append(demo) or FakeBroker(is_demo=demo))
    monkeypatch.setattr(cli, "utc_now", lambda: dt.datetime(2026, 11, 14, 15, 0, tzinfo=dt.UTC))  # Saturday
    live_cfg = tmp_path / "live.yaml"
    live_cfg.write_text("mode: live\ninstruments:\n  - {symbol: AAPL, name: Apple, epic: AAPL, kind: stock}\n")
    args = ["--config", str(live_cfg), "--data-dir", str(tmp_path), "--print", "check"]
    assert main(args, env=dict(SECRETS)) == 0
    assert main(args, env={**SECRETS, "TRADEBOT_CONFIRM_LIVE": "I_UNDERSTAND_REAL_MONEY"}) == 0
    assert made == [True, False]
