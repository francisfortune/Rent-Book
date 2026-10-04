// assets/js/notification-helpers.js
// ============================================================================
// Shared notification helpers used by BOTH:
//   • dashboard.js — the bell dropdown
//   • history.js   — the full-page notification list
//
// These were originally defined inline in dashboard.js and attached to
// window.* so inline onclick handlers could reach them. Keeping them on
// window preserves that behavior — callers don't change, only the source
// of the functions moves here.
// ============================================================================

import { auth, db } from "./firebase.js";
import {
  doc,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================================
   REDIRECT ROUTER — maps a notification's `type` to the page it should open.
   Kept in one place so both the dropdown and the full-page list always
   redirect the same way.
============================================================================ */
export function getNotificationTargetPage(type, bookingId) {
  const t = String(type || "").toLowerCase();

  if (t.includes("booking") || t === "rental_lent_out" || t === "rental_returned" || t === "rental_edited" || t === "rental_deleted") {
    if (bookingId) return `bookings.html?highlight=${bookingId}`;
    if (t.startsWith("rental_")) return "rental-to-rental.html";
    return "bookings.html";
  }
  if (t === "add") return "add.html";
  if (t === "inventory" || t === "inventory_damage" || t === "inventory_add" || t === "inventory_update" || t === "inventory_delete" || t === "inventory_low_stock") {
    return "inventory.html";
  }
  if (t === "welcome" || t === "welcome_message") return "dashboard.html";
  if (t === "settings") return "settings.html";
  return "dashboard.html";
}

/* ============================================================================
   MARK AS READ + REDIRECT — used by both dropdown and history page.
   Pass { redirect: false } if you only want to mark read without navigating.
============================================================================ */
export async function markNotificationReadAndRedirect(businessId, notifId, type, bookingId, { redirect = true } = {}) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const notifRef = doc(db, "businesses", businessId, "notifications", notifId);
    await updateDoc(notifRef, { readBy: arrayUnion(user.uid) });

    if (redirect) {
      const target = getNotificationTargetPage(type, bookingId);
      window.location.href = target;
    }
  } catch (e) {
    console.error("Notification read error:", e);
  }
}

/* ============================================================================
   DELETE FOR ME ONLY — adds the current user's UID to `deletedFor`.
============================================================================ */
export async function deleteNotificationForMe(businessId, notifId) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const notifRef = doc(db, "businesses", businessId, "notifications", notifId);
    await updateDoc(notifRef, { deletedFor: arrayUnion(user.uid) });
  } catch (e) {
    console.error("Delete notification error:", e);
  }
}

/* ============================================================================
   Attach to window so existing inline onclick handlers in dashboard.html
   and the new history.html keep working without refactoring.
============================================================================ */
window.markNotificationReadAndRedirect = markNotificationReadAndRedirect;
window.deleteNotification = deleteNotificationForMe;