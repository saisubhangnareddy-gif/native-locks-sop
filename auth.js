// POST /api/auth  { credential: <Google ID token JWT> }
// Verifies the Google Sign-In token server-side and returns the trusted identity.
// Security: we check Google's signature (via tokeninfo), that the audience matches our
// OAuth client, that the token isn't expired, and that the email is a verified
// urbancompany.com address. Only then do we trust the name for "submitted by".

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "urbancompany.com";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  if (!GOOGLE_CLIENT_ID) {
    res.status(500).json({ ok: false, error: "GOOGLE_CLIENT_ID not configured" });
    return;
  }

  try {
    const { credential } = req.body || {};
    if (!credential) {
      res.status(400).json({ ok: false, error: "Missing credential" });
      return;
    }

    // Verify via Google's tokeninfo endpoint (checks signature + expiry).
    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!r.ok) {
      res.status(401).json({ ok: false, error: "Invalid token" });
      return;
    }
    const p = await r.json();

    if (p.aud !== GOOGLE_CLIENT_ID) {
      res.status(401).json({ ok: false, error: "Token audience mismatch" });
      return;
    }
    if (p.email_verified !== "true" && p.email_verified !== true) {
      res.status(401).json({ ok: false, error: "Email not verified" });
      return;
    }
    const domain = (p.hd || (p.email || "").split("@")[1] || "").toLowerCase();
    if (domain !== ALLOWED_DOMAIN.toLowerCase()) {
      res.status(403).json({ ok: false, error: `Sign in with an ${ALLOWED_DOMAIN} account` });
      return;
    }

    res.status(200).json({
      ok: true,
      name: p.name || p.email,
      email: p.email,
      picture: p.picture || "",
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || "Auth failed" });
  }
}
