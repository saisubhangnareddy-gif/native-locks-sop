// Slack escalation for the Native Locks portal.
// Vercel handles only small JSON — the large file BYTES go browser-extension -> Slack directly,
// so there is no Vercel size limit and no browser CORS problem.
//
//   POST /api/raise { phase:"post",     text }
//        -> posts the escalation message, returns { ok, ts }
//   POST /api/raise { phase:"reserve",  name, length }
//        -> asks Slack for an upload URL, returns { ok, upload_url, file_id }
//        (the EXTENSION then PUTs the file bytes straight to upload_url)
//   POST /api/raise { phase:"complete", thread_ts, file_id, name }
//        -> attaches the uploaded file into the message thread, returns { ok }
//
// SLACK_BOT_TOKEN lives ONLY here as a Vercel env var. Never sent to the browser.

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
      let text = body.text;
      // Resolve the submitter's Slack ID from their email so we can tag them.
      // Requires the bot scope users:read.email. If unavailable, we leave the plain name.
      if (body.submitterEmail && text.includes("{{SUBMITTER}}")) {
        let mention = body.submitterName || "";
        try {
          const u = await slackForm("users.lookupByEmail", token, { email: body.submitterEmail });
          if (u.user && u.user.id) mention = `<@${u.user.id}>`;
        } catch (e) { /* scope missing or user not found -> keep the name */ }
        text = text.replace("{{SUBMITTER}}", mention);
      } else if (text.includes("{{SUBMITTER}}")) {
        text = text.replace("{{SUBMITTER}}", body.submitterName || "");
      }
      const posted = await slackJSON("chat.postMessage", token, {
        channel: CHANNEL_ID, text, unfurl_links: false, unfurl_media: false,
      });
      res.status(200).json({ ok: true, ts: posted.ts });
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
        channel_id: CHANNEL_ID,
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
