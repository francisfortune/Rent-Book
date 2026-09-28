/**
 * dashboard-push-patch.js
 * ========================
 * Load this AFTER assets/js/dashboard.js on dashboard.html.
 * It monkey-patches any sendNotification call so that every
 * in-app Firestore notification also fires a OneSignal push.
 *
 * Usage (add at the bottom of dashboard.html before </body>):
 *   <script type="module" src="assets/js/dashboard-push-patch.js"></script>
 */

import { sendPush } from "./onesignal.js";

/**
 * We wrap the global window.saveNotification / any custom notification
 * UI on the dashboard so that clicking "Save" also triggers OneSignal.
 *
 * Locate the notification form / save button in dashboard.html and
 * call the helper below, OR use a MutationObserver to detect when a
 * notification is committed.
 */

// --- Strategy 1: intercept the "Save Notification" button if it exists ---
document.addEventListener("DOMContentLoaded", () => {
  const saveNotifBtn = document.getElementById("saveNotifBtn");
  const notifMessageInput = document.getElementById("notifMessage") || document.getElementById("notifInput");

  if (saveNotifBtn && notifMessageInput) {
    // Wrap the existing click so push fires AFTER Firestore write
    saveNotifBtn.addEventListener("click", async () => {
      const message = notifMessageInput.value?.trim();
      if (!message) return;

      try {
        await sendPush(message, "/dashboard.html");
      } catch (e) {
        console.warn("Push skipped (non-critical):", e);
      }
    });
  }
});

// --- Strategy 2: export a helper for use in dashboard.js directly ---
/**
 * Call this from dashboard.js sendNotification() after the addDoc() call:
 *
 *   import { fireNotifPush } from "./dashboard-push-patch.js";
 *   await fireNotifPush(message, bookingId);
 */
export async function fireNotifPush(message, bookingId = "") {
  const deepLink = bookingId ? `/bookings.html?highlight=${bookingId}` : "/dashboard.html";
  return sendPush(message, deepLink);
}
