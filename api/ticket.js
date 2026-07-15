// GET /api/ticket?id=<TICKET_ID>
// Looks up one lock ticket's details from Redash (query 562171) and returns a small JSON.
// The Redash API key lives ONLY here, as a Vercel env var. It is never sent to the browser.

const REDASH_BASE = "https://jarvis.urbanclap.com/api/queries/562171/results.json";

// Simple in-memory cache so we don't pull the 63k-row payload on every lookup.
let CACHE = { at: 0, rows: null };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanCity(raw) {
  if (!raw) return "";
  return String(raw).replace(/^city_/i, "").replace(/_v\d+$/i, "").replace(/_/g, " ").trim();
}
function cleanSku(raw) {
  if (!raw) return "";
  return String(raw).split("•")[0].trim();
}

async function loadRows() {
  const now = Date.now();
  if (CACHE.rows && now - CACHE.at < CACHE_TTL_MS) return CACHE.rows;

  const key = process.env.REDASH_API_KEY;
  if (!key) throw new Error("REDASH_API_KEY not configured");

  const res = await fetch(`${REDASH_BASE}?api_key=${encodeURIComponent(key)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NativeLocksSOP/1.0)",
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Redash responded ${res.status}${body ? ": " + body.slice(0, 180) : ""}`);
  }
  const data = await res.json();
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
