// Saves a party's RSVP. One reply per party: sending again updates it.
import { getStore } from "@netlify/blobs";
import { readToken, json, storeName, toSheet } from "../lib/core.mjs";

export const config = { path: "/api/rsvp" };

const FIELDS = ["attending", "who", "arrival", "departure", "plusOne", "plusOneName", "dietary", "dietaryDetails", "note", "lang"];

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "body" }, 400); }
  const p = await readToken(body.token);
  if (!p) return json({ ok: false, error: "token" }, 403);

  const reply = {};
  for (const k of FIELDS) reply[k] = String((body.reply || {})[k] ?? "").slice(0, k === "note" ? 2000 : 300);
  if (reply.attending !== "yes" && reply.attending !== "no") return json({ ok: false, error: "attending" }, 400);
  if (!p.plusOne) { reply.plusOne = ""; reply.plusOneName = ""; }

  const store = getStore(storeName(context));
  const prev = await store.get(p.id, { type: "json" });
  const now = new Date().toISOString();
  const record = {
    party: p.display, reply: { ...reply, sentAt: now },
    firstSentAt: prev ? prev.firstSentAt : now, updatedAt: now,
    history: [...((prev && prev.history) || []), ...(prev ? [prev.reply] : [])].slice(-10)
  };
  await store.setJSON(p.id, record);
  const status = prev ? "updated" : "new";
  // Adds the reply to the "Replies" tab of Mari's sheet and emails her.
  await toSheet({ type: "rsvp", status, party: (storeName(context) === "rsvps" ? "" : "[TEST] ") + p.display, reply: record.reply });
  return json({ ok: true, status, reply: record.reply });
};
