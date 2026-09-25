// Checking and laying out an email. No network, no Deno APIs: the app's unit
// tests import this file directly (test/emailServer.test.js).
//
// The app never sends HTML. It sends plain text, an optional short table of
// figures and an optional button link, and the email is built here — so the
// function can't be used to send arbitrary HTML under the company's name.

export type EmailRequest = {
  companyId?: string;
  to?: string | string[];
  cc?: string | string[];
  replyTo?: string;
  fromName?: string;
  subject?: string;
  message?: string;
  summary?: { label: string; value: string }[];
  link?: { url: string; label: string };
  docKind?: string;
  docRef?: string;
  lang?: string;
};

export type CleanEmail = {
  to: string[];
  cc: string[];
  replyTo: string;
  fromName: string;
  subject: string;
  message: string;
  summary: { label: string; value: string }[];
  link: { url: string; label: string } | null;
  docKind: string;
  docRef: string;
  rtl: boolean;
};

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const MAX_RECIPIENTS = 5;
const oneLine = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

/** Check a request. Returns { email } or { error } with a message a person can read. */
export function validateEmail(body: EmailRequest, { allowedLinkOrigin = "" } = {}): { email?: CleanEmail; error?: string } {
  const to = list(body.to);
  const cc = list(body.cc);
  if (!to.length) return { error: "Add at least one email address to send to." };
  if (to.length + cc.length > MAX_RECIPIENTS) return { error: `Send to at most ${MAX_RECIPIENTS} addresses at once.` };
  const bad = [...to, ...cc].find((a) => !EMAIL.test(a));
  if (bad) return { error: `This is not a valid email address: ${bad}` };
  const replyTo = oneLine(body.replyTo, 200).toLowerCase();
  if (replyTo && !EMAIL.test(replyTo)) return { error: `The reply-to address is not valid: ${replyTo}` };

  const subject = oneLine(body.subject, 200);
  if (!subject) return { error: "The email needs a subject." };
  const message = String(body.message ?? "").replace(/\r\n/g, "\n").trim();
  if (!message) return { error: "The email needs a message." };
  if (message.length > 20_000) return { error: "The message is too long." };

  const summary = (Array.isArray(body.summary) ? body.summary : []).slice(0, 20)
    .map((r) => ({ label: oneLine(r?.label, 80), value: oneLine(r?.value, 120) }))
    .filter((r) => r.label || r.value);

  let link: CleanEmail["link"] = null;
  if (body.link?.url) {
    let url: URL;
    try { url = new URL(String(body.link.url)); } catch { return { error: "The link in the email is not a valid address." }; }
    if (url.protocol !== "https:") return { error: "Links in emails must start with https://" };
    if (allowedLinkOrigin && !url.href.startsWith(allowedLinkOrigin)) return { error: "Links in emails must point to the app." };
    link = { url: url.href, label: oneLine(body.link.label, 60) || "Open" };
  }

  return {
    email: {
      to, cc, replyTo, subject, message, summary, link,
      fromName: oneLine(body.fromName, 80).replace(/["<>]/g, ""),
      docKind: oneLine(body.docKind, 40),
      docRef: oneLine(body.docRef, 80),
      rtl: body.lang === "ar",
    },
  };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "Name <addr>" from the configured sender address, with the company's name shown. */
export function fromHeader(configured: string, fromName: string) {
  const m = configured.match(/<([^>]+)>/);
  const address = (m ? m[1] : configured).trim();
  return fromName ? `"${fromName}" <${address}>` : configured;
}

/** A plain, readable HTML email: the message, the figures, one button. */
export function renderHtml(e: CleanEmail) {
  const dir = e.rtl ? "rtl" : "ltr";
  const align = e.rtl ? "right" : "left";
  const paras = escapeHtml(e.message).split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const rows = e.summary.map((r) =>
    `<tr><td style="padding:6px 0;color:#475569">${escapeHtml(r.label)}</td>` +
    `<td style="padding:6px 0;text-align:${e.rtl ? "left" : "right"};font-weight:600;color:#0f172a">${escapeHtml(r.value)}</td></tr>`).join("");
  const table = rows
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:6px 0 18px">${rows}</table>`
    : "";
  const button = e.link
    ? `<p style="margin:8px 0 18px"><a href="${escapeHtml(e.link.url)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(e.link.label)}</a></p>`
    : "";
  return `<!doctype html><html dir="${dir}"><body style="margin:0;background:#f1f5f9;padding:24px 12px">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font:15px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1e293b;text-align:${align}">` +
    `${paras}${table}${button}</div></body></html>`;
}

/** The same email as plain text, for clients that don't show HTML. */
export function renderText(e: CleanEmail) {
  const rows = e.summary.map((r) => `${r.label}: ${r.value}`).join("\n");
  return [e.message, rows, e.link ? `${e.link.label}: ${e.link.url}` : ""].filter(Boolean).join("\n\n");
}
