# Trading Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal trading assistant for Capital.com (US stocks, gold, silver) that sends a morning brief, watches prices during the day, and places orders by fixed rules, starting on the demo account.

**Architecture:** One Python package, `tradebot`. Pure functions for the strategy and risk rules are shared by the backtest and the live engine, so what is tested on past prices is what trades. Capital.com sits behind a small `Broker` interface with a fake for tests. Two entry points: one check then exit (GitHub schedule), or a loop (own computer).

**Tech Stack:** Python 3.11+, `requests`, `PyYAML`, `pytest`. No pandas. Telegram Bot API for messages.

**Spec:** `trading-bot/docs/superpowers/specs/2026-11-13-trading-bot-design.md`

## Global Constraints

- Everything lives under `trading-bot/`. No file outside it is touched, except one temporary workflow file under `.github/workflows/` on the side branch for fetching price history.
- Strategy numbers come from `config.yaml`: trend average 200, entry high 20, exit low 10, ATR window 20, stop 2 × ATR.
- Safety values: risk per trade 1%, biggest trade 20% of account, total open trades ≤ account size, 5 open trades at most, daily brake 3%, one trade per instrument, no stop → no trade.
- Modes: `signals` (default), `demo`, `live`. `live` needs `mode: live` in config **and** env `TRADEBOT_CONFIRM_LIVE=I_UNDERSTAND_REAL_MONEY`.
- Every outgoing message starts with `[SIGNALS]`, `[DEMO]` or `[LIVE]`.
- Secrets only from environment: `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER`, `CAPITAL_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Never logged, never written to files.
- Buying only. No short selling.
- All user-facing text is plain language, each action with a one-line reason.
- Money maths rounds trade size **down**, never up.

## Review Focus

1. Fewer than 200 days of history, or gaps in it → no signal for that instrument, reported, no crash. (Task 1)
2. The broker's price list includes today's unfinished day → it must be left out of decisions. (Task 6)
3. The broker rejects an order, or the confirmation says REJECTED → journal entry and an alert, nothing assumed open, no retry loop. (Task 6)
4. Smallest allowed trade size or rounding would push the loss above 1% → trade skipped with the reason. (Task 2)
5. Weekend, holiday, or market shown as closed → no orders, no brief, no alert spam. (Tasks 7, 8)

---

## File map

```
trading-bot/
  pyproject.toml  config.yaml  .env.example  .gitignore  README.md
  tradebot/
    models.py       Bar, Instrument, Position, Signal, TradePlan
    config.py       load_config(path) -> Config
    indicators.py   sma, highest, lowest, atr
    strategy.py     evaluate(bars, params, holding) -> Signal
    risk.py         plan_trade(...) -> TradePlan | Skip ; brake_on(...)
    history.py      load_history(dir) -> dict[str, list[Bar]]
    backtest.py     run_backtest(history, config) -> BacktestResult
    report.py       render_backtest(result) -> str
    broker/base.py  Broker protocol     broker/fake.py  FakeBroker
    broker/capital.py  CapitalBroker (REST)
    engine.py       run_daily_decisions(...)
    marketclock.py  is_market_day, market_open_utc, brief_time_utc
    news.py         headlines(symbol) -> list[str]   (never raises)
    brief.py        build_brief(...) -> str
    watch.py        run_watch(...) -> list[Alert]
    state.py        State load/save (JSON)
    journal.py      append(row)  (CSV)
    notify.py       TelegramNotifier, ConsoleNotifier
    cli.py          backtest | brief | check | loop | doctor
  tools/fetch_history.py
  data/history/<SYMBOL>.csv
  deploy/github-workflow.yml   (template for the bot's own repository)
  tests/
```

---

### Task 1: Skeleton, settings, indicators, strategy signals

**Files:** `pyproject.toml`, `config.yaml`, `.gitignore`, `tradebot/{__init__,models,config,indicators,strategy}.py`, `tests/test_indicators.py`, `tests/test_strategy.py`, `tests/test_config.py`

**Produces:**
- `Bar(date: date, open: float, high: float, low: float, close: float)`
- `Instrument(symbol: str, name: str, epic: str, kind: Literal["stock","metal"])`
- `StrategyParams(trend_days=200, entry_days=20, exit_days=10, atr_days=20, stop_atr=2.0)`
- `Signal(action: Literal["buy","sell","hold","none"], reason: str, entry_level: float|None, exit_level: float|None, atr: float|None, trend_avg: float|None, close: float|None)`
- `sma(values, n) -> float|None`, `highest(values, n) -> float|None`, `lowest(values, n) -> float|None`, `atr(bars, n) -> float|None` (simple mean of true range over the last `n` bars)
- `evaluate(bars: list[Bar], p: StrategyParams, holding: bool) -> Signal` — looks only at completed bars passed in; last bar is "today's close".
- `load_config(path) -> Config` with `.mode`, `.trading_enabled`, `.instruments`, `.strategy`, `.risk`, `.costs`, `.alerts`.

- [ ] Tests first:
  - `test_sma_needs_full_window` → `sma([1,2,3], 4) is None`; `sma([1,2,3,4], 4) == 2.5`
  - `test_atr_uses_gaps` → true range uses previous close.
  - `test_buy_when_close_above_trend_and_prior_20_day_high` → action `"buy"`, `entry_level` = max high of the 20 bars **before** the last one.
  - `test_no_buy_below_200_day_average` → `"none"`.
  - `test_no_buy_when_close_equals_prior_high` → `"none"` (must be strictly above).
  - `test_sell_when_holding_and_close_below_prior_10_day_low` → `"sell"`.
  - `test_hold_when_holding_and_no_exit` → `"hold"`.
  - `test_short_history_gives_none_with_reason` (Review Focus 1) → 150 bars → `"none"`, reason mentions not enough history.
  - `test_default_mode_is_signals`, `test_unknown_mode_rejected`.
- [ ] Run, see them fail; implement; run, see them pass; commit.

### Task 2: Trade sizing and safety rules

**Files:** `tradebot/risk.py`, `tests/test_risk.py`

**Produces:**
- `RiskParams(risk_per_trade=0.01, max_trade_fraction=0.20, max_total_fraction=1.0, max_open_trades=5, daily_brake=0.03)`
- `TradePlan(symbol, size: float, entry_price: float, stop_price: float, risk_amount: float, notional: float, reason: str)`
- `Skip(symbol, reason: str)`
- `plan_trade(symbol, price, atr, equity, open_notional, open_count, p: RiskParams, stop_atr: float, min_size: float = 0.0, size_step: float = 0.0) -> TradePlan | Skip`
- `brake_on(day_start_equity: float, equity_now: float, p: RiskParams) -> bool`

- [ ] Tests first:
  - `test_size_risks_one_percent` → equity 10000, price 100, atr 2 → stop 96, size 25, risk 100.
  - `test_trade_capped_at_20_percent` → price 100, atr 0.5 → size capped to 20 (notional 2000), risk below 1%.
  - `test_total_open_never_above_account` → open_notional 9500 → notional ≤ 500.
  - `test_skip_at_five_open_trades`.
  - `test_size_rounds_down_to_step`.
  - `test_skip_when_min_size_breaks_risk` (Review Focus 4) → min_size bigger than allowed → `Skip` with reason.
  - `test_skip_when_atr_missing_or_zero`.
  - `test_brake_at_three_percent` → 10000 → 9700 is on; 9701 is off.
- [ ] Fail, implement, pass, commit.

### Task 3: Price history

**Files:** `tools/fetch_history.py`, `tradebot/history.py`, `tests/test_history.py`, `.github/workflows/trading-bot-fetch-history.yml` (side branch only), `data/history/*.csv`

**Produces:**
- `fetch_history.py` (standard library only): for each symbol tries Stooq then Yahoo, writes `data/history/<SYMBOL>.csv` as `date,open,high,low,close`, split-adjusted, oldest first. Prints one line per symbol with source and row count. Exit code 1 if any symbol failed.
- `load_history(dir) -> dict[str, list[Bar]]` — sorted, de-duplicated, rows with missing or non-positive numbers dropped.

- [ ] Tests: `test_load_sorts_and_drops_bad_rows`, `test_load_dedupes_dates`.
- [ ] Workflow runs the fetcher on GitHub (this session cannot reach the price sites) and commits the CSVs to the side branch. Pull them.
- [ ] Check: every symbol has ≥ 8 years, no gaps over 5 calendar days besides known closures, known split dates show no price cliff.

### Task 4: Test on past prices — **CHECKPOINT: stop and show results**

**Files:** `tradebot/backtest.py`, `tradebot/report.py`, `tradebot/cli.py` (`backtest` command), `tests/test_backtest.py`

**Consumes:** `evaluate`, `plan_trade`, `load_history`.

**Produces:**
- `Costs(spread: dict[kind, float], overnight_rate: dict[kind, float])` — full buy/sell gap as a fraction of price; yearly overnight rate on trade value.
- `Trade(symbol, entry_date, entry_price, exit_date, exit_price, size, pnl, exit_reason: Literal["signal","stop","end"])`
- `BacktestResult(trades, equity_curve: list[tuple[date, float]], start_equity, end_equity, stats: dict, buy_hold: dict, by_year: dict, by_symbol: dict)`
- `run_backtest(history, config, start_equity=10000.0) -> BacktestResult`

Rules the signature does not settle:
- Signal on day *t* close → trade at day *t+1* open. Buy fills at open × (1 + spread/2); sell at open × (1 − spread/2).
- Stop checked every day held, from the entry day on: if open ≤ stop → fill at open; else if low ≤ stop → fill at stop. Spread applied.
- Overnight cost each night held: value × yearly rate / 365.
- More buy signals than free slots: strongest first, ranked by (close − entry_level) / ATR.
- Equity for sizing is cash plus open trades at the previous close.
- Buy-and-hold comparison: equal money in every instrument on the first tradable day, no costs.

- [ ] Tests first:
  - `test_enters_next_open_after_signal`, `test_exits_next_open_after_exit_signal`
  - `test_stop_fills_at_stop_price`, `test_gap_through_stop_fills_at_open`
  - `test_costs_reduce_result` (same trades, with costs < without)
  - `test_never_more_than_five_open`, `test_never_two_trades_same_symbol`
  - `test_no_lookahead` — changing bars after day *t* does not change trades entered on or before *t*.
- [ ] Fail, implement, pass.
- [ ] Run on real history. Report: total and yearly result, number of trades, win rate, average win vs loss, worst drop from a peak, longest losing streak, comparison with buy-and-hold, per-year and per-instrument tables. State the hindsight problem of the watchlist.
- [ ] Commit. **Stop and show the owner.**

### Task 5: Broker layer

**Files:** `tradebot/broker/{__init__,base,fake,capital}.py`, `tests/test_fake_broker.py`, `tests/test_capital_broker.py`

**Produces (`Broker` protocol):**
- `account() -> Account(balance: float, equity: float, available: float, currency: str, is_demo: bool)`
- `market(epic) -> Market(epic, name, bid, ask, tradeable: bool, min_size: float, size_step: float)`
- `daily_bars(epic, count) -> list[Bar]` (may include today's unfinished day)
- `positions() -> list[Position(deal_id, epic, size, entry_price, stop_price: float|None, opened: datetime, pnl: float)]`
- `opened_today(epic) -> bool`
- `open_long(epic, size, stop_price) -> OrderResult(ok: bool, deal_id: str|None, fill_price: float|None, reason: str)`
- `close(deal_id) -> OrderResult`

`CapitalBroker(api_key, identifier, password, demo: bool, session=requests.Session())` — logs in on first use, sends `CST` and `X-SECURITY-TOKEN`, re-logs in once on 401, never puts secrets in exception text. Endpoints checked against the official docs while writing.

- [ ] Tests (HTTP faked at the `requests.Session` level): login headers stored; demo vs live base URL; 401 → one re-login; `open_long` sends `stopLevel` and reads the confirmation; REJECTED confirmation → `ok=False` with reason; secrets absent from raised errors.
- [ ] Fail, implement, pass, commit.

### Task 6: Daily decisions and order placing

**Files:** `tradebot/engine.py`, `tradebot/journal.py`, `tradebot/state.py`, `tests/test_engine.py`

**Produces:**
- `Decision(symbol, action: Literal["buy","sell","skip","none"], reason: str, plan: TradePlan|None, result: OrderResult|None)`
- `run_daily_decisions(broker, config, state, journal, today: date, place_orders: bool) -> list[Decision]`
- `completed_bars(bars, today) -> list[Bar]` — drops any bar dated `today` or later.
- `effective_mode(config, env) -> Literal["signals","demo","live"]` — `live` without the confirm env falls back to `signals` and says so.

- [ ] Tests with `FakeBroker`:
  - `test_signals_mode_places_nothing`
  - `test_buy_places_order_with_stop`
  - `test_no_second_trade_in_held_instrument`
  - `test_no_rebuy_if_opened_today` (two runners)
  - `test_todays_unfinished_bar_ignored` (Review Focus 2)
  - `test_rejected_order_journaled_and_not_retried` (Review Focus 3)
  - `test_order_without_stop_never_sent` — `stop_price` missing → skip.
  - `test_brake_blocks_new_buys_but_allows_sells`
  - `test_trading_disabled_blocks_everything_new`
  - `test_live_needs_both_switches`
  - `test_market_not_tradeable_skips`
  - `test_runs_once_per_day` — second call same day does nothing.
- [ ] Fail, implement, pass, commit.

### Task 7: Morning brief, news, messages, market clock

**Files:** `tradebot/{marketclock,news,brief,notify}.py`, tests for each

**Produces:**
- `is_market_day(d: date) -> bool` (weekends and NYSE holidays), `market_open_utc(d) -> datetime`, `brief_time_utc(d) -> datetime` (one hour before the open), all daylight-saving aware via `zoneinfo`.
- `headlines(symbol, limit=2, fetch=...) -> list[str]` — returns `[]` on any failure.
- `build_brief(account, positions, decisions_preview, near_signals, movers, news, mode, today) -> str` in the shape sketched in the spec.
- `Notifier.send(text) -> bool`; `TelegramNotifier(token, chat_id)`; `ConsoleNotifier()`. Messages over 4000 characters are split.

- [ ] Tests: holiday and weekend are not market days (Review Focus 5); open time correct in summer and winter; brief starts with the mode tag; brief still builds with no news; news failure returns `[]`; long message split.
- [ ] Fail, implement, pass, commit.

### Task 8: Live watch and the two ways to run

**Files:** `tradebot/watch.py`, `tradebot/cli.py`, `tests/test_watch.py`, `tests/test_cli.py`

**Produces:**
- `Alert(key: str, text: str)`; `run_watch(broker, config, state, today, now) -> list[Alert]` — crossing a buy or sell level, stop hit (a held trade is gone), move over 3% on the day, brake on. Each `key` sent once per day via `state`.
- CLI: `backtest`, `brief`, `check` (one pass: brief if due and not yet sent, daily decisions if the market is open and not yet done, then watch), `loop` (runs `check` every `interval` minutes), `doctor` (checks settings, login, every watchlist epic, Telegram; prints what is missing).
- Any unhandled error in `check` is sent as an alert without secrets, and the process exits non-zero.

- [ ] Tests: same alert not sent twice; stop-hit detected; nothing on a closed day (Review Focus 5); `check` order of steps; errors reported.
- [ ] Fail, implement, pass, commit.

### Task 9: Setup guide and schedule template

**Files:** `README.md`, `.env.example`, `deploy/github-workflow.yml`

- [ ] Workflow template: every 15 minutes on weekdays, `python -m tradebot check`, saves `state.json` and the journal back to the repository, secrets from GitHub Secrets.
- [ ] README in plain steps: Capital.com API key (demo first), Telegram bot, new private repository and secrets, running on own computer, the three modes, the off switch, how to change the watchlist.
- [ ] Full test run, commit, push.
