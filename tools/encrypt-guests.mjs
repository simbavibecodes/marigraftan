// Turns the guest list CSV (exported from the Google Sheet) into the encrypted file the site's functions read.
// Usage: GUEST_KEY=<base64 key> node tools/encrypt-guests.mjs path/to/guests.csv
// The CSV and the key never go into this repository.
import { readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function members(full) {
  const parts = full.split("&").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (parts.length === 1) return [parts[0]];
  const last = parts[parts.length - 1].split(" ").slice(-1)[0];
  return parts.map((p) => (p.split(" ").length === 1 ? p + " " + last : p));
}

const [, , csvPath] = process.argv;
const key = Buffer.from(process.env.GUEST_KEY || "", "base64");
if (!csvPath || key.length !== 32) { console.error("Usage: GUEST_KEY=<base64 32-byte key> node tools/encrypt-guests.mjs guests.csv"); process.exit(1); }

const rows = parseCSV(readFileSync(csvPath, "utf8"));
const head = rows.shift().map((h) => h.trim().toLowerCase());
const col = (name) => head.findIndex((h) => h.startsWith(name));
const C = { name: col("full name"), alt: col("other spellings"), group: col("group"), lang: col("site language"), plus: col("plus-one allowed"), plusName: col("plus-one name") };

const seen = new Set();
const parties = rows.map((r) => {
  const display = (r[C.name] || "").trim().replace(/\s+/g, " ");
  if (!display) return null;
  const ms = members(display).map((full) => ({ full, first: full.split(" ")[0] }));
  let id = slug(display); while (seen.has(id)) id += "-2"; seen.add(id);
  return {
    id, display, short: ms.map((m) => m.first).join(" & "), members: ms,
    aliases: (r[C.alt] || "").split(",").map((s) => s.trim()).filter(Boolean),
    group: (r[C.group] || "american").trim().toLowerCase(),
    lang: /georg|ქარ/i.test(r[C.lang] || "") ? "ka" : "en",
    plusOne: /^y/i.test((r[C.plus] || "").trim()),
    plusOneName: (r[C.plusName] || "").trim()
  };
}).filter(Boolean);

const iv = randomBytes(12);
const c = createCipheriv("aes-256-gcm", key, iv);
const data = Buffer.concat([c.update(JSON.stringify(parties), "utf8"), c.final()]);
const blob = Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
writeFileSync(new URL("../netlify/lib/guests.enc.mjs", import.meta.url),
  "// Encrypted guest list. Regenerate with tools/encrypt-guests.mjs; unreadable without GUEST_KEY.\nexport const ENCRYPTED_GUESTS = \"" + blob + "\";\n");
console.log(parties.length + " parties encrypted");
