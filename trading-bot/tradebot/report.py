"""Turns a test on past prices into a plain-language report."""

from __future__ import annotations

from .backtest import BacktestResult
from .config import Config


def money(x: float) -> str:
    return f"-${abs(x):,.0f}" if x < 0 else f"${x:,.0f}"


def signed_money(x: float) -> str:
    return f"+${x:,.0f}" if x >= 0 else f"-${abs(x):,.0f}"


def pct(x: float, digits: int = 0) -> str:
    return f"{x * 100:+,.{digits}f}%"


def verdict(r: BacktestResult) -> str:
    s, b = r.stats, r.buy_hold
    if s["total_return"] <= 0:
        first = "The strategy lost money over this period."
    elif s["total_return"] < b["total_return"]:
        first = "The strategy made money, but less than simply buying everything and holding it."
    else:
        first = "The strategy made more than simply buying everything and holding it."
    if s["max_drawdown"] < b["max_drawdown"]:
        second = (
            f"Its falls were smaller: the worst drop was {pct(-s['max_drawdown'])} "
            f"against {pct(-b['max_drawdown'])} for buy and hold."
        )
    else:
        second = (
            f"Its falls were not smaller either: the worst drop was {pct(-s['max_drawdown'])} "
            f"against {pct(-b['max_drawdown'])} for buy and hold."
        )
    return f"{first} {second}"


def render_backtest(r: BacktestResult, config: Config) -> str:
    s, b = r.stats, r.buy_hold
    names = {i.symbol: i.name for i in config.instruments}
    lost = s["trades"] - s["wins"]
    lines = [
        "TEST ON PAST PRICES",
        f"Period: {r.start_date:%d %b %Y} to {r.end_date:%d %b %Y} ({s['years']:.1f} years)",
        f"Watchlist: {len(r.by_symbol)} instruments",
        "",
        "IN ONE LINE",
        f"  {verdict(r)}",
        "",
        "THE RESULT",
        f"  Started with     {money(r.start_equity)}",
        f"  Ended with       {money(r.end_equity)}   ({pct(s['total_return'])} in total, about {pct(s['yearly_return'], 1)} a year)",
        f"  Buy and hold     {money(b['end_equity'])}   ({pct(b['total_return'])} in total, about {pct(b['yearly_return'], 1)} a year)",
        "",
        "THE TRADES",
        f"  Trades taken     {s['trades']}",
        f"  Winners          {s['win_rate'] * 100:.0f}%  ({s['wins']} won, {lost} lost)",
        f"  Average winner   {signed_money(s['avg_win'])}",
        f"  Average loser    {signed_money(s['avg_loss'])}",
        f"  A winner is about {s['win_loss_ratio']:.1f} times the size of a loser",
        f"  Typical hold     {s['avg_days_held']:.0f} days",
        f"  Stopped out      {s['stop_exits']} trades ended at the stop-loss",
        "",
        "THE HARD PARTS",
        f"  Worst drop from a peak    {pct(-s['max_drawdown'])}   (buy and hold: {pct(-b['max_drawdown'])})",
        f"  Longest losing streak     {s['longest_losing_streak']} trades in a row",
        f"  Money in the market       {s['avg_exposure'] * 100:.0f}% of the account on average",
        f"  Costs paid                {money(s['spread_costs'])} in price gaps, {money(s['overnight_fees'])} in overnight fees",
        "",
        "YEAR BY YEAR",
        "  Year    Strategy    Buy and hold",
    ]
    for year in sorted(r.by_year):
        row = r.by_year[year]
        lines.append(f"  {year}    {pct(row['strategy'], 1):>8}    {pct(row['buy_hold'], 1):>8}")

    lines += ["", "BY INSTRUMENT"]
    for symbol, row in sorted(r.by_symbol.items(), key=lambda kv: -kv[1]["pnl"]):
        n = int(row["trades"])
        won = f"{row['wins'] / n * 100:.0f}% won" if n else "no trades"
        lines.append(f"  {names.get(symbol, symbol):<12} {n:>3} trades, {won:>9}, {signed_money(row['pnl'])}")

    if r.skipped:
        lines += ["", "Not tested (too little price history): " + ", ".join(names.get(x, x) for x in r.skipped)]

    lines += [
        "",
        "READ THIS BEFORE TRUSTING THE NUMBERS",
        "  - The watchlist was picked today, knowing which companies did well. Ten years ago",
        "    nobody knew that. This makes both columns look better than real life would have.",
        "  - Costs are estimates. Check the real price gaps and overnight fees in Capital.com.",
        "  - Gold and silver are tested with fund prices that follow the metals closely.",
        "  - Past results do not promise future results.",
    ]
    return "\n".join(lines)
