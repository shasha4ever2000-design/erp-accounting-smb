// The two payment providers, as plain request builders and response readers.
// No network and no Deno APIs here, so the app's unit tests import this file;
// index.ts does the fetching.
//
// Moyasar (Saudi Arabia: mada, Visa/Mastercard, Apple Pay, STC Pay) and
// Stripe (most other countries). Either way the customer pays on the
// provider's own hosted page, so card details never touch this app.
//
// A payment is only ever believed after asking the provider for it with the
// company's secret key (readCheckout). Whatever is posted to the callback
// address is used only to know *which* checkout to ask about, so a forged
// callback can't mark anything paid.

export type Provider = "moyasar" | "stripe";
export type Status = "pending" | "paid" | "failed" | "expired" | "refunded";

export interface CheckoutRequest {
  amount: number;          // major units, e.g. 115.50
  currency: string;        // ISO 4217
  description: string;
  successUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  reference: string;       // our online_payments id
}

export interface Checkout {
  ref: string;             // the provider's id for it
  url: string;             // where the customer pays
  status: Status;
  paidAmount: number;      // major units; 0 until paid
  fee: number;             // major units, when the provider says
  paidAt: string | null;
}

export const PROVIDERS: Provider[] = ["moyasar", "stripe"];

// Digits after the decimal point, per ISO 4217, for the currencies that
// aren't the usual two.
const THREE = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
const ZERO = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

export function minorDigits(currency: string): number {
  const c = String(currency || "").toUpperCase();
  return THREE.has(c) ? 3 : ZERO.has(c) ? 0 : 2;
}

export function toMinor(amount: number, currency: string): number {
  return Math.round((Number(amount) || 0) * 10 ** minorDigits(currency));
}

export function fromMinor(minor: number, currency: string): number {
  const d = minorDigits(currency);
  return Math.round(Number(minor) || 0) / 10 ** d;
}

/** A first look at a key, so a typo is caught before a customer meets it. */
export function checkKey(provider: Provider, key: string): string {
  const k = String(key || "").trim();
  if (!k) return "Enter the secret key.";
  if (provider === "moyasar" && !/^sk_(test|live)_\w{10,}$/.test(k)) return "A Moyasar secret key starts with sk_live_ (or sk_test_ for testing).";
  if (provider === "stripe" && !/^(sk|rk)_(test|live)_\w{10,}$/.test(k)) return "A Stripe secret key starts with sk_live_ (or sk_test_ for testing).";
  return "";
}

/** "sk_live_…9f3a": enough to recognise a key, not to use it. */
export function keyHint(key: string): string {
  const k = String(key || "").trim();
  const prefix = (k.match(/^[a-z]+_(test|live)_/) || [""])[0];
  return `${prefix}…${k.slice(-4)}`;
}

export const isTestKey = (key: string) => /_test_/.test(String(key || ""));

const basic = (key: string) => `Basic ${btoa(`${key}:`)}`;

// ─── Requests ───────────────────────────────────────────────────────────

export interface HttpRequest { url: string; init: { method: string; headers: Record<string, string>; body?: string } }

export function createRequest(provider: Provider, key: string, req: CheckoutRequest): HttpRequest {
  const currency = req.currency.toUpperCase();
  if (provider === "moyasar") {
    return {
      url: "https://api.moyasar.com/v1/invoices",
      init: {
        method: "POST",
        headers: { Authorization: basic(key), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          amount: toMinor(req.amount, currency),
          currency,
          description: req.description.slice(0, 250),
          callback_url: req.callbackUrl,
          success_url: req.successUrl,
          back_url: req.cancelUrl,
        }),
      },
    };
  }
  // Stripe wants the last digit of a three-decimal amount to be zero.
  let minor = toMinor(req.amount, currency);
  if (minorDigits(currency) === 3) minor = Math.round(minor / 10) * 10;
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(minor),
    "line_items[0][price_data][product_data][name]": req.description.slice(0, 250),
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
    client_reference_id: req.reference,
    "metadata[online_payment_id]": req.reference,
  });
  return {
    url: "https://api.stripe.com/v1/checkout/sessions",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
  };
}

export function fetchRequest(provider: Provider, key: string, ref: string): HttpRequest {
  const id = encodeURIComponent(ref);
  return provider === "moyasar"
    ? { url: `https://api.moyasar.com/v1/invoices/${id}`, init: { method: "GET", headers: { Authorization: basic(key), Accept: "application/json" } } }
    : { url: `https://api.stripe.com/v1/checkout/sessions/${id}`, init: { method: "GET", headers: { Authorization: `Bearer ${key}` } } };
}

/** A cheap authenticated call, to tell whether a key works before saving it. */
export function pingRequest(provider: Provider, key: string): HttpRequest {
  return provider === "moyasar"
    ? { url: "https://api.moyasar.com/v1/invoices?page=1", init: { method: "GET", headers: { Authorization: basic(key), Accept: "application/json" } } }
    : { url: "https://api.stripe.com/v1/balance", init: { method: "GET", headers: { Authorization: `Bearer ${key}` } } };
}

// ─── Responses ──────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const num = (v: unknown) => Number(v) || 0;

/** What a provider's invoice / checkout session says, in our terms. */
export function readCheckout(provider: Provider, body: Obj): Checkout {
  if (provider === "moyasar") {
    const currency = String(body.currency || "SAR");
    const s = String(body.status || "");
    const status: Status = s === "paid" ? "paid"
      : s === "refunded" ? "refunded"
      : s === "expired" ? "expired"
      : ["failed", "canceled", "voided"].includes(s) ? "failed"
      : "pending"; // initiated, on_hold
    const paid = (Array.isArray(body.payments) ? body.payments as Obj[] : [])
      .filter((p) => ["paid", "captured"].includes(String(p.status)));
    return {
      ref: String(body.id || ""),
      url: String(body.url || ""),
      status,
      paidAmount: status === "paid" ? fromMinor(num(body.amount), currency) : 0,
      fee: fromMinor(paid.reduce((s, p) => s + num(p.fee), 0), currency),
      paidAt: status === "paid" ? String(paid[0]?.updated_at || body.updated_at || "") || null : null,
    };
  }
  const currency = String(body.currency || "usd").toUpperCase();
  const status: Status = body.payment_status === "paid" || body.payment_status === "no_payment_required" ? "paid"
    : body.status === "expired" ? "expired"
    : "pending";
  return {
    ref: String(body.id || ""),
    url: String(body.url || ""),
    status,
    paidAmount: status === "paid" ? fromMinor(num(body.amount_total), currency) : 0,
    fee: 0, // on the balance transaction, not the session; booked when the payout is reconciled
    paidAt: status === "paid" ? new Date().toISOString() : null,
  };
}

/** The provider's error message, or a plain one. */
export function readError(body: Obj, status: number): string {
  const e = (body?.error ?? body) as Obj;
  const msg = String(e?.message || body?.message || "").trim();
  if (status === 401 || status === 403) return "The payment provider refused the secret key. Check it in Settings → Online payments.";
  return msg || `The payment provider answered with an error (${status}).`;
}

/** Every id a callback body might be carrying, so we know which checkout to re-check. */
export function callbackRefs(body: unknown): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v.length >= 6 && v.length <= 120) out.add(v); };
  const b = (body ?? {}) as Obj;
  const data = (b.data ?? {}) as Obj;
  const object = (data.object ?? {}) as Obj;
  add(b.id); add(b.invoice_id); add(data.id); add(data.invoice_id); add(object.id);
  return [...out];
}
