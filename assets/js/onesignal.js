// assets/js/onesignal.js — FINAL VERIFIED VERSION
//
// Multi-tenant push routing for Tracknrent.
//   • Each device is tagged with the businessId it belongs to.
//   • Server-side /api/send-push sends to ALL devices with that tag.
//   • Logout wipes the tag so a shared browser never leaks pushes.
//
// Public API (do not rename — used across the app):
//   - sendPush(message, url)         → module export + window.sendPush
//   - enablePushNotifications()      → module export + window
//   - window.__osDebug()             → console helper

import { auth } from "./firebase.js";
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";

const isLocalhost =
  ["localhost", "127.0.0.1", ""].includes(window.location.hostname);

/* ---------------------------------------------------------
   SDK BOOTSTRAP
   OneSignal v16 loads async. We wait for it once and reuse.
--------------------------------------------------------- */
window.OneSignalDeferred = window.OneSignalDeferred || [];

const osReady = new Promise((resolve) => {
  if (isLocalhost) {
    console.log("[OneSignal] localhost → SDK disabled");
    return resolve(null);
  }
  if (window.__onesignal_initialized) {
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
        notifyButton: { enable: false },
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
   IDENTITY
   We resolve the caller's businessId once, then:
     - login()        → ties this device to the Firebase uid
     - addTags()      → tags it with businessId so server pushes match
   On logout we wipe BOTH so a shared browser can't receive
   notifications for a business it's no longer logged into.
--------------------------------------------------------- */
let currentBusinessId = null;

let resolveIdentity;
const identityReady = new Promise((r) => (resolveIdentity = r));

async function detachDeviceFromBusiness(OneSignal, reason = "") {
  if (!OneSignal) return;
  try {
    await OneSignal.User.removeTags(["businessId", "role"]);
    console.log(`[OneSignal] Removed businessId tag (${reason})`);
    if (OneSignal.User?.PushSubscription?.optedIn) {
      await OneSignal.User.PushSubscription.optOut();
      console.log("[OneSignal] Push subscription opted OUT");
    }
  } catch (err) {
    console.warn("[OneSignal] detach failed:", err.message);
  }
}

onAuthStateChanged(auth, async (user) => {
  const OneSignal = await osReady;

  // ---------- LOGGED OUT ----------
  if (!user) {
    currentBusinessId = null;
    if (OneSignal) {
      await detachDeviceFromBusiness(OneSignal, "logout");
      try { await OneSignal.logout(); } catch (_) {}
    }
    resolveIdentity(false);
    return;
  }

  // ---------- LOGGED IN ----------
  let resolvedBusinessId = null;
  try {
    const { getBusinessIdByEmail } = await import("./shared.js");
    resolvedBusinessId = await getBusinessIdByEmail(user.email, user);
  } catch (err) {
    console.warn("[OneSignal] Could not resolve businessId:", err.message);
  }
  currentBusinessId = resolvedBusinessId;
  resolveIdentity(!!resolvedBusinessId);

  if (!OneSignal) return;
  if (!resolvedBusinessId) {
    await detachDeviceFromBusiness(OneSignal, "no-business");
    return;
  }

  try {
    await OneSignal.login(user.uid);

    // Remove any tags left over from a previous account on this browser,
    // THEN set the correct ones. This is the fix for cross-account leaks.
    await OneSignal.User.removeTags(["businessId", "role"]);
    await OneSignal.User.addTags({
      businessId: resolvedBusinessId,
      role: "member",
    });

    console.log(
      "[OneSignal] ✅ Device linked → uid:", user.uid,
      "| business:", resolvedBusinessId
    );

    // Prompt for permission on first login
    if (OneSignal.Notifications.permission) {
      if (!OneSignal.User.PushSubscription.optedIn) {
        await OneSignal.User.PushSubscription.optIn();
      }
    } else if (OneSignal.Notifications.permissionNative === "default") {
      OneSignal.Slidedown.promptPush();
    }
  } catch (err) {
    console.warn("[OneSignal] Identity setup failed:", err.message);
  }
});

/* ---------------------------------------------------------
   PUBLIC API — sendPush
   Sends via /api/send-push, which filters by businessId tag.
--------------------------------------------------------- */
export async function sendPush(message, url = "/dashboard.html") {
  if (isLocalhost) {
    console.log("[OneSignal] localhost → push skipped:", message);
    return { success: true, skipped: true };
  }

  // Wait up to 5s for businessId to be resolved
  await Promise.race([identityReady, new Promise((r) => setTimeout(r, 5000))]);
  if (!currentBusinessId) {
    console.warn("[OneSignal] No businessId — push not sent");
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
        idToken,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      console.error("[OneSignal] Push failed:", res.status, data);
      return { success: false, error: data };
    }
    console.log("[OneSignal] ✅ Push sent:", data);
    return { success: true, data };
  } catch (err) {
    console.error("[OneSignal] Network error:", err);
    return { success: false, error: err.message };
  }
}
window.sendPush = sendPush;

/* ---------------------------------------------------------
   PUBLIC API — enablePushNotifications
   Called from settings when the user clicks "Enable notifications".
--------------------------------------------------------- */
export async function enablePushNotifications() {
  const OneSignal = await osReady;
  if (!OneSignal) return false;
  await OneSignal.Slidedown.promptPush({ force: true });
  return !!OneSignal.Notifications.permission;
}
window.enablePushNotifications = enablePushNotifications;

/* ---------------------------------------------------------
   DEBUG helper — paste window.__osDebug() in console
--------------------------------------------------------- */
window.__osDebug = async () => {
  const OS = await osReady;
  if (!OS) return console.log("OneSignal not ready");
  console.log("External user id :", OS.User?.externalId || "(none)");
  console.log("Subscription id  :", OS.User?.PushSubscription?.id || "(none)");
  console.log("Opted in?        :", OS.User?.PushSubscription?.optedIn);
  console.log("Permission       :", OS.Notifications?.permission);
  try {
    const tags = await OS.User.getTags();
    console.log("Tags             :", tags);
  } catch (e) {
    console.log("Tags read error  :", e.message);
  }
};