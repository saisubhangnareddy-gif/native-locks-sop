// GET /api/ticket?id=<TICKET_ID>
// Reads lock ticket details from Redash and returns a small JSON.
//
// Uses the POST -> poll -> GET flow (redash-toolbelt "fresh results" pattern):
//   1. POST /api/queries/562171/results { max_age } -> returns a job (or a cached result id)
//   2. poll  /api/jobs/<job_id> until SUCCESS -> gives query_result_id
//   3. GET   /api/query_results/<id>.json?api_key=... -> the rows
// The GET endpoint (#3) works for non-logged-in callers with just the key and is not WAF-blocked.
// If the POST (#1) is blocked, we fall back to FALLBACK_RESULT_ID so lookups keep working.
//
// REDASH_API_KEY (query key) lives ONLY here as a Vercel env var, never in the browser.

const BASE = "https://jarvis.urbanclap.com";
const QUERY_ID = "562171";
const FALLBACK_RESULT_ID = "27995464"; // last known good; used only if POST flow is blocked
const UA = "Mozilla/5.0 (compatible; NativeLocksSOP/1.0)";

let CACHE = { at: 0, rows: null };
const CACHE_TTL_MS = 5 * 60 * 1000;

function cleanCity(raw) {
  if (!raw) return "";
  return String(raw).replace(/^city_/i, "").replace(/_v\d+$/i, "").replace(/_/g, " ").trim();
}
function cleanSku(raw) {
  if (!raw) return "";
  return String(raw).split("•")[0].trim();
}

async function jget(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${res.status}: ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

async function resolveResultId(key) {
  try {
    const res = await fetch(`${BASE}/api/queries/${QUERY_ID}/results?api_key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ max_age: 1800 }),
    });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      if (data.query_result && data.query_result.id) return String(data.query_result.id);
      if (data.job && data.job.id) {
        for (let i = 0; i < 20; i++) {
          const j = await jget(`${BASE}/api/jobs/${data.job.id}?api_key=${encodeURIComponent(key)}`);
          const job = j.job || {};
          if (job.status === 3 && job.query_result_id) return String(job.query_result_id);
          if (job.status === 4 || job.status === 5) break;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
    }
  } catch (e) {}
  return FALLBACK_RESULT_ID;
}

async function loadRows() {
  const now = Date.now();
  if (CACHE.rows && now - CACHE.at < CACHE_TTL_MS) return CACHE.rows;

  const key = process.env.REDASH_API_KEY;
  if (!key) throw new Error("REDASH_API_KEY not configured");

  const resultId = await resolveResultId(key);
  const data = await jget(`${BASE}/api/query_results/${resultId}.json?api_key=${encodeURIComponent(key)}`);
  const rows = (data && data.query_result && data.query_result.data && data.query_result.data.rows) || [];
  CACHE = { at: now, rows };
  return rows;
}

export default async function handler(req, res) {
  try {
    const id = (req.query.id || "").trim();
    if (!id) {
      res.status(400).json({ found: false, error: "Missing ticket id" });
      return;
    }

    const rows = await loadRows();
    const match = rows.find((r) => String(r.TICKET_ID).trim() === id);
    if (!match) {
      res.status(200).json({ found: false });
      return;
    }

    const lockRaw = (match.LOCK_NUMBER || "").trim();
    const hasLock = lockRaw && lockRaw.toLowerCase() !== "not scanned";

    res.status(200).json({
      found: true,
      ticketId: id,
      sku: cleanSku(match.SKU_NAME),
      skuFull: match.SKU_NAME || "",
      lockNumber: hasLock ? lockRaw : null,
      installDate: match.INSTALLATION_DATE || "",
      city: cleanCity(match.CITY),
      rootRequestId: match.ROOT_REQUEST_ID || "",
      sourceOrderId: match.SOURCE_ORDER_ID || "",
      customerRequestId: match.CUSTOMER_REQUEST_ID || "",
    });
  } catch (err) {
    res.status(502).json({ found: false, error: err.message || "Lookup failed" });
  }
}
