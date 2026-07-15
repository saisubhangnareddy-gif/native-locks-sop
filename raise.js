// Slack escalation for the Native Locks portal.
// Two-phase so large videos never pass through this server:
//   POST /api/raise     { text, filesMeta:[{name,length}] }
//        -> posts the message to the channel, then asks Slack for one upload URL per file
//        -> returns { ok, channel, ts, uploads:[{name, upload_url, file_id}] }
//        The BROWSER then PUTs each file's bytes straight to its Slack upload_url.
//   POST /api/complete  { channel, thread_ts, files:[{file_id, title}] }
//        -> completes the upload, attaching the media as a threaded reply.
//
// SLACK_BOT_TOKEN lives ONLY here as a Vercel env var. Never sent to the browser.

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C07GZK9UKQW";

async function slack(method, token, body, isForm) {
  const url = `https://slack.com/api/${method}`;
  const opts = { method: "POST", headers: { Authorization: `Bearer ${token}` } };
  if (isForm) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(body).toString();
  } else {
    opts.headers["Content-Type"] = "application/json; charset=utf-8";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error || "unknown error"}`);
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    res.status(500).json({ ok: false, error: "SLACK_BOT_TOKEN not configured" });
    return;
  }

  try {
    const { phase } = req.body || {};

    // Phase 2: attach uploaded files into the message thread.
    if (phase === "complete") {
      const { thread_ts, files } = req.body;
      await slack("files.completeUploadExternal", token, {
        files: JSON.stringify(files.map((f) => ({ id: f.file_id, title: f.title || f.name }))),
        channel_id: CHANNEL_ID,
        thread_ts,
      });
      res.status(200).json({ ok: true });
      return;
    }

    // Phase 1: post the escalation message, then reserve upload URLs.
    const { text, filesMeta } = req.body;
    if (!text || !String(text).trim()) {
      res.status(400).json({ ok: false, error: "Empty escalation text" });
      return;
    }

    const posted = await slack("chat.postMessage", token, {
      channel: CHANNEL_ID,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });

    const uploads = [];
    for (const f of filesMeta || []) {
      const u = await slack(
        "files.getUploadURLExternal",
        token,
        { filename: f.name, length: String(f.length) },
        true
      );
      uploads.push({ name: f.name, upload_url: u.upload_url, file_id: u.file_id });
    }

    res.status(200).json({ ok: true, channel: CHANNEL_ID, ts: posted.ts, uploads });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || "Slack raise failed" });
  }
}
