window.OneSignalDeferred = window.OneSignalDeferred || [];

OneSignalDeferred.push(async function (OneSignal) {
  await OneSignal.init({
    appId: "539d08e3-cada-4b7e-88c3-f89af30ff7f9",
  });

  // init() alone never asks anyone for permission — without this, "Subscribed
  // Users" stays empty and every push call above succeeds against 0 devices.
  try {
    const isSupported = typeof OneSignal.Notifications?.isPushSupported === "function"
      ? OneSignal.Notifications.isPushSupported()
      : true;

    if (isSupported && OneSignal.Notifications?.permission !== true) {
      await OneSignal.Slidedown.promptPush();
    }
  } catch (err) {
    console.warn("OneSignal permission prompt could not be shown:", err);
  }
});

/**
 * Send a OneSignal push notification to all subscribed users.
 * Called automatically whenever an in-app notification is saved.
 *
 * @param {string} message - The notification body text
 * @param {string} url     - Relative path to deep-link into (e.g. "/bookings.html?highlight=ID")
 */
export async function sendPush(message, url = "/dashboard.html") {
  try {
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Key os_v2_app_kooqry6k3jfx5cgd7cnpgd7x7etbd3jheedehl4pykvo4uxmrzc7bedzic2tn5anv47tgms4uij7lpjiebj53sqlotxev3vgyhdvucq"
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
      console.warn(`OneSignal push failed (HTTP ${response.status}):`, errText);
    } else {
      const data = await response.json().catch(() => ({}));
      if (Array.isArray(data.errors) && data.errors.length) {
        // OneSignal can return 200 with a soft error, e.g. "All included players are not subscribed".
        console.warn("OneSignal push sent but reported issues:", data.errors);
      } else {
        console.log(`✅ Push notification sent via OneSignal to ${data.recipients ?? "?"} recipient(s)`);
      }
    }
  } catch (err) {
    // Push failing should never block the app — just log silently
    console.error("Push failed (non-critical):", err);
  }
}
