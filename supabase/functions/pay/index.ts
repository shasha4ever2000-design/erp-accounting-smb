// Online payments: a customer pays an invoice by card on Moyasar's or
// Stripe's hosted page, and the payment lands in the books on its own.
//
// Deploy without the sign-in check — customers have no account, and the
// providers post their notifications here without one:
//
//   supabase functions deploy pay --no-verify-jwt
//
// Optional secret: APP_URL (when set, customers can only be sent back there).
// The provider's secret key is entered in the app (Settings → Online
// payments) and kept in payment_settings, which only this function can read.
// See docs/ONLINE-PAYMENTS.md.
//
// Actions (POST, JSON body):
//   status     {companyId}                       member     → is it set up?
//   configure  {companyId, provider, secretKey}  owner/admin → test the key, save it ("off" removes it)
//   refresh    {companyId}                       member     → re-check this company's open checkouts
//   checkout   {token, invoiceId, returnUrl}     portal     → a pay page for what is still due
//   confirm    {token, paymentId}                portal     → re-check one checkout after paying
// and POST ?callback=moyasar|stripe from the providers themselves.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { shapePortal } from "../portal/shape.ts";
import {
  PROVIDERS, checkKey, keyHint, isTestKey, createRequest, fetchRequest, pingRequest, readCheckout, readError, callbackRefs,
  type Provider, type HttpRequest,
} from "./providers.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "This link is not valid any more. Ask the company for a new one.";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = () => createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Row = Record<string, any>;

async function call(req: HttpRequest): Promise<{ ok: boolean; status: number; body: Row }> {
  try {
    const res = await fetch(req.url, req.init);
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: { message: "Could not reach the payment provider." } };
  }
}

/** The signed-in member and their role, or an error response. */
async function member(req: Request, companyId: string): Promise<{ userId: string; role: string } | Response> {
  if (!UUID.test(companyId)) return json({ error: "companyId is required" }, 400);
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data } = await userClient.auth.getUser();
  if (!data?.user) return json({ error: "Sign in first." }, 401);
  const { data: m } = await userClient.from("company_members").select("role")
    .eq("company_id", companyId).eq("user_id", data.user.id).maybeSingle();
  if (!m) return json({ error: "You are not a member of this company." }, 403);
  return { userId: data.user.id, role: m.role };
}

/** The portal link a token names, if it is still good. */
async function portalLink(db: SupabaseClient, token: string): Promise<Row | null> {
  if (!UUID.test(token)) return null;
  const { data: link } = await db.from("portal_links").select("*").eq("token", token).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) return null;
  return link;
}

/** Ask the provider about one checkout and write down what it says. */
async function refresh(db: SupabaseClient, row: Row, settings?: Row | null): Promise<Row> {
  if (!row.provider_ref || row.status === "paid" || row.status === "refunded") return row;
  const cfg = settings ?? (await db.from("payment_settings").select("*").eq("company_id", row.company_id).maybeSingle()).data;
  if (!cfg || cfg.provider !== row.provider) return row; // provider changed since; nothing to ask
  const res = await call(fetchRequest(row.provider, cfg.secret_key, row.provider_ref));
  if (!res.ok) return row;
  const c = readCheckout(row.provider, res.body);
  const patch: Row = { status: c.status, checked_at: new Date().toISOString() };
  if (c.status === "paid") {
    patch.paid_amount = c.paidAmount;
    patch.fee = c.fee || null;
    patch.paid_at = row.paid_at || c.paidAt || new Date().toISOString();
  }
  const { data } = await db.from("online_payments").update(patch).eq("id", row.id).select().single();
  return data ?? { ...row, ...patch };
}

/** What is still due on one invoice, worked out the same way the portal shows it. */
async function dueOn(db: SupabaseClient, companyId: string, customerId: string, invoiceId: string) {
  const records = (entity: string) => db.from("records").select("data")
    .eq("company_id", companyId).eq("entity", entity).eq("deleted", false);
  const [settingsRes, invRes, notesRes] = await Promise.all([
    records("settings").eq("record_id", "singleton").maybeSingle(),
    records("invoices").eq("record_id", invoiceId).maybeSingle(),
    records("creditNotes").eq("data->>invoiceId", invoiceId).limit(500),
  ]);
  const invoice = invRes.data?.data;
  if (!invoice || String(invoice.customerId) !== customerId) return null;
  const shaped = shapePortal({
    settings: settingsRes.data?.data ?? {},
    customer: { id: customerId },
    invoices: [invoice],
    creditNotes: (notesRes.data ?? []).map((r) => r.data),
  });
  const doc = shaped.invoices[0];
  if (!doc) return null;
  return { ...doc, companyName: shaped.company.name };
}

