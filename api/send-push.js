// /api/send-push.js — Vercel serverless function
//
// Env vars (Vercel -> Settings -> Environment Variables):
//   ONESIGNAL_API_KEY  = your OneSignal *REST API key* (os_v2_app_... or legacy)
//   FIREBASE_API_KEY   = your Firebase web apiKey (used to verify the caller's ID token)

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";
const SITE = "https://tracknrent.vercel.app";

async function verifyFirebaseToken(idToken) {
  const key = process.env.FIREBASE_API_KEY;
  if (!key) {
    console.warn("[API] FIREBASE_API_KEY not set — caller is NOT verified");
    return true;
  }
  if (!idToken) return false;
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  return r.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ONESIGNAL_API_KEY missing on server" });
  }

  try {
    const { message, url = "/dashboard.html", businessId, idToken } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required" });
    }
    if (!businessId) {
      return res.status(400).json({ error: "businessId is required" });
    }
    if (!(await verifyFirebaseToken(idToken))) {
      return res.status(401).json({ error: "Invalid or missing Firebase token" });
    }

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      target_channel: "push",
      contents: { en: String(message) },
      headings: { en: "Tracknrent" },
      web_url: url.startsWith("http") ? url : `${SITE}${url}`,
      chrome_web_icon: `${SITE}/assets/imgs/logo2.png`,
      data: { url, timestamp: new Date().toISOString() },
      // only devices tagged with this business (set in onesignal.js)
      filters: [{ field: "tag", key: "businessId", relation: "=", value: String(businessId) }]
    };

    // v2 keys (os_v2_...) use "Key"; legacy keys use "Basic"
    const scheme = apiKey.startsWith("os_v2_") ? "Key" : "Basic";

    const r = await fetch("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `${scheme} ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json();

    if (!r.ok) {
      console.error("[API] OneSignal error:", JSON.stringify(data));
      return res.status(r.status).json({ success: false, error: "OneSignal API error", details: data });
    }

    // 200 but nobody to send to (no subscribed devices with that tag)
    if (!data.id) {
      console.warn("[API] No recipients:", JSON.stringify(data));
      return res.status(200).json({ success: false, error: "No subscribed devices for this business", details: data });
    }

    return res.status(200).json({ success: true, notificationId: data.id, recipients: data.recipients });
  } catch (err) {
    console.error("[API] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
