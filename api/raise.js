// Slack escalation for the Native Locks portal.
// Vercel handles only small JSON — the large file BYTES go browser-extension -> Slack directly,
// so there is no Vercel size limit and no browser CORS problem.
//
//   POST /api/raise { phase:"find-thread", orderId, channelTarget }
//        -> finds an existing thread for this order, returns { ok, thread_ts } ("" if none).
//           Uses search.messages (FULL history) when SLACK_USER_TOKEN (xoxp-, search:read)
//           is set; otherwise falls back to a conversations.history scan of the recent
//           ~600 messages (needs the bot scope channels:history / groups:history).
//   POST /api/raise { phase:"post",     text, parentThreadTs? }
//        -> posts the escalation message; if parentThreadTs is given, posts INTO that
//           existing thread (broadcast to channel), returns { ok, ts, thread_root, threaded }
//   POST /api/raise { phase:"reserve",  name, length }
//        -> asks Slack for an upload URL, returns { ok, upload_url, file_id }
//        (the EXTENSION then PUTs the file bytes straight to upload_url)
//   POST /api/raise { phase:"complete", thread_ts, file_id, name }
//        -> attaches the uploaded file into the message thread, returns { ok }
//
// SLACK_BOT_TOKEN lives ONLY here as a Vercel env var. Never sent to the browser.

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C07GZK9UKQW";
// Non-product escalations go to #epc-stores-escalations. Allowlisted so the client
// can only target known channels, never an arbitrary one.
const EPC_CHANNEL_ID = process.env.SLACK_EPC_CHANNEL_ID || "C03KCDYQ3H8";
// Delivery-led non-product escalations go to #native-locks-delivery.
const DELIVERY_CHANNEL_ID = process.env.SLACK_DELIVERY_CHANNEL_ID || "C07PH66FDJM";
const ALLOWED_CHANNELS = { product: CHANNEL_ID, epc: EPC_CHANNEL_ID, delivery: DELIVERY_CHANNEL_ID };
function pickChannel(target) { return ALLOWED_CHANNELS[target] || CHANNEL_ID; }
// Optional USER token (xoxp-…, scope search:read) enables full-history thread search.
// Stored once as a Vercel env var — never sent to the browser, never per-agent.
const USER_TOKEN = process.env.SLACK_USER_TOKEN || "";

async function slackJSON(method, token, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error || "unknown error"}`);
  return data;
}

async function slackForm(method, token, form) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error || "unknown error"}`);
  return data;
}

// Full-history lookup via search.messages. Needs a USER token (search:read) — bot
// tokens cannot search. Covers the ENTIRE channel history (no ~600-message wall), so
// it finds threads for orders escalated months ago. Returns the thread root ts, or "".
async function searchThreadForOrder(userToken, channelId, orderId) {
  const id = String(orderId || "").trim();
  if (!id || !userToken) return "";
  // Scope the search to the channel (by id, so it never breaks on a channel rename)
  // and match the order id as a phrase.
  const query = (channelId ? `in:<#${channelId}> ` : "") + `"${id}"`;
  try {
    const r = await slackForm("search.messages", userToken, { query, count: "20", sort: "timestamp", sort_dir: "asc" });
    const matches = (r && r.messages && r.messages.matches) || [];
    const linkNeedle = "product-order/" + id;
    const tokenRe = new RegExp("(^|[^0-9A-Za-z_])" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^0-9A-Za-z_]|$)");
    for (const m of matches) { // ascending: the earliest (original) thread wins
      const t = m.text || "";
      if (t.indexOf(linkNeedle) !== -1 || tokenRe.test(t)) {
        return m.thread_ts || m.ts; // the thread root for this order
      }
    }
  } catch (e) { /* no search scope / not a member -> caller falls back to the scan */ }
  return "";
}