function safeReturn(url: unknown): string {
  try {
    const u = new URL(String(url || ""));
    if (!["https:", "http:"].includes(u.protocol)) return "";
    const allowed = Deno.env.get("APP_URL") ?? "";
    const base = `${u.origin}${u.pathname}`;
    if (allowed && !base.startsWith(allowed)) return "";
    return base;
  } catch { return ""; }
}

// ─── Handlers ───────────────────────────────────────────────────────────

async function handleCallback(provider: string, req: Request) {
  if (!PROVIDERS.includes(provider as Provider)) return json({ ok: true });
  const body = await req.json().catch(() => ({}));
  const refs = callbackRefs(body);
  if (!refs.length) return json({ ok: true });
  const db = admin();
  const { data: rows } = await db.from("online_payments").select("*").eq("provider", provider).in("provider_ref", refs).limit(5);
  for (const row of rows ?? []) await refresh(db, row);
  return json({ ok: true });
}

async function handleStatus(req: Request, body: Row) {
  const who = await member(req, String(body.companyId ?? ""));
  if (who instanceof Response) return who;
  const { data } = await admin().from("payment_settings").select("provider, key_hint, updated_at").eq("company_id", body.companyId).maybeSingle();
  return json({ configured: !!data, provider: data?.provider ?? null, keyHint: data?.key_hint ?? "", test: /_test_/.test(data?.key_hint ?? ""), updatedAt: data?.updated_at ?? null,
    callbackUrl: `${SUPABASE_URL}/functions/v1/pay?callback=stripe` });
}

async function handleConfigure(req: Request, body: Row) {
  const who = await member(req, String(body.companyId ?? ""));
  if (who instanceof Response) return who;
  if (!["owner", "admin"].includes(who.role)) return json({ error: "Only an owner or admin can set up online payments." }, 403);
  const db = admin();
  if (body.provider === "off") {
    await db.from("payment_settings").delete().eq("company_id", body.companyId);
    return json({ ok: true, configured: false });
  }
  const provider = String(body.provider) as Provider;
  if (!PROVIDERS.includes(provider)) return json({ error: "Choose Moyasar or Stripe." }, 400);
  const key = String(body.secretKey ?? "").trim();
  const problem = checkKey(provider, key);
  if (problem) return json({ error: problem }, 400);
  const ping = await call(pingRequest(provider, key));
  if (!ping.ok) return json({ error: readError(ping.body, ping.status) }, 400);
  const { error } = await db.from("payment_settings").upsert({
    company_id: body.companyId, provider, secret_key: key, key_hint: keyHint(key),
    updated_by: who.userId, updated_at: new Date().toISOString(),
  });
  if (error) return json({ error: "Could not save the settings. Has 0003_online_payments.sql been run?" }, 500);
  return json({ ok: true, configured: true, provider, keyHint: keyHint(key), test: isTestKey(key) });
}

async function handleRefresh(req: Request, body: Row) {
  const who = await member(req, String(body.companyId ?? ""));
  if (who instanceof Response) return who;
  const db = admin();
  const { data: cfg } = await db.from("payment_settings").select("*").eq("company_id", body.companyId).maybeSingle();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: rows } = await db.from("online_payments").select("*")
    .eq("company_id", body.companyId).eq("status", "pending").not("provider_ref", "is", null)
    .gte("created_at", since).order("created_at", { ascending: false }).limit(30);
  let paid = 0;
  for (const row of rows ?? []) if ((await refresh(db, row, cfg)).status === "paid") paid++;
  return json({ ok: true, checked: rows?.length ?? 0, paid });
}

