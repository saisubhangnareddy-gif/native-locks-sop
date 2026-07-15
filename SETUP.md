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
   | `SLACK_CHANNEL_ID` | `C07GZK9UKQW` |
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

## Notes / decisions baked in
- **Media never passes through the server** — the browser uploads file bytes straight to Slack's upload URL, so large videos are fine (no Vercel body-size limit involved).
- **Two mandatory gates:** lock serial present AND ≥1 proof attached, else Send is disabled.
- **"Proofs attached as per SoP: Yes"** is hard-coded in the message (uploads are enforced, so it's always true).
- **POCs** default per SKU (Ultra: Manuranjan + Harshavardhan; Pro: Manuranjan + Jyothi; backups: Kunal, Sita Ram, Subhang, Titas) and are editable per raise via the chips.
- **"Submitted by"** = the signed-in agent's verified Google name.
- Slack `@name` mentions in the message post as plain text. To make them true clickable pings, we'd swap each to the person's Slack member ID as `<@U0XXXX>` — tell me and I'll add a member-ID map.
