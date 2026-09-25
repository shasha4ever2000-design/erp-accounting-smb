// Sends an invoice, statement or payment reminder by email, from the app.
//
// The email service's key never reaches the browser: it lives in this
// function's secrets. One-time setup (see docs/EMAIL-AND-PORTAL.md):
//
//   supabase secrets set RESEND_API_KEY=re_...
//   supabase secrets set EMAIL_FROM="Billing <billing@your-domain.com>"
//   supabase functions deploy send-email
//
// Optional: EMAIL_DAILY_LIMIT (default 200 per company per day) and APP_URL
// (when set, links in emails must point there).
//
// The caller must be signed in and an owner, admin or member of the company.
// Every attempt, sent or failed, is written to email_log.
import { createClient } from "npm:@supabase/supabase-js@2";
import { validateEmail, renderHtml, renderText, fromHeader, type EmailRequest } from "./render.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!apiKey || !from) return json({ error: "Email sending is not set up on the server yet.", code: "NOT_CONFIGURED" }, 501);

  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Sign in to send email." }, 401);

  let body: EmailRequest;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.companyId) return json({ error: "companyId is required" }, 400);

  const { data: member } = await userClient
    .from("company_members").select("role").eq("company_id", body.companyId).eq("user_id", user.id).maybeSingle();
  if (!member) return json({ error: "You are not a member of this company." }, 403);
  if (member.role === "viewer") return json({ error: "Viewers can't send email." }, 403);

  const { email, error } = validateEmail(body, { allowedLinkOrigin: Deno.env.get("APP_URL") ?? "" });
  if (!email) return json({ error }, 400);

  // The log is written with the service role: members may read it, never write it.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const limit = Number(Deno.env.get("EMAIL_DAILY_LIMIT") ?? 200);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin.from("email_log").select("id", { count: "exact", head: true })
    .eq("company_id", body.companyId).gte("created_at", since);
  if ((count ?? 0) >= limit) return json({ error: `The daily limit of ${limit} emails has been reached. Try again tomorrow.` }, 429);

  const log = (status: "sent" | "failed", extra: Record<string, unknown>) => admin.from("email_log").insert({
    company_id: body.companyId, sent_by: user.id, to_email: email.to.join(", "), subject: email.subject,
    doc_kind: email.docKind, doc_ref: email.docRef, status, ...extra,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromHeader(from, email.fromName),
        to: email.to,
        cc: email.cc.length ? email.cc : undefined,
        reply_to: email.replyTo || user.email || undefined,
        subject: email.subject,
        html: renderHtml(email),
        text: renderText(email),
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(out?.message || `Email service error (${res.status}).`);
      await log("failed", { error: msg.slice(0, 500) });
      return json({ error: msg }, 502);
    }
    await log("sent", { provider_id: out?.id ?? null });
    return json({ ok: true, id: out?.id ?? null, to: email.to });
  } catch {
    await log("failed", { error: "Could not reach the email service." });
    return json({ error: "Could not reach the email service." }, 502);
  }
});
