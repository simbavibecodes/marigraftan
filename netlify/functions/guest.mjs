// Finds a guest by the name they type (or by the token saved on their phone) and returns only their own invitation.
import { getStore } from "@netlify/blobs";
import { matchName, makeToken, readToken, publicParty, json, toSheet, storeName } from "../lib/core.mjs";

export const config = { path: "/api/guest" };

async function replyFor(context, id) {
  try { return await getStore(storeName(context)).get(id, { type: "json" }); } catch (e) { console.error(e); return null; }
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "body" }, 400); }
  const name = String(body.name || "").slice(0, 120);
  const lang = body.lang === "ka" ? "ka" : "en";
  const test = storeName(context) !== "rsvps";

  // Returning visitor: the phone remembers a signed token.
  if (body.token) {
    const p = await readToken(body.token);
    if (!p) return json({ found: false, reason: "token" });
    const saved = await replyFor(context, p.id);
    return json({ found: true, token: body.token, party: publicParty(p), reply: saved ? saved.reply : null });
  }

  // "We couldn't find you" follow-up with an email or phone number.
  if (body.contact) {
    const m = await matchName(name);
    await toSheet({ type: "notfound", typed: (test ? "[TEST] " : "") + name, contact: String(body.contact).slice(0, 160),
      closest: m.closest || (m.party ? m.party.display : ""), score: m.score ? m.score.toFixed(2) : "", lang, kind: "Left contact details" });
    return json({ ok: true });
  }

  const m = await matchName(name);
  if (m.status === "found") {
    const saved = await replyFor(context, m.party.id);
    return json({ found: true, token: makeToken(m.party.id), party: publicParty(m.party), reply: saved ? saved.reply : null });
  }
  if (m.status === "none") {
    await toSheet({ type: "notfound", typed: (test ? "[TEST] " : "") + name, contact: "", closest: m.closest,
      score: m.score.toFixed(2), lang, kind: "Name not found" });
  }
  return json({ found: false, reason: m.status });
};
