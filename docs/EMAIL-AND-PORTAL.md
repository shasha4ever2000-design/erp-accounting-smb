# Setting up email and the customer portal

Both features run on the company's cloud (Supabase), so they work for
companies that are **linked to the cloud** (Settings → Cloud sync). Local-only
companies still get an **Email** button: it opens the message in your own
email app.

You do this once, from a computer with the
[Supabase CLI](https://supabase.com/docs/guides/cli) signed in to your project.

## 1. Add the new tables

Open the Supabase dashboard → SQL Editor → New query, paste the whole of
`supabase/migrations/0002_email_and_portal.sql` and press **Run**. It is safe
to run again.

## 2. Email: pick a sender

The app sends through [Resend](https://resend.com). Create an account, add
and verify your domain (so emails come from `billing@your-company.com` and
don't land in spam), and create an API key. Then:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set EMAIL_FROM="Billing <billing@your-company.com>"
supabase functions deploy send-email
```

Optional settings:

| Secret | What it does | Default |
|---|---|---|
| `EMAIL_DAILY_LIMIT` | Most emails one company can send in 24 hours | 200 |
| `APP_URL` | When set, links inside emails must start with this address | not set |

Each email shows your company name as the sender and uses your company email
(Settings → Company) as the reply-to address, so customers' replies reach you.
Every email sent or failed is recorded in the `email_log` table.

## 3. Customer portal

```bash
supabase functions deploy portal --no-verify-jwt
```

`--no-verify-jwt` is needed because customers don't have an account. The
function only answers for a valid, not-cancelled link, and only with that one
customer's invoices, payments, returns and balance.

To give a customer their link: **Customers → the link icon on their row →
Create portal link → Copy**. Or tick **Add a link where the customer can see
their invoices online** when you email them an invoice or statement. You can
cancel a link at any time from the same place.

The portal shows what has synced to the cloud, so a brand-new invoice appears
after the next sync (every two minutes while the app is open).

## Who can do what

- Sending email and making portal links: cloud **owners, admins and members**.
  Cloud **viewers** can't.
- Inside the app, the same actions also follow the user's role on the Team
  page (a sales clerk can email invoices; a viewer can't).