async function handleCheckout(body: Row) {
  const db = admin();
  const link = await portalLink(db, String(body.token ?? ""));
  if (!link) return json({ error: NOT_FOUND }, 404);
  const { data: cfg } = await db.from("payment_settings").select("*").eq("company_id", link.company_id).maybeSingle();
  if (!cfg) return json({ error: "Online payment isn't available for this account." }, 409);
  const returnUrl = safeReturn(body.returnUrl);
  if (!returnUrl) return json({ error: "Invalid return address." }, 400);

  const invoiceId = String(body.invoiceId ?? "").slice(0, 80);
  const doc = await dueOn(db, link.company_id, String(link.customer_id), invoiceId);
  if (!doc) return json({ error: "That invoice could not be found." }, 404);
  if (!(doc.due > 0.005)) return json({ error: "This invoice is already paid.", code: "PAID" }, 409);

  // An open checkout for the same amount is reused, so going back and
  // pressing Pay again doesn't pile up checkouts at the provider.
  const recent = new Date(Date.now() - 12 * 3600000).toISOString();
  const { data: open } = await db.from("online_payments").select("*")
    .eq("company_id", link.company_id).eq("invoice_id", invoiceId).eq("status", "pending")
    .eq("provider", cfg.provider).gte("created_at", recent).order("created_at", { ascending: false }).limit(1);
  const reuse = (open ?? []).find((r) => Number(r.amount) === doc.due && r.checkout_url);
  if (reuse) return json({ url: reuse.checkout_url, paymentId: reuse.id });

  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count } = await db.from("online_payments").select("id", { count: "exact", head: true })
    .eq("company_id", link.company_id).gte("created_at", hourAgo);
  if ((count ?? 0) >= 60) return json({ error: "Too many payment attempts. Try again in an hour." }, 429);

  const { data: row, error } = await db.from("online_payments").insert({
    company_id: link.company_id, invoice_id: invoiceId, invoice_number: doc.number, customer_id: String(link.customer_id),
    provider: cfg.provider, amount: doc.due, currency: doc.currency,
  }).select().single();
  if (error || !row) return json({ error: "Could not start the payment. Try again later." }, 500);

  const back = `${returnUrl}?portal=${encodeURIComponent(link.token)}`;
  const res = await call(createRequest(cfg.provider, cfg.secret_key, {
    amount: doc.due,
    currency: doc.currency,
    description: `${doc.companyName ? `${doc.companyName} — ` : ""}Invoice ${doc.number}`,
    successUrl: `${back}&paid=${row.id}`,
    cancelUrl: `${back}&invoice=${encodeURIComponent(invoiceId)}`,
    callbackUrl: `${SUPABASE_URL}/functions/v1/pay?callback=${cfg.provider}`,
    reference: row.id,
  }));
  if (!res.ok) {
    await db.from("online_payments").delete().eq("id", row.id);
    return json({ error: readError(res.body, res.status) }, 502);
  }
  const c = readCheckout(cfg.provider, res.body);
  await db.from("online_payments").update({ provider_ref: c.ref, checkout_url: c.url }).eq("id", row.id);
  return json({ url: c.url, paymentId: row.id });
}

async function handleConfirm(body: Row) {
  const db = admin();
  const link = await portalLink(db, String(body.token ?? ""));
  if (!link) return json({ error: NOT_FOUND }, 404);
  const id = String(body.paymentId ?? "");
  if (!UUID.test(id)) return json({ error: "Unknown payment." }, 404);
  const { data: row } = await db.from("online_payments").select("*").eq("id", id)
    .eq("company_id", link.company_id).eq("customer_id", String(link.customer_id)).maybeSingle();
  if (!row) return json({ error: "Unknown payment." }, 404);
  const out = await refresh(db, row);
  return json({ status: out.status, amount: out.paid_amount ?? out.amount, currency: out.currency, invoiceNumber: out.invoice_number });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const provider = new URL(req.url).searchParams.get("callback");
  if (provider) return handleCallback(provider, req);

  let body: Row;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  switch (body?.action) {
    case "status": return handleStatus(req, body);
    case "configure": return handleConfigure(req, body);
    case "refresh": return handleRefresh(req, body);
    case "checkout": return handleCheckout(body);
    case "confirm": return handleConfirm(body);
    default: return json({ error: "Unknown action" }, 400);
  }
});
