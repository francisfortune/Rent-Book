// assets/js/onesignal.js — OneSignal Web SDK v16 (fixed)
//
// What this does:
//  1. Initializes OneSignal once per page (production only).
//  2. When a Firebase user is signed in, links the device to them
//     (OneSignal.login(uid)) and tags it with their businessId, so pushes go
//     to *that business's team only* (not "All" subscribers).
//  3. Asks for notification permission via the OneSignal slidedown prompt.
//  4. sendPush(message, url) -> POST /api/send-push (server holds the REST key).
//
// Every existing `sendPush(message, deepLink)` call keeps working unchanged.

import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";

const isLocalhost =
  ["localhost", "127.0.0.1", ""].includes(window.location.hostname);

/* ---------------------------------------------------------
   SDK bootstrap — resolves with the OneSignal instance once
   init() has finished (or null on localhost / init failure)
--------------------------------------------------------- */
window.OneSignalDeferred = window.OneSignalDeferred || [];

const osReady = new Promise((resolve) => {
  if (isLocalhost) {
    console.log("[OneSignal] Localhost: SDK disabled, pushes skipped");
    return resolve(null);
  }
  if (window.__onesignal_initialized) {
    // another copy of this module already ran init
    window.OneSignalDeferred.push((OS) => resolve(OS));
    return;
  }
  window.__onesignal_initialized = true;

  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        serviceWorkerPath: "/sw.js",
        serviceWorkerParam: { scope: "/" },
        notifyButton: { enable: false }
      });
      console.log("[OneSignal] ✅ Initialized");
      resolve(OneSignal);
    } catch (err) {
      console.warn("[OneSignal] Init error:", err.message);
      resolve(null);
    }
  });
});

/* ---------------------------------------------------------
   Identity: Firebase user -> OneSignal external id + businessId tag
--------------------------------------------------------- */
let currentBusinessId = null;
let resolveIdentity;
const identityReady = new Promise((r) => (resolveIdentity = r));

onAuthStateChanged(auth, async (user) => {
  const OneSignal = await osReady;

  if (!user) {
    currentBusinessId = null;
    try { await OneSignal?.logout(); } catch (_) {}
    return;
  }

  try {
    const { getBusinessIdByEmail } = await import("./shared.js");
    currentBusinessId = await getBusinessIdByEmail(user.email, user);
  } catch (err) {
    console.warn("[OneSignal] Could not resolve businessId:", err.message);
  }
  resolveIdentity(true);

  if (!OneSignal || !currentBusinessId) return;

  try {
    await OneSignal.login(user.uid);
    OneSignal.User.addTags({ businessId: currentBusinessId, role: "member" });
    console.log("[OneSignal] Linked device to", user.uid, "/", currentBusinessId);

    // Ask for permission (needs a user gesture on some browsers -> slidedown)
    if (OneSignal.Notifications.permission) {
      // already granted: make sure the subscription is actually opted in
      if (!OneSignal.User.PushSubscription.optedIn) {
        await OneSignal.User.PushSubscription.optIn();
      }
    } else if (OneSignal.Notifications.permissionNative === "default") {
      OneSignal.Slidedown.promptPush();
    }
  } catch (err) {
    console.warn("[OneSignal] Identity/permission setup failed:", err.message);
  }
});

/* Call this from a button (e.g. Settings -> "Enable notifications") */
export async function enablePushNotifications() {
  const OneSignal = await osReady;
  if (!OneSignal) return false;
  await OneSignal.Slidedown.promptPush({ force: true });
  return !!OneSignal.Notifications.permission;
}
window.enablePushNotifications = enablePushNotifications;

/* ---------------------------------------------------------
   sendPush — asks the server to notify this business's devices
--------------------------------------------------------- */
export async function sendPush(message, url = "/dashboard.html") {
  if (isLocalhost) {
    console.log("[OneSignal] Skipping push on localhost:", message);
    return { success: true, skipped: true };
  }

  // wait (max 5s) for auth + businessId
  await Promise.race([identityReady, new Promise((r) => setTimeout(r, 5000))]);
  if (!currentBusinessId) {
    console.warn("[OneSignal] No businessId yet — push not sent");
    return { success: false, error: "no_business" };
  }

  try {
    const idToken = await auth.currentUser?.getIdToken();
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        url,
        businessId: currentBusinessId,
        idToken
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      console.error("[OneSignal] Push failed:", res.status, data);
      return { success: false, error: data };
    }
    console.log("[OneSignal] ✅ Push sent:", data);
    return { success: true, data };
  } catch (err) {
    console.error("[OneSignal] Push network error:", err);
    return { success: false, error: err.message };
  }
}
window.sendPush = sendPush;
