// AI assistant proxy.
//
// Lets a cloud-linked company use the in-app assistant without any API key in
// the browser. The key lives only in this function's secrets
// (`supabase secrets set ANTHROPIC_API_KEY=...`); the caller must be signed in
// and a member of the company it names. Deploy with:
//
//   supabase functions deploy ai-chat
//
// The request body is { companyId, model, system, messages } — the same shape
// the assistant already builds for a direct call.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// Only these models can be requested, so a caller can't run up the bill on
// something the settings screen never offered.
const MODELS: Record<string, number> = {
  // model id → max_tokens for one reply (thinking counts toward it)
  "claude-haiku-4-5": 4096,
  "claude-haiku-4-5-20251001": 4096,
  "claude-sonnet-5": 16000,
  "claude-sonnet-4-6": 16000,
  "claude-opus-5": 16000,
  "claude-opus-4-8": 16000,
};
const MAX_MESSAGES = 40;
const MAX_CHARS = 60_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Who is asking — checked with their own token, so row-level security
  // decides membership exactly as it does for their data.
  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Sign in to use the assistant." }, 401);

  let body: { companyId?: string; model?: string; system?: string; messages?: Anthropic.MessageParam[] };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { companyId, model = "claude-haiku-4-5", system = "", messages = [] } = body;

  if (!companyId) return json({ error: "companyId is required" }, 400);
  const { data: member } = await supabase
    .from("company_members").select("role").eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
  if (!member) return json({ error: "You are not a member of this company." }, 403);

  const maxTokens = MODELS[model];
  if (!maxTokens) return json({ error: `Model not allowed: ${model}` }, 400);
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return json({ error: "Send between 1 and 40 messages." }, 400);
  }
  if (JSON.stringify(messages).length + system.length > MAX_CHARS) {
    return json({ error: "The conversation is too long. Clear the chat and try again." }, 413);
  }

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    });
    if (response.stop_reason === "refusal") {
      return json({ reply: "I can't help with that request." });
    }
    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return json({ reply: reply || "No response received.", stopReason: response.stop_reason });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "The assistant is busy. Try again in a minute." }, 429);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "The server's API key is not set up correctly." }, 500);
    if (error instanceof Anthropic.BadRequestError) return json({ error: error.message }, 400);
    if (error instanceof Anthropic.APIError) return json({ error: `Assistant error (${error.status}).` }, 502);
    return json({ error: "Could not reach the assistant." }, 502);
  }
});
