# Setting up online payments

Customers can pay an invoice by card from the **customer portal** and from the
**invoice email**. Each payment is recorded against its invoice in your books
automatically, on the next sync.

Two payment providers are supported:

| Provider | For | Customers can pay with |
|---|---|---|
| [Moyasar](https://moyasar.com) | Saudi Arabia | mada, Visa, Mastercard, Apple Pay, STC Pay |
| [Stripe](https://stripe.com) | most other countries | cards, Apple Pay, Google Pay |

Customers always pay on the provider's own secure page. Card details never
touch this app.

Like the portal, this needs the company to be **linked to the cloud**, and it
builds on [email and the customer portal](EMAIL-AND-PORTAL.md). Set those up
first.

## 1. Add the new tables

Supabase dashboard → SQL Editor → New query. Paste the whole of
`supabase/migrations/0003_online_payments.sql` and press **Run**. It is safe
to run again.

## 2. Deploy the payment function

```bash
supabase functions deploy pay --no-verify-jwt
supabase functions deploy portal --no-verify-jwt   # again: it now shows the Pay button
```

`--no-verify-jwt` is needed because customers have no account, and the
providers send their notifications without one.

Optional: `supabase secrets set APP_URL=https://your-app-address/`. When it is
set, customers can only be sent back to that address after paying.

## 3. Connect your provider

In the app: **Settings → Online payments**.

1. Choose **Moyasar** or **Stripe**.
2. Paste your **secret key**:
   - Moyasar: Dashboard → Settings → API keys (`sk_live_…`).
   - Stripe: Developers → API keys (`sk_live_…`).

   Use a `sk_test_…` key first to try it with test cards.
3. Press **Save and test**. The key is checked with the provider and then
   stored on your server. It never stays in the app and is never shown again.
   Only an owner or admin can do this.
4. Under **Record payments in**, choose the account the money goes into. We
   suggest adding a bank account named after the provider (for example
   "Moyasar balance"). Payments land there. When the provider pays out to your
   real bank, record a bank transfer between the two accounts and book the
   provider's fees as an expense.

**Stripe only:** in the Stripe dashboard, go to Developers → Webhooks and add
an endpoint. Use the address shown in Settings → Online payments and the
event `checkout.session.completed`. Moyasar needs no extra step, because each
payment page reports back to your server on its own.

## How it works

- The customer opens an unpaid invoice in the portal (the invoice email links
  straight to it) and presses **Pay now**.
- The server works out what is still due, from the same figures the portal
  shows, and opens the provider's payment page for exactly that amount.
- After paying, the customer is sent back to the portal and sees the invoice
  marked as paid.
- The server never trusts a notification on its own. It always asks the
  provider, using your secret key, whether the payment really went through.
- On the next sync, the app records the payment against the invoice as a
  normal receipt. This includes a receipt number, a journal entry and the
  invoice status. If several devices sync at once, only one of them records
  it.
- If the customer paid more than the invoice still owed (for example, they
  also paid by bank transfer), the extra is kept as a customer advance. It is
  never lost.
- If a payment can't be recorded (for example, its date falls in a locked
  period), it is tried again on the next sync. It shows as "Not recorded yet"
  under **Recent online payments**.

## Refunds

Make refunds in the provider's dashboard. Then record the refund in the books
the usual way, with a credit note or by refunding the customer advance.
