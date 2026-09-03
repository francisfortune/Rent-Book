window.OneSignalDeferred = window.OneSignalDeferred || [];

OneSignalDeferred.push(async function (OneSignal) {
  await OneSignal.init({
    appId: "539d08e3-cada-4b7e-88c3-f89af30ff7f9",
  });
});

/**
 * Send a OneSignal push notification to all subscribed users.
 * Called automatically whenever an in-app notification is saved.
 *
 * @param {string} message - The notification body text
 * @param {string} url     - Relative path to deep-link into (e.g. "/bookings.html?highlight=ID")
 */
export async function sendPush(message, url = "/dashboard.html") {
  const REST_API_KEY = "os_v2_app_kooqry6k3jfx5cgd7cnpgd7x7etbd3jheedehl4pykvo4uxmrzc7bedzic2tn5anv47tgms4uij7lpjiebj53sqlotxev3vgyhdvucq";

  try {
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${REST_API_KEY}`
      },
      body: JSON.stringify({
        app_id: "539d08e3-cada-4b7e-88c3-f89af30ff7f9",
        included_segments: ["Subscribed Users"],
        headings: { en: "Tracknrent 🔔" },
        contents: { en: message },
        url: `https://tracknrent.vercel.app${url}`
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ OneSignal push failed:", errText);
    } else {
      const data = await response.json();
      console.log("✅ Push notification sent via OneSignal:", data);
    }
  } catch (err) {
    console.error("Push failed (network error):", err);
  }
}


window.OneSignalDeferred = window.OneSignalDeferred || [];

OneSignalDeferred.push(async function (OneSignal) {
  await OneSignal.init({
    appId: "539d08e3-cada-4b7e-88c3-f89af30ff7f9",
    serviceWorkerPath: "sw.js", // Explicitly point to your main sw.js
    serviceWorkerParam: { scope: "/" }
  });
});