// Find an existing escalation thread for this order so multiple issues from the same
// customer stay in ONE thread. Prefers search.messages (full history) when a user token
// is configured; otherwise scans recent PARENT messages via conversations.history
// (newest ~600). Best-effort: any failure returns "" so the caller posts a new message.
async function findThreadForOrder(token, channel, orderId, userToken) {
  const id = String(orderId || "").trim();
  if (!id) return "";
  // 1) Full-history search first (if a user token is available).
  const viaSearch = await searchThreadForOrder(userToken, channel, id);
  if (viaSearch) return viaSearch;
  // 2) Fallback: scan the most recent ~600 messages with the bot token.
  const linkNeedle = "product-order/" + id;
  const tokenRe = new RegExp("(^|[^0-9A-Za-z_])" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^0-9A-Za-z_]|$)");
  let cursor = "";
  try {
    for (let page = 0; page < 3; page++) { // up to ~600 recent messages
      const form = { channel, limit: "200" };
      if (cursor) form.cursor = cursor;
      const h = await slackForm("conversations.history", token, form);
      const msgs = (h && h.messages) || [];
      for (const m of msgs) {
        // Only consider top-level messages (thread roots or standalone), never replies.
        if (m.thread_ts && m.thread_ts !== m.ts) continue;
        const t = m.text || "";
        if (t.indexOf(linkNeedle) !== -1 || tokenRe.test(t)) {
          return m.thread_ts || m.ts; // existing thread root
        }
      }
      cursor = (h.response_metadata && h.response_metadata.next_cursor) || "";
      if (!cursor) break;
    }
  } catch (e) { /* no history scope / not in channel -> fall back to new message */ }
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "POST only" }); return; }
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) { res.status(500).json({ ok: false, error: "SLACK_BOT_TOKEN not configured" }); return; }

  try {
    const body = req.body || {};
    const phase = body.phase || "post";
    const channel = pickChannel(body.channelTarget);

    // Look up whether an existing thread already exists for this order id.
    if (phase === "find-thread") {
      const thread_ts = await findThreadForOrder(token, channel, body.orderId, USER_TOKEN);
      res.status(200).json({ ok: true, thread_ts, via: thread_ts ? (USER_TOKEN ? "search-or-scan" : "scan") : "none" });
      return;
    }

    if (phase === "post") {
      if (!body.text || !String(body.text).trim()) { res.status(400).json({ ok: false, error: "Empty escalation text" }); return; }
      let text = body.text;
      let debugLookup = "not-attempted";
      // Resolve the submitter's Slack ID from their email so we can tag them.
      // Requires the bot scope users:read.email. If unavailable, we leave the plain name.
      if (body.submitterEmail && text.includes("{{SUBMITTER}}")) {
        let mention = body.submitterName || "";
        try {
          const u = await slackForm("users.lookupByEmail", token, { email: body.submitterEmail });
          if (u.user && u.user.id) { mention = `<@${u.user.id}>`; debugLookup = "ok:" + u.user.id; }
          else debugLookup = "ok-but-no-user";
        } catch (e) { debugLookup = "error:" + (e.message || "unknown"); }
        text = text.replace("{{SUBMITTER}}", mention);
      } else if (text.includes("{{SUBMITTER}}")) {
        debugLookup = "no-email-or-placeholder(email=" + (body.submitterEmail || "MISSING") + ")";
        text = text.replace("{{SUBMITTER}}", body.submitterName || "");
      }
      // If an existing thread was found for this order, post INTO it (and broadcast to the
      // channel so the new issue is visible), otherwise start a fresh top-level message.
      const parentThreadTs = String(body.parentThreadTs || "").trim();
      const postBody = { channel, text, unfurl_links: false, unfurl_media: false };
      if (parentThreadTs) { postBody.thread_ts = parentThreadTs; postBody.reply_broadcast = true; }
      const posted = await slackJSON("chat.postMessage", token, postBody);
      // The thread root the caller should attach media/summary under.
      const threadRoot = parentThreadTs || posted.ts;
      // Get a permalink so the portal can offer a "Go to Slack message" button.
      // Append thread params so it opens the message's THREAD pane (not just the channel).
      let permalink = "";
      try {
        const pl = await slackForm("chat.getPermalink", token, { channel, message_ts: posted.ts });
        if (pl && pl.permalink) {
          const sep = pl.permalink.indexOf("?") === -1 ? "?" : "&";
          permalink = pl.permalink + sep + "thread_ts=" + encodeURIComponent(threadRoot) + "&cid=" + encodeURIComponent(channel);
        }
      } catch (e) { /* non-fatal */ }
      res.status(200).json({ ok: true, ts: posted.ts, thread_root: threadRoot, threaded: !!parentThreadTs, permalink, debugLookup });
      return;
    }

    // Threaded reply (e.g. the SOP testing summary) posted under the escalation message.
    if (phase === "reply") {
      if (!body.thread_ts) { res.status(400).json({ ok: false, error: "Missing thread_ts" }); return; }
      if (!body.text || !String(body.text).trim()) { res.status(200).json({ ok: true, skipped: true }); return; }
      await slackJSON("chat.postMessage", token, {
        channel, thread_ts: body.thread_ts, text: body.text, unfurl_links: false, unfurl_media: false,
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (phase === "reserve") {
      const { name, length } = body;
      if (!name || !length) { res.status(400).json({ ok: false, error: "Missing file name/length" }); return; }
      const u = await slackForm("files.getUploadURLExternal", token, { filename: name, length: String(length) });
      res.status(200).json({ ok: true, upload_url: u.upload_url, file_id: u.file_id });
      return;
    }

    if (phase === "complete") {
      const { thread_ts, files } = body; // files: [{ file_id, name }]
      if (!Array.isArray(files) || !files.length) { res.status(400).json({ ok: false, error: "No files to attach" }); return; }
      await slackJSON("files.completeUploadExternal", token, {
        files: files.map((f) => ({ id: f.file_id, title: f.name || "proof" })),
        channel_id: channel,
        thread_ts,
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: "Unknown phase" });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || "Slack raise failed" });
  }
}
