"""Capital.com REST connection.

Docs: https://open-api.capital.com/
Logs in when first needed, and once more if the session has expired
(sessions end after 10 minutes without use).
"""

from __future__ import annotations

import datetime as dt
import time

import requests

from ..models import Bar
from .base import Account, BrokerError, Market, OrderResult, Position

LIVE_URL = "https://api-capital.backend-capital.com"
DEMO_URL = "https://demo-api-capital.backend-capital.com"
TIMEOUT = 30


def _mid(price: dict) -> float:
    return (float(price["bid"]) + float(price["ask"])) / 2


def _parse_utc(text: str | None) -> dt.datetime | None:
    if not text:
        return None
    try:
        return dt.datetime.fromisoformat(text).replace(tzinfo=dt.UTC)
    except ValueError:
        return None


class CapitalBroker:
    def __init__(self, api_key: str, identifier: str, password: str, demo: bool = True,
                 session=None, sleep=time.sleep):
        self._api_key = api_key
        self._identifier = identifier
        self._password = password
        self.demo = demo
        self._base = DEMO_URL if demo else LIVE_URL
        self._http = session or requests.Session()
        self._sleep = sleep
        self._tokens: dict[str, str] = {}
        self._currency = "USD"

    def __repr__(self) -> str:
        return f"CapitalBroker({'demo' if self.demo else 'live'})"

    # ---- plumbing ---------------------------------------------------------

    def _clean(self, text: str) -> str:
        for secret in (self._password, self._api_key, self._identifier):
            if secret:
                text = text.replace(secret, "***")
        return text[:300]

    def _error_code(self, resp) -> str:
        try:
            body = resp.json()
            code = body.get("errorCode") if isinstance(body, dict) else None
        except Exception:
            code = None
        return self._clean(str(code or f"HTTP {resp.status_code}"))

    def _login(self) -> None:
        try:
            resp = self._http.request(
                "POST", f"{self._base}/api/v1/session",
                headers={"X-CAP-API-KEY": self._api_key, "Content-Type": "application/json"},
                json={"identifier": self._identifier, "password": self._password, "encryptedPassword": False},
                params=None, timeout=TIMEOUT,
            )
        except requests.RequestException as exc:
            raise BrokerError(f"could not reach Capital.com to log in ({type(exc).__name__})") from None
        if resp.status_code != 200:
            raise BrokerError(
                f"Capital.com refused the login ({self._error_code(resp)}). "
                "Check the API key, the email and the API key password."
            )
        cst, sec = resp.headers.get("CST"), resp.headers.get("X-SECURITY-TOKEN")
        if not cst or not sec:
            raise BrokerError("Capital.com login answered without session tokens")
        self._tokens = {"CST": cst, "X-SECURITY-TOKEN": sec}
        try:
            self._currency = resp.json().get("currencyIsoCode") or self._currency
        except Exception:
            pass

    def _call(self, method: str, path: str, json=None, params=None):
        """One request with the session tokens. Logs in again once if the session expired."""
        for attempt in (1, 2):
            if not self._tokens:
                self._login()
            try:
                resp = self._http.request(
                    method, f"{self._base}{path}",
                    headers={**self._tokens, "Content-Type": "application/json"},
                    json=json, params=params, timeout=TIMEOUT,
                )
            except requests.RequestException as exc:
                raise BrokerError(f"could not reach Capital.com ({type(exc).__name__})") from None
            if resp.status_code == 401 and attempt == 1:
                self._tokens = {}
                continue
            return resp
        return resp

    def _get(self, path: str, params=None) -> dict:
        resp = self._call("GET", path, params=params)
        if resp.status_code != 200:
            raise BrokerError(f"Capital.com answered {self._error_code(resp)} for {path}")
        return resp.json()

    # ---- reading ----------------------------------------------------------

    def ping(self) -> None:
        self._get("/api/v1/ping")

    def account(self) -> Account:
        accounts = self._get("/api/v1/accounts").get("accounts") or []
        if not accounts:
            raise BrokerError("Capital.com returned no trading account")
        acc = next((a for a in accounts if a.get("preferred")), accounts[0])
        bal = acc.get("balance") or {}
        return Account(
            equity=float(bal.get("balance", 0.0)),
            balance=float(bal.get("deposit", 0.0)),
            available=float(bal.get("available", 0.0)),
            currency=acc.get("currency") or self._currency,
            is_demo=self.demo,
        )

    def market(self, epic: str) -> Market:
        data = self._get(f"/api/v1/markets/{epic}")
        inst, rules, snap = data.get("instrument") or {}, data.get("dealingRules") or {}, data.get("snapshot") or {}
        change = snap.get("percentageChange")
        fee = (inst.get("overnightFee") or {}).get("longRate")
        return Market(
            epic=inst.get("epic", epic),
            name=inst.get("name", epic),
            bid=float(snap.get("bid") or 0.0),
            ask=float(snap.get("offer") or 0.0),
            tradeable=snap.get("marketStatus") == "TRADEABLE",
            min_size=float((rules.get("minDealSize") or {}).get("value") or 0.0),
            size_step=float((rules.get("minSizeIncrement") or {}).get("value") or 0.0),
            currency=inst.get("currency") or "USD",
            contract_size=float(inst.get("lotSize") or 1.0),
            day_change=float(change) / 100 if change is not None else None,
            overnight_long_rate=float(fee) if fee is not None else None,
            price_decimals=int(snap.get("decimalPlacesFactor") or 2),
        )

    def daily_bars(self, epic: str, count: int) -> list[Bar]:
        data = self._get(f"/api/v1/prices/{epic}", params={"resolution": "DAY", "max": count})
        bars = []
        for p in data.get("prices") or []:
            try:
                day = dt.date.fromisoformat(str(p.get("snapshotTimeUTC") or p.get("snapshotTime"))[:10])
                bars.append(Bar(day, _mid(p["openPrice"]), _mid(p["highPrice"]), _mid(p["lowPrice"]), _mid(p["closePrice"])))
            except (KeyError, TypeError, ValueError):
                continue
        bars.sort(key=lambda b: b.date)
        return bars

    def positions(self) -> list[Position]:
        out = []
        for item in self._get("/api/v1/positions").get("positions") or []:
            pos, mkt = item.get("position") or {}, item.get("market") or {}
            if pos.get("direction") != "BUY":
                continue  # the bot only buys; anything else was opened by hand
            stop = pos.get("stopLevel")
            out.append(Position(
                deal_id=str(pos.get("dealId")),
                epic=mkt.get("epic", ""),
                size=float(pos.get("size") or 0.0),
                entry_price=float(pos.get("level") or 0.0),
                stop_price=float(stop) if stop else None,
                opened=_parse_utc(pos.get("createdDateUTC")),
                pnl=float(pos.get("upl") or 0.0),
                price=float(mkt.get("bid") or 0.0),
                name=mkt.get("instrumentName", ""),
            ))
        return out

    def traded_today(self, day: dt.date) -> set[str]:
        """Instruments that had a trade opened or closed on `day` (UTC)."""
        data = self._get("/api/v1/history/activity", params={"lastPeriod": 86400})
        out = set()
        for act in data.get("activities") or []:
            when = _parse_utc(act.get("dateUTC"))
            if act.get("type") == "POSITION" and act.get("status") == "ACCEPTED" and when and when.date() == day:
                out.add(act.get("epic"))
        return out

    # ---- orders -----------------------------------------------------------

    def _confirm(self, resp) -> OrderResult:
        if resp.status_code != 200:
            return OrderResult(False, reason=f"Capital.com refused the order ({self._error_code(resp)})")
        ref = (resp.json() or {}).get("dealReference")
        if not ref:
            return OrderResult(False, reason="Capital.com gave no order reference")
        for _ in range(3):
            check = self._call("GET", f"/api/v1/confirms/{ref}")
            if check.status_code == 200:
                body = check.json() or {}
                if body.get("dealStatus") == "ACCEPTED":
                    deals = body.get("affectedDeals") or []
                    deal_id = deals[0].get("dealId") if deals else body.get("dealId")
                    level = body.get("level")
                    return OrderResult(True, str(deal_id) if deal_id else None, float(level) if level else None, "accepted")
                why = body.get("rejectReason") or body.get("reason") or body.get("dealStatus") or "no reason given"
                return OrderResult(False, reason=f"Capital.com rejected the order ({self._clean(str(why))})")
            self._sleep(1)
        return OrderResult(False, reason="could not confirm the order with Capital.com; check the app before doing anything else")

    def open_long(self, epic: str, size: float, stop_price: float) -> OrderResult:
        if not stop_price or stop_price <= 0:
            raise ValueError("a trade is never opened without a stop-loss")
        if size <= 0:
            raise ValueError("trade size must be above zero")
        resp = self._call("POST", "/api/v1/positions", json={
            "epic": epic, "direction": "BUY", "size": size, "stopLevel": stop_price, "guaranteedStop": False,
        })
        return self._confirm(resp)

    def close(self, deal_id: str) -> OrderResult:
        return self._confirm(self._call("DELETE", f"/api/v1/positions/{deal_id}"))
