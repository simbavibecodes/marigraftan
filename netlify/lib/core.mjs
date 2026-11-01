// Shared logic for the guest functions: the private guest list, name matching and tokens.
// The guest list is stored encrypted in guests.enc.mjs; GUEST_KEY (a Netlify environment variable) unlocks it.
import { createDecipheriv, createHmac, createHash, timingSafeEqual } from "node:crypto";
import { ENCRYPTED_GUESTS } from "./guests.enc.mjs";

let cache = null;

function keyBytes() {
  const k = process.env.GUEST_KEY || "";
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("GUEST_KEY is missing or not 32 bytes");
  return buf;
}

export function loadParties() {
  if (cache) return cache;
  const raw = Buffer.from(ENCRYPTED_GUESTS, "base64");
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), data = raw.subarray(28);
  const d = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  d.setAuthTag(tag);
  const json = Buffer.concat([d.update(data), d.final()]).toString("utf8");
  cache = JSON.parse(json).map(withCandidates);
  return cache;
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
export function matchName(raw) {
  const input = normalize(raw);
  if (input.split(" ").filter(Boolean).length < 2) return { status: "last" };
  const scored = loadParties().map((p) => {
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
function tokenKey() { return createHash("sha256").update("mg-token:").update(keyBytes()).digest(); }
export function makeToken(id) {
  const sig = createHmac("sha256", tokenKey()).update(id).digest("base64url").slice(0, 24);
  return Buffer.from(id).toString("base64url") + "." + sig;
}
export function readToken(token) {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig) return null;
  const id = Buffer.from(b, "base64url").toString("utf8");
  const want = createHmac("sha256", tokenKey()).update(id).digest("base64url").slice(0, 24);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  return loadParties().find((p) => p.id === id) || null;
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

// Sends a submission to one of the site's Netlify Forms, which emails Mari.
export async function notify(origin, form, fields) {
  const body = new URLSearchParams({ "form-name": form, ...fields });
  try {
    await fetch(origin + "/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  } catch (e) { console.error("notify failed", form, e); }
}

export function storeName(context) {
  const ctx = context && context.deploy && context.deploy.context;
  return ctx === "production" ? "rsvps" : "rsvps-test";
}
