// Slack escalation for the Native Locks portal — everything runs server-side (no browser->Slack CORS).
//   POST /api/raise { phase:"post",   text }                          -> posts message, returns { ok, ts }
//   POST /api/raise { phase:"upload", thread_ts, name, dataB64 }      -> uploads one file into the thread
// SLACK_BOT_TOKEN lives ONLY here as a Vercel env var.
// Vercel JSON body limit ~4.5MB, so each base64 file must be < ~4.5MB (< ~3.3MB raw). Photos are fine.

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C07GZK9UKQW";

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

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "POST only" }); return; }
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) { res.status(500).json({ ok: false, error: "SLACK_BOT_TOKEN not configured" }); return; }

  try {
    const body = req.body || {};
    const phase = body.phase || "post";

    if (phase === "post") {
      if (!body.text || !String(body.text).trim()) { res.status(400).json({ ok: false, error: "Empty escalation text" }); return; }
      const posted = await slackJSON("chat.postMessage", token, {
        channel: CHANNEL_ID, text: body.text, unfurl_links: false, unfurl_media: false,
      });
      res.status(200).json({ ok: true, ts: posted.ts });
      return;
    }

    if (phase === "upload") {
      const { thread_ts, name, dataB64 } = body;
      if (!dataB64 || !name) { res.status(400).json({ ok: false, error: "Missing file data" }); return; }
      const bytes = Buffer.from(dataB64, "base64");
      const u = await slackForm("files.getUploadURLExternal", token, { filename: name, length: String(bytes.length) });
      const up = await fetch(u.upload_url, { method: "POST", body: bytes });
      if (!up.ok) throw new Error(`Slack upload PUT ${up.status}`);
      await slackJSON("files.completeUploadExternal", token, {
        files: [{ id: u.file_id, title: name }], channel_id: CHANNEL_ID, thread_ts,
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: "Unknown phase" });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || "Slack raise failed" });
  }
}
