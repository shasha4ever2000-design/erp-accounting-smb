"""One full check: brief if due, the day's orders if due, then the live watch.

Called every few minutes by the schedule (GitHub) or the loop (own computer).
Safe to call as often as you like: each step runs at most once when it should.
"""

from __future__ import annotations

import datetime as dt
import traceback

from . import news as news_mod
from .brief import build_brief, tag
from .broker.base import Broker, BrokerError
from .config import Config
from .engine import Decision, market_day, run_daily_decisions
from .journal import Journal
from .marketclock import brief_time_utc, is_market_day, market_close_utc, market_open_utc
from .models import Mode
from .scan import scan
from .state import State
from .watch import run_watch

ORDER_DELAY = dt.timedelta(minutes=2)      # let the market settle after the bell
ORDER_WINDOW = dt.timedelta(minutes=120)   # after this, today's orders are not placed
MAX_NEWS = 6


def _remember_positions(broker: Broker, state: State) -> None:
    state.set_known_positions({p.epic: {"stop": p.stop_price, "name": p.name or p.epic} for p in broker.positions()})


def _send_brief(broker, config, state, notifier, now, mode, news_fetch) -> None:
    day = market_day(now)
    account = broker.account()
    state.start_day(day, account.equity)
    positions = broker.positions()
    rows = scan(broker, config, positions, now.astimezone(dt.UTC).date())
    stories: dict[str, list[str]] = {}
    for r in [r for r in rows if r.held or r.signal.action in ("buy", "sell")][:MAX_NEWS]:
        query = f"{r.inst.name} stock" if r.inst.kind == "stock" else f"{r.inst.name} price"
        found = news_mod.headlines(query, fetch=news_fetch) if news_fetch else news_mod.headlines(query)
        if found:
            stories[r.inst.symbol] = found
    notifier.send(build_brief(mode, day, account, rows, stories, config))
    state.mark_brief_sent(day)


def describe_decisions(decisions: list[Decision], config: Config, mode: Mode) -> str | None:
    names = {i.symbol: i.name for i in config.instruments}
    lines = []
    for d in decisions:
        name = names.get(d.symbol, d.symbol)
        if mode == "signals":
            if d.action == "buy" and d.plan:
                lines.append(f"  BUY signal {name}: would buy {d.plan.size:.4g} at about {d.plan.entry_price:g} "
                             f"with a stop-loss at {d.plan.stop_price:g}. Why: {d.reason}")
            elif d.action == "sell":
                lines.append(f"  SELL signal {name}: {d.reason}")
            elif d.action == "skip":
                lines.append(f"  No trade in {name}: {d.reason}")
        elif d.action == "buy" and d.result:
            price = d.result.fill_price or d.plan.entry_price
            lines.append(f"  BOUGHT {name}: {d.plan.size:.4g} at {price:g}, stop-loss {d.plan.stop_price:g}. Why: {d.reason}")
        elif d.action == "sell" and d.result:
            where = f" at {d.result.fill_price:g}" if d.result.fill_price else ""
            lines.append(f"  SOLD {name}{where}. Why: {d.reason}")
        elif d.action == "skip":
            lines.append(f"  SKIPPED {name}: {d.reason}")
        elif d.action == "failed":
            lines.append(f"  COULD NOT TRADE {name}: {d.reason}")
    if not lines:
        return None
    title = "Signals for today (no orders placed)" if mode == "signals" else "Orders at the open"
    return "\n".join([f"{tag(mode)} {title}"] + lines)


def run_check(broker: Broker, config: Config, state: State, journal: Journal, notifier, now: dt.datetime,
              mode: Mode, news_fetch=None, mode_note: str | None = None) -> int:
    day = market_day(now)
    if not is_market_day(day):
        return 0
    open_at, close_at = market_open_utc(day), market_close_utc(day)
    if now < brief_time_utc(day) or now > close_at:
        return 0

    try:
        if mode_note and state.mark_alert(day, "mode-note"):
            notifier.send(f"{tag(mode)} Note: {mode_note}.")

        if not state.brief_sent(day):
            _send_brief(broker, config, state, notifier, now, mode, news_fetch)

        if open_at + ORDER_DELAY <= now <= open_at + ORDER_WINDOW and not state.decisions_done(day):
            decisions = run_daily_decisions(broker, config, state, journal, now, mode)
            report = describe_decisions(decisions, config, mode)
            if report and state.mark_alert(day, "orders:" + report):
                notifier.send(report)
            _remember_positions(broker, state)

        if now >= open_at:
            alerts = run_watch(broker, config, state, now)
            if alerts:
                notifier.send(f"{tag(mode)} " + "\n\n".join(a.text for a in alerts))

        state.save()
        return 0
    except Exception as exc:
        if isinstance(exc, BrokerError):
            what = str(exc)
        else:
            where = traceback.extract_tb(exc.__traceback__)[-1]
            what = f"unexpected problem ({type(exc).__name__} in {where.name})"
        if state.mark_alert(day, "error:" + what):
            notifier.send(f"{tag(mode)} Something went wrong: {what}. The bot will try again at the next check. "
                          "Stop-losses at Capital.com keep working in the meantime.")
        state.save()
        return 1


def run_doctor(broker: Broker, config: Config, now: dt.datetime, out=print) -> int:
    """Checks the connection and every watchlist instrument. Returns 1 if anything needs attention."""
    problems = 0
    account = broker.account()
    kind = "DEMO" if account.is_demo else "LIVE (real money)"
    out(f"Connected to the {kind} account.")
    out(f"  Worth {account.equity:,.2f} {account.currency}  (cash {account.balance:,.2f}, free to use {account.available:,.2f})")
    positions = broker.positions()
    out(f"  Open buy trades: {len(positions)}")
    out("")
    need = config.strategy.trend_days + 1
    today = now.astimezone(dt.UTC).date()
    for inst in config.instruments:
        try:
            m = broker.market(inst.epic)
            bars = [b for b in broker.daily_bars(inst.epic, need + 60) if b.date < today]
        except Exception:
            out(f"  {inst.name} ({inst.epic}): NOT FOUND at Capital.com. Fix the 'epic' in config.yaml.")
            problems += 1
            continue
        notes = []
        if m.currency != account.currency:
            notes.append(f"priced in {m.currency} but the account is in {account.currency}: the bot will not trade it")
        if m.contract_size != 1:
            notes.append(f"unusual contract size {m.contract_size:g}: the bot will not trade it")
        if len(bars) < need:
            notes.append(f"only {len(bars)} days of history, needs {need}")
        problems += bool(notes)
        fee = f"{m.overnight_long_rate:g}" if m.overnight_long_rate is not None else "not given"
        last = bars[-1].date.isoformat() if bars else "none"
        out(f"  {inst.name} ({inst.epic}): price {m.bid:g}, {'open' if m.tradeable else 'closed'} now, "
            f"smallest trade {m.min_size:g}, overnight fee figure {fee}, "
            f"{len(bars)} days of history, last finished day {last}"
            + ("".join(f"\n      ! {n}" for n in notes)))
    out("")
    out("Everything looks fine." if not problems else f"{problems} thing(s) need attention, marked above.")
    return 1 if problems else 0
