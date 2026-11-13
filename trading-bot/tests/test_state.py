import datetime as dt

from tradebot.state import State

D = dt.date(2026, 11, 13)


def test_state_survives_a_restart(tmp_path):
    s = State(tmp_path / "state.json")
    s.start_day(D, 10_000.0)
    s.mark_decisions_done(D)
    s.mark_brief_sent(D)
    assert s.mark_alert(D, "stop:AAPL") is True
    s.save()
    again = State(tmp_path / "state.json")
    assert again.day_start_equity(D) == 10_000.0
    assert again.decisions_done(D) and again.brief_sent(D)
    assert again.mark_alert(D, "stop:AAPL") is False   # already sent


def test_start_day_keeps_the_first_value_of_the_day(tmp_path):
    s = State(tmp_path / "state.json")
    s.start_day(D, 10_000.0)
    s.start_day(D, 9_000.0)
    assert s.day_start_equity(D) == 10_000.0


def test_new_day_forgets_yesterdays_alerts_and_flags(tmp_path):
    s = State(tmp_path / "state.json")
    s.start_day(D, 10_000.0)
    s.mark_alert(D, "move:AAPL")
    s.mark_decisions_done(D)
    tomorrow = D + dt.timedelta(days=1)
    s.start_day(tomorrow, 10_100.0)
    assert s.mark_alert(tomorrow, "move:AAPL") is True
    assert not s.decisions_done(tomorrow)
    assert s.day_start_equity(tomorrow) == 10_100.0


def test_broken_state_file_starts_fresh(tmp_path):
    p = tmp_path / "state.json"
    p.write_text("{not json")
    assert State(p).day_start_equity(D) is None


def test_remembers_open_trades_between_runs(tmp_path):
    s = State(tmp_path / "state.json")
    s.set_known_positions({"AAPL": {"size": 5, "stop": 180.0}})
    s.save()
    assert State(tmp_path / "state.json").known_positions() == {"AAPL": {"size": 5, "stop": 180.0}}
