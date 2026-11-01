// Shared logic for the guest functions: the guest list, name matching, tokens and the Google Sheet link.
// The guest list lives in Mari's Google Sheet. The site reads it through the sheet's Apps Script web app and keeps
// it for a minute; guests.mjs is a fallback copy if the sheet can't be reached.
// Two Netlify environment variables, set by Mari in the Netlify dashboard (never stored in this repository):
//   SHEET_URL    the Apps Script web app link (ends in /exec)
//   TOKEN_SECRET any long private phrase; it signs the "remember me" token saved on each guest's phone
import { createHmac, timingSafeEqual } from "node:crypto";
import { FALLBACK_ROWS } from "./guests.mjs";

const SHEET_URL = (process.env.SHEET_URL || "").trim();
function secret() {
  const s = process.env.TOKEN_SECRET || "";
  if (s.length < 16) throw new Error("TOKEN_SECRET is missing or too short");
  return s;
}

let cache = null, cachedAt = 0;

/* ---------- Guest list ---------- */
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function members(full) {
  const parts = full.split("&").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (parts.length === 1) return [parts[0]];
  const last = parts[parts.length - 1].split(" ").slice(-1)[0];
  return parts.map((p) => (p.split(" ").length === 1 ? p + " " + last : p));
}

// Turns the sheet's rows (header first) into invitations ("parties").
export function partiesFromRows(rows) {
  const [head = [], ...body] = rows || [];
  const h = head.map((x) => String(x).trim().toLowerCase());
  const col = (name) => h.findIndex((x) => x.startsWith(name));
  const C = { name: col("full name"), alt: col("other spellings"), group: col("group"), lang: col("site language"), plus: col("plus-one allowed"), plusName: col("plus-one name") };
  if (C.name < 0) return [];
  const seen = new Set();
  return body.map((r) => {
    const display = String(r[C.name] || "").trim().replace(/\s+/g, " ");
    if (!display) return null;
    const ms = members(display).map((full) => ({ full, first: full.split(" ")[0] }));
    let id = slug(display) || "guest"; while (seen.has(id)) id += "-2"; seen.add(id);
    const get = (k) => (C[k] >= 0 ? String(r[C[k]] || "").trim() : "");
    return {
      id, display, short: ms.map((m) => m.first).join(" & "), members: ms,
      aliases: get("alt").split(",").map((s) => s.trim()).filter(Boolean),
      group: (get("group") || "american").toLowerCase(),
      lang: /georg|ქარ/i.test(get("lang")) ? "ka" : "en",
      plusOne: /^y/i.test(get("plus")), plusOneName: get("plusName")
    };
  }).filter(Boolean).map(withCandidates);
}

export async function loadParties() {
  if (cache && Date.now() - cachedAt < 60000) return cache;
  if (SHEET_URL) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(SHEET_URL + "?action=guests", { signal: ctl.signal, redirect: "follow" });
      clearTimeout(t);
      const data = await res.json();
      const parties = data && data.ok ? partiesFromRows(data.rows) : [];
      if (parties.length) { cache = parties; cachedAt = Date.now(); return cache; }
    } catch (e) { console.error("sheet read failed", e); }
  }
  if (cache) return cache;
  cache = partiesFromRows(FALLBACK_ROWS); cachedAt = Date.now() - 50000;
  return cache;
}

// Sends a reply or a not-found note to the sheet, which also emails Mari.
export async function toSheet(payload) {
  if (!SHEET_URL) return;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    await fetch(SHEET_URL, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(payload), signal: ctl.signal, redirect: "follow" });
    clearTimeout(t);
  } catch (e) { console.error("sheet write failed", payload.type, e); }
}

/* ---------- Names ---------- */
const GEO = { "ა":"a","ბ":"b","გ":"g","დ":"d","ე":"e","ვ":"v","ზ":"z","თ":"t","ი":"i","კ":"k","ლ":"l","მ":"m","ნ":"n","ო":"o","პ":"p","ჟ":"zh","რ":"r","ს":"s","ტ":"t","უ":"u","ფ":"p","ქ":"k","ღ":"gh","ყ":"q","შ":"sh","ჩ":"ch","ც":"ts","ძ":"dz","წ":"ts","ჭ":"ch","ხ":"kh","ჯ":"j","ჰ":"h" };

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[ა-ჰ]/g, (c) => GEO[c] || "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter((t) => t && t !== "and").join(" ");
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function ratio(a, b) { const L = Math.max(a.length, b.length) || 1; return 1 - lev(a, b) / L; }

function withCandidates(p) {
  const c = new Set();
  const lastOf = (full) => full.split(" ").slice(-1)[0];
  for (const m of p.members) {
    const full = normalize(m.full);
    c.add(full);
    const t = full.split(" ");
    if (t.length >= 2) c.add([t[t.length - 1], ...t.slice(0, -1)].join(" "));
  }
  c.add(normalize(p.display));
  for (const alt of p.aliases || []) {
    const a = normalize(alt);
    if (!a) continue;
    if (a.split(" ").length === 1) { for (const m of p.members) c.add(a + " " + lastOf(normalize(m.full))); }
    else c.add(a);
  }
  return { ...p, candidates: [...c] };
}

function scoreAgainst(input, cand) {
  const t = input.split(" ");
  const forms = t.length > 2 ? [input, t[0] + " " + t[t.length - 1]] : [input];
  let best = 0;
  for (const f of forms) {
    let s = ratio(f, cand);
    // Both the first and last names must be close on their own, so relatives who share
    // a last name (or friends who share a first name) are not matched to each other.
    const a = f.split(" "), b = cand.split(" ");
    if (a.length >= 2 && b.length >= 2) {
      if (ratio(a[0], b[0]) < 0.65 || ratio(a[a.length - 1], b[b.length - 1]) < 0.6) s = Math.min(s, 0.7);
    }
    best = Math.max(best, s);
  }
  return best;
}

// Returns {status:"found", party, member} | {status:"last"} | {status:"ambiguous"} | {status:"none", closest, score}
export async function matchName(raw) {
  const input = normalize(raw);
  if (input.split(" ").filter(Boolean).length < 2) return { status: "last" };
  const scored = (await loadParties()).map((p) => {
    let s = 0;
    for (const c of p.candidates) s = Math.max(s, scoreAgainst(input, c));
    return { p, s };
  }).sort((a, b) => b.s - a.s);
  const [first, second] = scored;
  const THRESHOLD = 0.78;
  if (!first || first.s < THRESHOLD) return { status: "none", closest: first ? first.p.display : "", score: first ? first.s : 0 };
  if (second && second.s >= THRESHOLD && first.s - second.s < 0.04) return { status: "ambiguous" };
  return { status: "found", party: first.p, score: first.s };
}

/* ---------- Tokens ---------- */
const sign = (id) => createHmac("sha256", secret()).update(id).digest("base64url").slice(0, 24);
export function makeToken(id) { return Buffer.from(id).toString("base64url") + "." + sign(id); }
export async function readToken(token) {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig) return null;
  const id = Buffer.from(b, "base64url").toString("utf8"), want = sign(id);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  return (await loadParties()).find((p) => p.id === id) || null;
}

// What the browser is allowed to know about a party.
export function publicParty(p) {
  return { display: p.display, short: p.short, members: p.members.map((m) => ({ first: m.first, full: m.full })),
           plusOne: !!p.plusOne, plusOneName: p.plusOneName || "", group: p.group, lang: p.lang };
}

/* ---------- Helpers ---------- */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export function storeName(context) {
  const ctx = context && context.deploy && context.deploy.context;
  return ctx === "production" ? "rsvps" : "rsvps-test";
}
