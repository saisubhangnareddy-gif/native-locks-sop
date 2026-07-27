# Native Locks SOP Portal — Deploy & Setup

Everything is in this `sop-live/` folder:

```
sop-live/
├─ index.html        portal + login gate + escalation modal
├─ api/
│  ├─ ticket.js      Redash lookup by TICKET_ID  (holds REDASH_API_KEY)
│  ├─ raise.js       Slack post + threaded media (holds SLACK_BOT_TOKEN)
│  └─ auth.js        Google SSO verify           (holds GOOGLE_CLIENT_ID)
├─ images/           <-- COPY your existing images here
├─ videos/           <-- COPY your existing videos here
└─ vercel.json
```

## 0. Before you deploy — copy your media in
Copy the contents of your old `sop-live/images/` and `sop-live/videos/` folders into the
`images/` and `videos/` folders here. (They were not in the workspace, so they're empty.)

> **Video playback (important):** the reference video is served from `videos/auto-lock-check.mp4`.
> If that file is missing from the Vercel deploy you'll see a black box with an unclickable
> play button. Two safeguards are in place:
> 1. `vercel.json` sets the correct `Content-Type: video/mp4` + `Accept-Ranges` headers.
> 2. If the `<video>` still can't load, the portal automatically falls back to the Google Drive
>    embedded player (each auto-lock issue has a `driveId`), plus an "Open in a new tab" link.
> So even without the raw file the agent can always watch the reference clip.

---

## 1. Rotate the Redash key (do this first)
The old key was shared in chat — treat it as burned.
- Redash → query 562171 → user menu → **Regenerate API Key** (or per-query key).
- Copy the NEW key. You'll paste it into Vercel in step 4. Never put it in index.html.

---

## 2. Create the Google OAuth client (free)
1. https://console.cloud.google.com → create/select a project (free, no billing).
2. **APIs & Services → OAuth consent screen** → User type **Internal** (limits to urbancompany.com) → fill app name + your email → Save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** add your Vercel URL (e.g. `https://native-locks-sop.vercel.app`). You can add it after step 3 once you know the URL, then edit.
4. Copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`).
5. In `index.html`, replace `__GOOGLE_CLIENT_ID__` with this Client ID.
   (It's a public value — fine to have in the front-end. It's also set as an env var for the auth check.)

---

## 3. Create the Slack app
1. https://api.slack.com/apps → **Create New App → From scratch** → pick the Urban Company workspace.
2. **OAuth & Permissions → Bot Token Scopes**, add:
   - `chat:write`
   - `files:write`
3. **Install to Workspace** (admin approval may be required).
4. Copy the **Bot User OAuth Token** (`xoxb-...`). Save for step 4.
5. In Slack, open **#native locks product issues** → channel details → **Integrations → Add apps** → add your app so the bot can post. (Channel ID is already set: `C07GZK9UKQW`.)
6. Do the same for **#epc-stores-escalations** so non-product escalations can post there. (Channel ID: `C03KCDYQ3H8`.)

---

## 4. Deploy to Vercel
1. https://vercel.com → **Add New → Project**.
2. Easiest without Git: install the Vercel CLI on your own machine and run `vercel` inside `sop-live/`,
   OR connect a GitHub repo containing this folder and import it.
   (Drag-and-drop deploy is Netlify's model; Vercel needs CLI or Git.)
3. In the project's **Settings → Environment Variables**, add:
   | Name | Value |
   |------|-------|
   | `REDASH_API_KEY` | your NEW Redash key (step 1) |
   | `SLACK_BOT_TOKEN` | `xoxb-...` (step 3) |
   | `SLACK_CHANNEL_ID` | `C07GZK9UKQW` (product issues) |
   | `SLACK_EPC_CHANNEL_ID` | `C03KCDYQ3H8` (non-product → #epc-stores-escalations) |
   | `GOOGLE_CLIENT_ID` | `xxxx.apps.googleusercontent.com` (step 2) |
   | `ALLOWED_DOMAIN` | `urbancompany.com` |
4. Redeploy so the env vars take effect.
5. Copy the live URL and add it back into the Google OAuth **Authorized JavaScript origins** (step 2.3).

---

## 5. Test checklist
- [ ] Open the URL → login gate appears → Sign in with an @urbancompany.com account → gate closes, your name shows top-right.
- [ ] Open any issue → **Raise on Slack** → paste a real ticket ID → **Fetch from ops** → SKU / install date / city / root / order fill in.
- [ ] Lock serial: if scanned, it auto-fills and locks; if not, the field turns amber and Send stays disabled until you type one.
- [ ] Attach at least one photo → Send button enables.
- [ ] **Send to Slack** → message posts to #native locks product issues, media appears as a threaded reply.

---

## 6. Live-editable SOP content (Google Sheet)

The product SOPs (the issue list, steps, Yes/No branches, actions, "Tell the customer"
scripts, POW, media) can be edited in a Google Sheet without touching code. The portal
reads the sheet at page load. If the sheet is missing or fails to load, the portal falls
back to the **baked-in SOPs** in `index.html`, so it never shows empty content.

**One-time setup:**
1. Open the deployed portal with `#export-sop` at the end of the URL, e.g.
   `https://native-locks-sop.vercel.app/#export-sop`. It downloads
   `native-locks-sop-content.csv` — the current SOPs in the exact required format.
2. In Google Sheets: **File → Import → Upload** that CSV → *Replace spreadsheet*.
3. **File → Share → Publish to web** → choose the sheet/tab → **Comma-separated values (.csv)** → Publish. Copy the published CSV URL.
4. In `index.html`, set `SOP_SHEET_URL = "<that published CSV URL>"`. Deploy.

**Editing later:** just edit cells in the sheet and refresh the portal — changes appear
(the portal loads fresh each visit). No code change, no redeploy.

**Column format (header row, exact names):**
`sku, issue_id, title, customer_says, severity, freq, media_json, pow, step_no, step_question, branch_type, action, tell_customer`
- One **row per Yes/No/Do branch**. Rows sharing an `issue_id` form one issue; rows sharing `issue_id`+`step_no` form one step.
- `sku`: `ultra` or `pro`. `severity`: `g` (green), `a` (amber), `r` (red). `branch_type`: `yes`, `no`, `yesno`, or `do`.
- `media_json`: leave blank, or the media object as JSON (the exporter fills this for issues that have a reference video/image). `pow`: the POW checklist items joined with `|`.
- `title`, `customer_says`, `media_json`, `pow`, `freq`, `severity` only need to be filled on the **first row** of each issue (the loader reads them from there).

> Non-product buckets remain baked-in for now (they are internal escalation flows, not customer-facing SOPs). Ask if you want those sheet-driven too.

---

## Notes / decisions baked in
- **Media never passes through the server** — the browser uploads file bytes straight to Slack's upload URL, so large videos are fine (no Vercel body-size limit involved).
- **Two mandatory gates:** lock serial present AND ≥1 proof attached, else Send is disabled.
- **"Proofs attached as per SoP: Yes"** is hard-coded in the message (uploads are enforced, so it's always true).
- **POCs** default per SKU (Ultra: Manuranjan + Harshavardhan; Pro: Manuranjan + Jyothi; backups: Kunal, Sita Ram, Subhang, Titas) and are editable per raise via the chips.
- **"Submitted by"** = the signed-in agent's verified Google name.
- Slack `@name` mentions in the message post as plain text. To make them true clickable pings, we'd swap each to the person's Slack member ID as `<@U0XXXX>` — tell me and I'll add a member-ID map.
