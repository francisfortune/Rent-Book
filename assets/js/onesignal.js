// assets/js/onesignal.js — OneSignal Web SDK v16 (FIXED: no cross-account leaks)
//
//  Fixes:
//   • On login:  removes any stale businessId tag, then adds the correct one.
//   • On logout: removes businessId tag AND opts the device OUT so it can't
//                receive pushes meant for the previous account.
//   • Never silently skips identity setup — logs clearly.

import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ONESIGNAL_APP_ID = "539d08e3-cada-4b7e-88c3-f89af30ff7f9";

const isLocalhost =
  ["localhost", "127.0.0.1", ""].includes(window.location.hostname);

/* ---------------------------------------------------------
   SDK bootstrap
--------------------------------------------------------- */
window.OneSignalDeferred = window.OneSignalDeferred || [];

const osReady = new Promise((resolve) => {
  if (isLocalhost) {
    console.log("[OneSignal] Localhost: SDK disabled");
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
   Identity: Firebase user -> OneSignal external id + businessId tag
--------------------------------------------------------- */
let currentBusinessId = null;
let resolveIdentity;
const identityReady = new Promise((r) => (resolveIdentity = r));

/**
 * Wipes any previous businessId/role tags off this device and opts out
 * of push, so a device that logged out of Account A can never receive
 * Account A's notifications again — even if Account A keeps sending.
 */
async function detachDeviceFromBusiness(OneSignal, reason = "") {
  if (!OneSignal) return;
  try {
    await OneSignal.User.removeTags(["businessId", "role"]);
    console.log("[OneSignal] Removed businessId tag" + (reason ? ` (${reason})` : ""));

    if (OneSignal.User?.PushSubscription?.optedIn) {
      await OneSignal.User.PushSubscription.optOut();
      console.log("[OneSignal] Push subscription opted OUT");
    }
  } catch (err) {
    console.warn("[OneSignal] detachDeviceFromBusiness failed:", err.message);
  }
}

onAuthStateChanged(auth, async (user) => {
  const OneSignal = await osReady;

  // ---------- LOGOUT PATH ----------
  if (!user) {
    currentBusinessId = null;
    if (OneSignal) {
      await detachDeviceFromBusiness(OneSignal, "logout");
      try {
        await OneSignal.logout();
        console.log("[OneSignal] External user id cleared");
      } catch (_) {}
    }
    resolveIdentity(false);
    return;
  }

  // ---------- LOGIN PATH ----------
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

    // Remove any stale tags from a previously-logged-in account on this
    // same browser, THEN set the new tag. This is the actual fix for
    // "phone push appears on laptop".
    await OneSignal.User.removeTags(["businessId", "role"]);
    await OneSignal.User.addTags({
      businessId: resolvedBusinessId,
      role: "member",
    });

    console.log(
      "[OneSignal] ✅ Linked device → user:",
      user.uid,
      "| business:",
      resolvedBusinessId
    );

    if (OneSignal.Notifications.permission) {
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

/* Call from a button (Settings -> "Enable notifications") */
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
    console.error("[OneSignal] Push network error:", err);
    return { success: false, error: err.message };
  }
}
window.sendPush = sendPush;

/* ---------------------------------------------------------
   DEBUG HELPER — run window.__osDebug() in the console
--------------------------------------------------------- */
window.__osDebug = async () => {
  const OS = await osReady;
  if (!OS) return console.log("OneSignal not ready");
  console.log("External user id:", OS.User?.externalId || "(none)");
  console.log("Subscription id:", OS.User?.PushSubscription?.id || "(none)");
  console.log("Opted in?", OS.User?.PushSubscription?.optedIn);
  console.log("Permission:", OS.Notifications?.permission);
  try {
    const tags = await OS.User.getTags();
    console.log("Tags:", tags);
  } catch (e) {
    console.log("Could not read tags:", e.message);
  }
};