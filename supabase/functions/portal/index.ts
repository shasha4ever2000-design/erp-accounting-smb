// The customer portal: a customer opens their secret link and sees their own
// invoices, what they have paid and what is still due. No sign-in.
//
// Deploy without the sign-in check, since customers have no account:
//
//   supabase functions deploy portal --no-verify-jwt
//
// Safety: the token is a random UUID that only the company can hand out and
// revoke (table portal_links). The function reads with the service role, but
// only the one company and the one customer the token names, and passes the
// result through shapePortal, which keeps just what a printed invoice shows.
import { createClient } from "npm:@supabase/supabase-js@2";
import { shapePortal } from "./shape.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "This link is not valid any more. Ask the company for a new one.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let token = "";
  try { token = String((await req.json())?.token ?? ""); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!UUID.test(token)) return json({ error: NOT_FOUND }, 404);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: link } = await db.from("portal_links").select("*").eq("token", token).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) {
    return json({ error: NOT_FOUND }, 404);
  }

  const records = (entity: string) => db.from("records").select("data")
    .eq("company_id", link.company_id).eq("entity", entity).eq("deleted", false);
  const [settingsRes, customerRes, invoicesRes, notesRes] = await Promise.all([
    records("settings").eq("record_id", "singleton").maybeSingle(),
    records("customers").eq("record_id", link.customer_id).maybeSingle(),
    records("invoices").eq("data->>customerId", link.customer_id).limit(2000),
    records("creditNotes").eq("data->>customerId", link.customer_id).limit(2000),
  ]);
  if (settingsRes.error || invoicesRes.error || notesRes.error) return json({ error: "Could not load your account. Try again later." }, 500);

  await db.from("portal_links").update({ last_opened_at: new Date().toISOString() }).eq("token", token);

  const today = new Date().toISOString().slice(0, 10);
  return json(shapePortal({
    settings: settingsRes.data?.data ?? {},
    customer: customerRes.data?.data ?? { id: link.customer_id, name: link.customer_name },
    invoices: (invoicesRes.data ?? []).map((r) => r.data),
    creditNotes: (notesRes.data ?? []).map((r) => r.data),
    today,
  }));
});
