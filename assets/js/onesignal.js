window.OneSignalDeferred = window.OneSignalDeferred || [];

OneSignalDeferred.push(async function (OneSignal) {
  await OneSignal.init({
    appId: "539d08e3-cada-4b7e-88c3-f89af30ff7f9",
    serviceWorkerPath: "sw.js",
    serviceWorkerParam: { scope: "/" },
    allowLocalhostAsSecureOrigin: true
  });
});

export async function sendPush(message, url = "/dashboard.html") {
  try {
    const response = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, url })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Push relay error:", data);
    } else {
      console.log(`✅ Push notification sent via OneSignal:`, data);
    }
  } catch (err) {
    console.error("Push network error:", err);
  }
}