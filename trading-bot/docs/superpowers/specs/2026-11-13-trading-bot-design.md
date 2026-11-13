# Trading bot — design

Date: 2026-11-13
Status: waiting for approval

## What this is and why

A personal trading assistant for one person who trades US stocks, gold and
silver on Capital.com. They trade by feel today and have no fixed rules. They
want a bot that helps with daily decisions in three ways:

1. **Morning brief** — a short report before the US market opens.
2. **Live watch** — pings during the day when something important happens.
3. **Order placing** — the bot opens and closes trades by itself, following
   fixed rules.

The owner is not a programmer. Everything the bot says must be in plain
language, and every action must come with a one-line reason.

## Goals

- One bot, three jobs, all driven by the same strategy rules.
- The owner always knows what the bot did and why.
- Order placing starts on the Capital.com demo account (pretend money).
  Real money only after the owner switches it on.
- Before any trading, the strategy is tested on past prices and the results
  are shown honestly, including the bad parts.
- Runs two ways from the same code: free scheduled runs on GitHub, and on the
  owner's own computer.

## Not in the first version

- AI-written commentary in the brief.
- Asking the owner to approve each trade with a tap before it is placed.
- Betting on falling prices (short selling).
- More than one strategy at a time.
- A web page or dashboard. Telegram is the only screen.
- Trading inside the day on minute-by-minute prices.

## What would make this a failure even if it "works"

- A trade is opened without a stop-loss.
- The same trade is opened twice.
- Real money is traded when the owner thought it was the demo.
- The bot stops working and nobody notices.
- The bot loses more in a day than the daily limit allows because of a bug.
- Passwords or keys end up in the code, the chat, or a log.

## Constraints found during research

- Capital.com has a public API that can open and close trades, read prices
  and price history, and stream live prices. There is a separate demo
  address with pretend money that behaves like the real one.
- To use it the owner must turn on two-step login and create an API key in
  Settings → API integrations.
- A login session ends after 10 minutes without use, so each run logs in
  fresh.
- Limits: 10 requests a second; on demo, 1000 new trades or orders an hour.
  Far more than this bot needs.
- Capital.com trades are CFDs with leverage. Costs are the gap between the
  buy and sell price on each trade, plus an overnight fee while a trade is
  open.
- Logging in needs the password in the request itself, so the connection to
  Capital.com cannot be tried from the build session. The first real
  connection test happens on the owner's side, on the demo account.
- GitHub scheduled runs only work from a repository's main branch, and they
  can start a few minutes late. The bot therefore needs its own private
  repository; it must not go on the main branch of the accounting app.

## Approaches considered

**Where the bot runs**

| Option | Trade-off |
|---|---|
| Free scheduled runs on GitHub | Free, nothing to install, runs when the computer is off. Checks every 15 minutes or so, sometimes late. |
| Small rented server | Reacts in seconds, most reliable. About $5 a month and more setup. |
| The owner's own computer | Free. Stops when the computer sleeps. |

**Picked by the owner: GitHub scheduled runs and their own computer.** Not the
rented server for now. The code is written so a server can be added later
with no rewrite. This is recommended before real money goes in.

**Why 15-minute checks are enough:** the strategy holds trades for days and
decides once a day. Every stop-loss sits at Capital.com, so protection does
not depend on the bot being awake.

## The strategy (proposed by the builder, accepted by the owner as a start)

"Only buy what is already going up, and get out fast when wrong."

- **Buy** when the day's closing price is above its 200-day average and above
  the highest price of the previous 20 days. The order goes in at the next
  market open.
- **Sell** when the day's closing price is below the lowest price of the
  previous 10 days. The order goes in at the next market open.
- **Stop-loss** on every trade, placed at Capital.com when the trade is
  opened. Distance: twice the stock's normal daily movement (average true
  range over 20 days).
- **Buying only.** No short selling.

All numbers above (200, 20, 10, 2×) live in the settings file.

### Safety rules (fixed, not optional)

| Rule | Value to start |
|---|---|
| Loss if a trade hits its stop | about 1% of the account |
| Biggest single trade | 20% of the account |
| Total of all open trades | never more than the account size, so no borrowing |
| Open trades at once | 5 at most |
| Daily brake | account down 3% since the day began → no new trades until tomorrow |
| One trade per stock | never a second trade in something already held |
| No stop, no trade | if the stop-loss cannot be set, the trade is not opened |
| Off switch | one setting that stops all new trades at once |

If the smallest trade size Capital.com allows would break the 1% rule, the
bot skips that trade and says so.

### Starting watchlist (the owner asked the builder to propose it)

