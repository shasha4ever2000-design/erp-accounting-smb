# Trading bot

A personal trading assistant for Capital.com. It watches US stocks, gold and
silver for you and does three jobs:

1. **Morning brief** on Telegram, one hour before the US market opens.
2. **Live watch** during market hours, with a ping when something matters.
3. **Order placing** by fixed rules, on your demo account first.

It is a tool, not a promise. No bot can guarantee profits, and this is not
financial advice. Capital.com trades are CFDs, where losses can be fast.

---

## How it trades

**Buy** when something closes at a new 20-day high and is above its 200-day
average. **Sell** when it closes below its 10-day low. Orders go in shortly
after the next market open.

The safety rules are always on:

| Rule | Value |
|---|---|
| Stop-loss | On every trade, placed at Capital.com when the trade opens |
| Loss if a stop is hit | About 1% of the account |
| Biggest single trade | 20% of the account |
| All trades together | Never more than the account, so the bot never borrows |
| Open trades at once | 5 at most |
| Daily brake | Down 3% in a day: no new trades until tomorrow |
| No stop, no trade | If a stop-loss cannot be set, the trade is not opened |

### What the test on past prices showed

Over 12 years (2014 to 2026) the strategy made about **9% a year** with a
worst drop of **23%**. A plain S&P 500 fund made about 14% a year with a worst
drop of 34%. Only 38% of trades were winners, and the longest losing streak
was 14 trades. Estimated overnight fees took about 5 points a year off the
result. The full report is in `docs/backtest-report.txt`.

In short: this strategy protects you in bad years and lags in strong ones.

---

## The three modes

Set `mode` in `config.yaml`.

| Mode | What the bot does |
|---|---|
| `signals` | Brief and pings only. It tells you what it would do. **No orders.** This is the default. |
| `demo` | Places orders on your Capital.com **demo** account, with pretend money. |
| `live` | Places orders with **real money**. Needs a second switch, see below. |

Every message starts with `[SIGNALS]`, `[DEMO]` or `[LIVE]`, so you always
know which one is running.

**The off switch:** set `trading_enabled: false` in `config.yaml`. The bot
stops opening new trades at once. It still sells and still sends messages.
You can also close any trade yourself in the Capital.com app at any time.

---

## Setup

You need three things: a Capital.com API key, a Telegram bot, and a place to
run the bot. Do these once.

### 1. Capital.com API key

1. Log in to Capital.com and turn on **two-step login** (Settings → Security).
2. Go to **Settings → API integrations → Generate new key**.
3. Give it a name, and type a **password for the key**. Write it down. This is
   a separate password just for the key.
4. Copy the key that appears. You only see it once.

You now have three values:

| Name | What it is |
|---|---|
| `CAPITAL_API_KEY` | The key you just copied |
| `CAPITAL_IDENTIFIER` | The email you log in to Capital.com with |
| `CAPITAL_PASSWORD` | The password you typed for the key |

The same key works for the demo account. The bot connects to demo unless real
money is fully switched on.

### 2. Telegram bot

1. In Telegram, open a chat with **@BotFather** and send `/newbot`.
2. Pick a name. BotFather gives you a **token**. That is `TELEGRAM_BOT_TOKEN`.
3. Open your new bot and press **Start**, so it is allowed to message you.
4. Open a chat with **@userinfobot**. It replies with your **Id**, a number.
   That is `TELEGRAM_CHAT_ID`.

### 3a. Run it on your own computer

1. Install Python 3.11 or newer from python.org.
2. Open a terminal in this folder and run:
   ```
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and fill in the five values from above.
4. Check that everything connects:
   ```
   python -m tradebot doctor
   ```
   It lists your account, every item on the watchlist, and sends a test
   message to Telegram. Fix anything it marks.
5. Start the bot:
   ```
   python -m tradebot loop
   ```
   It checks every 5 minutes for as long as the window stays open and the
   computer is awake. Press Ctrl+C to stop.

### 3b. Run it on GitHub (free, works while your computer is off)

1. Create a new **private** repository on GitHub.
2. Upload everything in this folder to it.
3. In that repository, create the file `.github/workflows/tradebot.yml` and
   paste in the contents of `deploy/github-workflow.yml`.
4. Go to **Settings → Secrets and variables → Actions → New repository
   secret** and add the five values, one secret each, with exactly these names:
   `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER`, `CAPITAL_PASSWORD`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
5. Open the **Actions** tab, choose **Trading bot**, press **Run workflow**,
   pick `doctor` and run it. Read the result to see that everything connects.

After that it runs by itself every 15 minutes on weekdays, around US market
hours. GitHub sometimes starts a run a few minutes late. That is fine for this
strategy, because it decides once a day and every stop-loss sits at
Capital.com.

**Use one of 3a and 3b at a time.** If both run, orders are still safe from
doubling, but you may get the same ping twice.

---

## Going from signals to demo to real money

1. Start in `signals`. Read the briefs for a few days.
2. Change to `mode: demo`. Watch the bot trade pretend money for a few weeks.
   Compare what it does with what the messages say.
3. Real money needs **two** switches, on purpose:
   - `mode: live` in `config.yaml`, **and**
   - the setting `TRADEBOT_CONFIRM_LIVE` with the exact value
     `I_UNDERSTAND_REAL_MONEY` (in `.env`, or as a GitHub secret).

   With only one of them the bot places no orders and tells you so.

Before real money, also move the bot to a small always-on server. Your own
computer sleeps, and GitHub can run late.

---

## Everyday changes

All in `config.yaml`:

- **Watchlist:** add or remove lines under `instruments`. `epic` is the code
  Capital.com uses. Run `python -m tradebot doctor` after a change; it tells
  you if a code is wrong.
- **Strategy numbers and safety limits:** under `strategy` and `risk`.
- **Alerts:** under `alerts`.

To see the brief right now on your screen without sending it:

```
python -m tradebot --print brief
```

---

## Things to know

- **Use an account in US dollars.** If the account is in another currency the
  bot skips the trade and says why, because the sizes would be wrong.
- **The bot manages every buy trade in a watchlist item on that account.** If
  you open a trade in Apple by hand and Apple is on the watchlist, the bot will
  sell it when its sell rule fires. Trade by hand in other instruments, or keep
  the bot on its own account.
- **It works on US market days only.** On US holidays and weekends it does
  nothing, including for gold and silver.
- **Overnight fees matter.** Trades are held for weeks and Capital.com charges
  a fee each night. `doctor` prints Capital.com's own fee figure for each
  instrument. Check it in the app too.
- **Headlines are a bonus.** They come from a free news feed. If the feed does
  not answer, the brief goes out without them.
- **The trade journal** is `journal.csv`: one line for every order and every
  skipped order, with the reason.
- **If something breaks** you get one message saying so, and the bot tries
  again at the next check. Stop-losses at Capital.com keep working meanwhile.
- **No morning brief on a market day means the bot is not running.** Check it.

---

## Testing the strategy on past prices

```
python tools/fetch_history.py --out data/history
python -m tradebot backtest
```

The first command needs a free key from tiingo.com in `TIINGO_API_KEY`. The
downloaded price files stay on your computer and are not uploaded.

---

## What has and has not been checked

- The rules, sizing, safety limits, order logic, brief and alerts are covered
  by automated tests. Run them with `pip install pytest` then `pytest`.
- The connection to Capital.com was written from their official documentation
  and tested against a stand-in. **It has not yet talked to the real
  Capital.com**, because that needs your login. Your first `doctor` run on the
  demo account is that test. If it reports a problem, that is the place to fix.
- The news feed and Telegram sending have not been tried live either.
