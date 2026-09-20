// Fetches Wyel's published Daily_Tracker CSV and aggregates it into data/wyel.json.
// Runs server-side in GitHub Actions, so there is no CORS involved.
//
// Config: set the repository variable WYEL_CSV_URL
//   Repo → Settings → Secrets and variables → Actions → Variables → New repository variable
// It is a *variable*, not a secret, because the URL is already public.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const CSV_URL = process.env.WYEL_CSV_URL;
const OUT = "data/wyel.json";

if (!CSV_URL) {
  console.error("WYEL_CSV_URL is not set — nothing to sync.");
  console.error("Set it under Settings → Secrets and variables → Actions → Variables.");
  process.exit(0); // not a failure: the site still works, Wyel's panel just stays empty
}

/* ---------- CSV parsing (handles quoted fields and embedded commas) ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/* ---------- date normalising ---------- */
function toISODate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // 2026-06-02 or 2026/06/02
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;

  // 6/2/2026 — Google publishes US order for this sheet's locale
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;

  const d = new Date(s);
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function minutesFrom(raw) {
  const n = Number(String(raw || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/* ---------- clock time out of a Start_Time cell ----------
   The sheet mixes formats: "6/2/2026 15:10:00" on older rows,
   "2026-09-19 13:40:00" on newer ones. Only the time part is needed. */
function minutesOfDayFrom(raw) {
  const m = String(raw || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = (m[4] || "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/* ---------- column lookup by header name, with positional fallback ---------- */
function columnIndexes(header) {
  const norm = header.map((h) => String(h).trim().toLowerCase().replace(/[:\s]+$/, ""));
  const find = (...names) => {
    for (const n of names) {
      const i = norm.indexOf(n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  return {
    date: find("date"),
    minutes: find("total_minutes", "total minutes", "minutes"),
    topic: find("topic_category", "topic category", "topic"),
    start: find("start_time", "start time", "start")
  };
}

/* ---------- main ---------- */
const res = await fetch(CSV_URL, { redirect: "follow" });
if (!res.ok) {
  console.error(`Fetch failed: HTTP ${res.status}. Is the tab still published to the web?`);
  process.exit(1);
}
const text = await res.text();

if (/<html/i.test(text.slice(0, 400))) {
  console.error("Got HTML rather than CSV — the publish link is probably wrong or was revoked.");
  console.error("Wyel: File → Share → Publish to web → Daily_Tracker → CSV.");
  process.exit(1);
}

const rows = parseCSV(text);
if (rows.length < 2) {
  console.error("CSV had no data rows.");
  process.exit(1);
}

const header = rows[0];
let idx = columnIndexes(header);
if (idx.date === -1 || idx.minutes === -1) {
  console.warn("Header names not recognised, falling back to column positions (A=date, D=minutes, F=topic).");
  console.warn("Header was:", JSON.stringify(header));
  idx = { date: 0, minutes: 3, topic: 5, start: 1 };
}

const daily = {};          // "YYYY-MM-DD" -> minutes
const topics = {};         // topic -> total minutes
const hourly = {};         // "YYYY-MM-DD" -> 24 numbers, recent days only
let used = 0, skipped = 0, timed = 0;

// Keep the hourly breakdown small: only days recent enough to be looked at.
const HOURLY_WINDOW_DAYS = 60;
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - HOURLY_WINDOW_DAYS);
const cutoffISO = cutoff.toISOString().slice(0, 10);

for (const r of rows.slice(1)) {
  const day = toISODate(r[idx.date]);
  const mins = minutesFrom(r[idx.minutes]);
  if (!day || !mins) { skipped++; continue; }

  daily[day] = (daily[day] || 0) + mins;
  const topic = idx.topic >= 0 ? String(r[idx.topic] || "").trim() : "";
  if (topic) topics[topic] = (topics[topic] || 0) + mins;
  used++;

  // Spread the session across the clock hours it actually spans, the same way
  // the site does for Aidan's timer, so the two are directly comparable.
  if (idx.start >= 0 && day >= cutoffISO) {
    const from = minutesOfDayFrom(r[idx.start]);
    if (from !== null) {
      const to = from + mins;
      const buckets = hourly[day] || (hourly[day] = new Array(24).fill(0));
      for (let h = Math.floor(from / 60); h <= Math.min(23, Math.floor((to - 1) / 60)); h++) {
        const overlap = Math.min(to, (h + 1) * 60) - Math.max(from, h * 60);
        if (overlap > 0) buckets[h] += overlap;
      }
      timed++;
    }
  }
}

const days = Object.keys(daily).sort();
const payload = {
  updatedAt: new Date().toISOString(),
  rowsInSheet: rows.length - 1,
  sessionsUsed: used,
  rowsSkipped: skipped,
  firstDay: days[0] || null,
  lastDay: days[days.length - 1] || null,
  totalMinutes: Object.values(daily).reduce((a, b) => a + b, 0),
  timedSessions: timed,
  hourlyWindowDays: HOURLY_WINDOW_DAYS,
  daily,
  topics,
  hourly
};

// Only rewrite when something actually changed, so the repo isn't full of empty commits.
let previous = null;
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch {}
if (previous) {
  const same = JSON.stringify({ ...previous, updatedAt: null }) ===
               JSON.stringify({ ...payload, updatedAt: null });
  if (same) {
    console.log("No change since last sync.");
    process.exit(0);
  }
}

// writeFile creates the file but not its folder, and data/ may not exist yet.
await mkdir("data", { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(
  `Synced ${used} sessions across ${days.length} days ` +
  `(${(payload.totalMinutes / 60).toFixed(1)}h total, ${skipped} rows skipped, ` +
  `${timed} with a usable start time).`
);
