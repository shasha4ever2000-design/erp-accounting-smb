"""The bot's small memory between runs: what was already done and sent today."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path


class State:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        try:
            data = json.loads(self.path.read_text())
            self._d = data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            self._d = {}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._d, indent=2, sort_keys=True) + "\n")

    def _is_today(self, day: dt.date) -> bool:
        return self._d.get("day") == day.isoformat()

    def start_day(self, day: dt.date, equity: float) -> None:
        """Remember what the account was worth when the day began. First call of the day wins."""
        if self._is_today(day):
            return
        self._d.update({
            "day": day.isoformat(), "day_start_equity": equity,
            "decisions_done": False,
        })

    def day_start_equity(self, day: dt.date) -> float | None:
        return self._d.get("day_start_equity") if self._is_today(day) else None

    def decisions_done(self, day: dt.date) -> bool:
        return self._is_today(day) and bool(self._d.get("decisions_done"))

    def mark_decisions_done(self, day: dt.date) -> None:
        if self._is_today(day):
            self._d["decisions_done"] = True

    def brief_sent(self, day: dt.date) -> bool:
        return self._d.get("brief_day") == day.isoformat()

    def mark_brief_sent(self, day: dt.date) -> None:
        self._d["brief_day"] = day.isoformat()

    def mark_alert(self, day: dt.date, key: str) -> bool:
        """True the first time a given alert is seen on a day, False after that."""
        if self._d.get("alert_day") != day.isoformat():
            self._d["alert_day"] = day.isoformat()
            self._d["alerts"] = []
        alerts = self._d.setdefault("alerts", [])
        if key in alerts:
            return False
        alerts.append(key)
        return True

    def known_positions(self) -> dict:
        return dict(self._d.get("positions") or {})

    def set_known_positions(self, positions: dict) -> None:
        self._d["positions"] = positions