Apple, Microsoft, Nvidia, Alphabet, Meta, Amazon, Tesla, JPMorgan, Eli Lilly,
Exxon Mobil, Walmart, Costco, Gold, Silver.

Kept in the settings file. Each one is checked against the owner's
Capital.com account at first connection; anything missing is reported, not
silently dropped.

## The three jobs

### 1. Morning brief

Sent on Telegram about one hour before the US market opens, on market days.

It contains:
- The account: balance, open trades, profit or loss on each.
- What the bot will do at the open today, with the reason for each.
- Stocks that are close to a buy or a sell signal.
- Yesterday's biggest movers on the watchlist.
- A few news headlines per stock from a free news feed, when available. If
  the feed fails, the brief still goes out without them.

The brief also proves the bot is alive. No brief on a market day means
something is wrong.

Sketch:

```
Good morning. Friday 13 Nov

Account (DEMO): $10,240   Open trades: 2
  Nvidia   +3.1%   stop at $171.20
  Gold     -0.4%   stop at $4,012

Today at the open
  BUY Costco. Closed at a new 20-day high, uptrend intact.
  SELL Nvidia. No. Still above its 10-day low.

Getting close
  Apple is 0.8% below its buy level ($243.10)

Headlines
  Costco: ...
```

### 2. Live watch

On each check during market hours the bot pings when:
- a price crosses a buy or sell level during the day ("heads-up: if it
  closes here, the bot buys tomorrow"),
- a stop-loss was hit,
- a watchlist stock moves more than 3% in the day,
- the daily brake kicks in,
- anything fails (cannot log in, cannot place an order, missing prices).

Each ping is sent once, not repeated on every check.

### 3. Order placing

Three levels, set in the settings file:

| Level | What happens |
|---|---|
| `signals` | Brief and pings only. No orders. **The default.** |
| `demo` | Orders on the Capital.com demo account. |
| `live` | Orders with real money. |

`live` needs two separate things to be set on purpose: the level in the
settings file and a second confirmation setting stored with the secrets. One
alone does nothing. Every message the bot sends says DEMO or LIVE at the top.

Before placing any order the bot reads the open trades from Capital.com and
treats that as the truth. This is what prevents double trades, including when
GitHub and the owner's computer both happen to run.

Every order, and every skipped order with its reason, is written to a trade
journal file.

## Testing on past prices

Built first, before anything else.

- Runs the exact same strategy code the live bot uses, over several years of
  daily prices for the whole watchlist.
- Includes costs: the buy/sell gap and the overnight fee.
- Reports in plain language: total result, how often trades won, the average
  win against the average loss, the worst drop from a peak, the longest
  losing streak, and a comparison with simply buying and holding.
- If the result is weak, that is said plainly and the rules are revisited
  with the owner before moving on.

Price history for this test comes from a free public source of daily prices.
The live bot uses Capital.com's own prices.

## How it is built (builder's calls)

- Python.
- Two ways to start it: a single check that then exits (for GitHub), and a
  loop that checks every few minutes (for the owner's computer).
- Telegram for all messages.
- Secrets (Capital.com login, API key, Telegram token) are read from the
  environment: GitHub Secrets on GitHub, a private file on the owner's
  computer that is never saved to the repository.
- A small memory file remembers which pings were sent and where the account
  stood at the start of the day. On GitHub the scheduled run saves it back
  to the repository.
- The connection to Capital.com sits behind one small layer, so tests use a
  pretend broker and no test ever needs real login details.
- Automated tests cover the signal rules, trade sizing, every safety rule,
  and the double-trade protection.
- The code lives in `trading-bot/` on the branch `claude/nifty-tesla-1qoxtc`
  of the accounting repository while it is being built, and never touches the
  accounting app's files. For GitHub scheduled runs the owner creates one new
  private repository and the folder moves there.

## Order of work

1. Strategy rules and the test on past prices. **Stop and show results.**
2. Morning brief.
3. Live watch.
4. Order placing on demo.
5. Setup guide in plain steps: Capital.com API key, Telegram bot, GitHub
   secrets, running on the owner's computer.

Real money is not part of this build. It is a later decision by the owner,
after watching the demo for a few weeks.

## Left to the builder

- Which free source to use for past prices and for news headlines.
- Exact schedule times and how daylight-saving changes are handled.
- File layout and names inside `trading-bot/`.
- How overnight fees and the buy/sell gap are estimated in the test.
- Wording of the Telegram messages, in keeping with the sketch above.

## What the owner needs to do, later

- Turn on two-step login in Capital.com and create an API key (demo first).
- Create a Telegram bot (two minutes, guided).
- Create one private GitHub repository for the bot.
- Never paste keys or passwords into the chat.
