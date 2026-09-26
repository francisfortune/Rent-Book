// assets/js/services/availabilityService.js
// Date-aware inventory availability engine.
//
// PROBLEM THIS SOLVES:
// The old system permanently deducted a booking's items from
// inventory.availableQuantity the moment the booking was created, and only
// added it back when the booking was marked "returned". That meant a booking
// for next month blocked stock TODAY, even though nothing physically leaves
// the warehouse until the delivery date arrives.
//
// NEW MODEL:
// Nothing is permanently deducted anymore. Instead, every time we need to
// know "how many of item X are free", we look at the item's total usable
// stock (inventory.availableQuantity, which staff can still hand-adjust for
// damaged/lost stock) and subtract however many units are already promised
// to OTHER active bookings whose date window overlaps the window we're
// checking. A booking's "window" runs from its deliveryDate (falling back to
// eventDate when no delivery date was set) through its returnDate.
//
// Two bookings only compete for stock if their windows overlap. A booking
// returning on the 8th and a new booking starting on the 8th DO overlap
// (the item isn't back until some point during the 8th), which matches the
// scenario described by the business owner.

import { db } from "../firebase.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Pull the [start, end] Date window a booking occupies.
 * Falls back sensibly across the different date fields used around the app.
 */
export function getBookingWindow(booking) {
  const startRaw =
    booking?.event?.deliveryDate ||
    booking?.event?.date ||
    booking?.eventDate ||
    null;
  const endRaw =
    booking?.event?.returnDate ||
    booking?.returnDate ||
    startRaw;

  const start = startRaw ? new Date(startRaw) : null;
  const end = endRaw ? new Date(endRaw) : start;

  return { start, end };
}

/**
 * Inclusive overlap test between two date windows.
 * Same-day boundaries (a return date equal to another booking's start date)
 * count as overlapping, since the item isn't guaranteed to be back and
 * cleaned before it's needed again the same day.
 */
export function windowsOverlap(startA, endA, startB, endB) {
  if (!startA || !startB) return false;
  const a1 = startA.getTime();
  const a2 = (endA || startA).getTime();
  const b1 = startB.getTime();
  const b2 = (endB || startB).getTime();
  return a1 <= b2 && b1 <= a2;
}

/**
 * Fetch every booking for a business that could possibly hold stock
 * (i.e. everything except returned/cancelled bookings).
 */
export async function fetchActiveBookings(businessId, excludeBookingId = null) {
  const snap = await getDocs(collection(db, "businesses", businessId, "bookings"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.id !== excludeBookingId)
    .filter(b => b.status !== "returned" && b.status !== "cancelled");
}

/**
 * Sum how many units of each inventory item name are already committed to
 * OTHER bookings whose window overlaps [start, end].
 * Returns a Map of lowercase item name -> committed quantity.
 */
export function computeBookedQuantities(bookings, start, end, excludeBookingId = null) {
  const booked = new Map();

  for (const booking of bookings) {
    if (excludeBookingId && booking.id === excludeBookingId) continue;
    if (booking.status === "returned" || booking.status === "cancelled") continue;

    const { start: bStart, end: bEnd } = getBookingWindow(booking);
    if (!windowsOverlap(start, end, bStart, bEnd)) continue;

    for (const item of booking.items || []) {
      // Only catalog items compete for shared stock. Custom / borrowed-only
      // items (isCustom: true) never come out of your own inventory.
      if (item.isCustom) continue;
      const key = (item.name || item.itemName || "").trim().toLowerCase();
      if (!key) continue;
      const qty = Number(item.qty || item.quantity || 0);
      // Only the portion actually pulled from YOUR stock counts against
      // your pool — any part already flagged as borrowed from a vendor
      // was never really "yours" to begin with.
      const ownPortion = Math.max(0, qty - Number(item.shortage || item.borrowed || 0));
      booked.set(key, (booked.get(key) || 0) + ownPortion);
    }
  }

  return booked;
}

/**
 * Compute how many units of a single named inventory item are free for a
 * given date window, given the item's usable stock and a pre-fetched list
 * of other active bookings.
 */
export function getAvailableForWindow(itemUsableStock, itemName, bookings, start, end, excludeBookingId = null) {
  const bookedMap = computeBookedQuantities(bookings, start, end, excludeBookingId);
  const bookedElsewhere = bookedMap.get((itemName || "").trim().toLowerCase()) || 0;
  return Math.max(0, Number(itemUsableStock || 0) - bookedElsewhere);
}

/**
 * Build a { itemNameLower: availableForWindow } map across the whole
 * inventory catalog for a given date window. Handy for populating item
 * dropdowns in add.html / the bookings edit modal.
 *
 * @param {Array} inventoryItems - already-fetched inventory docs [{name, availableQuantity}]
 * @param {Array} bookings - already-fetched active bookings
 */
export function getAvailabilityMap(inventoryItems, bookings, start, end, excludeBookingId = null) {
  const bookedMap = computeBookedQuantities(bookings, start, end, excludeBookingId);
  const map = new Map();

  inventoryItems.forEach(item => {
    const key = item.name.trim().toLowerCase();
    const bookedElsewhere = bookedMap.get(key) || 0;
    const free = Math.max(0, Number(item.availableQuantity || 0) - bookedElsewhere);
    map.set(key, free);
  });

  return map;
}

/**
 * Full availability check for a candidate booking (create or edit).
 *
 * @param {string} businessId
 * @param {Array} inventoryItems - [{name, availableQuantity}]
 * @param {Array} requestedItems - [{name, qty, isCustom}]
 * @param {Date|string} start
 * @param {Date|string} end
 * @param {string|null} excludeBookingId - pass the booking's own id when editing it,
 *   so it doesn't count its own (about-to-be-replaced) reservation against itself.
 * @returns {Promise<{available: boolean, shortages: Array, availabilityMap: Map}>}
 */
export async function checkDateAvailability(businessId, inventoryItems, requestedItems, start, end, excludeBookingId = null) {
  const startDate = start instanceof Date ? start : (start ? new Date(start) : null);
  const endDate = end instanceof Date ? end : (end ? new Date(end) : startDate);

  const bookings = await fetchActiveBookings(businessId, null); // fetch all, filter per-item below
  const availabilityMap = getAvailabilityMap(inventoryItems, bookings, startDate, endDate, excludeBookingId);

  const shortages = [];

  for (const item of requestedItems) {
    if (item.isCustom) continue; // custom items are always fully "borrowed", never short on your own stock
    const key = (item.name || "").trim().toLowerCase();
    const requested = Number(item.qty || item.quantity || 0);
    const freeForWindow = availabilityMap.has(key) ? availabilityMap.get(key) : 0;

    if (requested > freeForWindow) {
      shortages.push({
        name: item.name,
        requested,
        available: freeForWindow,
        shortage: requested - freeForWindow
      });
    }
  }

  return {
    available: shortages.length === 0,
    shortages,
    availabilityMap
  };
}

/**
 * "Available right now" — used for the inventory dashboard's summary cards.
 * Same math, just windowed to a single instant (now).
 */
export async function getAvailableNowMap(businessId, inventoryItems) {
  const now = new Date();
  const bookings = await fetchActiveBookings(businessId);
  return getAvailabilityMap(inventoryItems, bookings, now, now, null);
}
