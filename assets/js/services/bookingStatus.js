// assets/js/services/bookingStatus.js
// Single source of truth for booking status badges, shared by bookings.js,
// dashboard.js and inventory.js so the "upcoming" logic behaves identically
// everywhere.
//
// RULES:
// - "returned"  -> booking.status === "returned"
// - "overdue"   -> not returned AND now is past the return date
// - "upcoming"  -> not returned/overdue AND the event/delivery date is
//                  1+ days away. Badge shows how far away: "10 days left",
//                  "1 month left", etc.
// - "active"    -> event/delivery is TODAY, OR already past (but not yet
//                  past the return date). No count shown — it's in progress.

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Human label for a number of whole days from now.
 */
export function formatDaysLeft(days) {
  if (days >= 60) {
    const months = Math.round(days / 30);
    return `${months} months left`;
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? "s" : ""} left`;
  }
  return `${days} day${days !== 1 ? "s" : ""} left`;
}

/**
 * Compute the full lifecycle info for a booking.
 * @returns {{ key: "returned"|"overdue"|"upcoming"|"active",
 *             label: string,        // e.g. "UPCOMING", "ACTIVE", "OVERDUE", "RETURNED"
 *             daysLeft: number|null,
 *             daysText: string|null // e.g. "10 days left" — null when nothing should be shown
 *          }}
 */
export function getBookingLifecycle(booking) {
  // 1) RETURNED — always wins
  if (booking?.status === "returned") {
    return { key: "returned", label: "RETURNED", daysLeft: null, daysText: null };
  }

  const now = new Date();
  const today = startOfDay(now);

  // 2) OVERDUE — return date has passed and not returned yet
  const returnRaw = booking?.event?.returnDate || booking?.returnDate || null;
  if (returnRaw) {
    const returnDate = new Date(returnRaw);
    if (!isNaN(returnDate) && now > returnDate) {
      return { key: "overdue", label: "OVERDUE", daysLeft: null, daysText: null };
    }
  }

  // 3) Figure out the reference date (delivery first, then event date)
  const refRaw =
    booking?.event?.deliveryDate ||
    booking?.event?.date ||
    booking?.eventDate ||
    null;

  if (!refRaw) {
    return { key: "active", label: "ACTIVE", daysLeft: null, daysText: null };
  }

  const refDate = new Date(refRaw);
  if (isNaN(refDate)) {
    return { key: "active", label: "ACTIVE", daysLeft: null, daysText: null };
  }

  // 4) Days between today and the event/delivery date
  //    Positive = future, 0 = today, negative = already past
  const daysLeft = Math.round((startOfDay(refDate) - today) / 86400000);

  // 5) UPCOMING — 1 or more days away
  if (daysLeft >= 1) {
    return {
      key: "upcoming",
      label: "UPCOMING",
      daysLeft,
      daysText: formatDaysLeft(daysLeft)
    };
  }

  // 6) ACTIVE — event is today, OR event already started/passed
  //    (but return date hasn't been reached, and not marked returned)
  //    No count shown — it's in progress right now.
  return { key: "active", label: "ACTIVE", daysLeft: 0, daysText: null };
}

/**
 * A booking is "overbooked" when at least one of its items had to borrow
 * from a vendor (shortage > 0) because your own stock wasn't free for its
 * dates. This is independent of the active/upcoming/overdue/returned
 * lifecycle above — a booking can be "Upcoming" AND "Overbooked" at once.
 * Shared here so bookings.js, dashboard.js and inventory.js's overbooked
 * panel all agree on exactly what counts.
 */
export function isBookingOverbooked(booking) {
  if (!booking || booking.status === "returned" || booking.status === "cancelled") return false;
  return (booking.items || []).some(i => Number(i.shortage || 0) > 0);
}

/** Tailwind-ish color classes per lifecycle key, for badges. */
export const LIFECYCLE_BADGE_COLORS = {
  active: "bg-green-100 text-green-700",
  upcoming: "bg-blue-100 text-blue-700",
  overdue: "bg-red-100 text-red-700",
  returned: "bg-purple-100 text-purple-700",
  overbooked: "bg-orange-100 text-orange-700"
};

/** Small standalone "OVERBOOKED" pill, meant to sit next to the lifecycle badge. */
export function renderOverbookedBadge(extraClass = "") {
  return `<span class="px-2 py-1 text-[10px] font-black rounded-full uppercase ${LIFECYCLE_BADGE_COLORS.overbooked} ${extraClass}">Overbooked</span>`;
}

/** Render a ready-to-use badge HTML snippet (small pill + optional days-left). */
export function renderLifecycleBadge(booking, extraClass = "") {
  const life = getBookingLifecycle(booking);
  const color = LIFECYCLE_BADGE_COLORS[life.key] || LIFECYCLE_BADGE_COLORS.active;
  const daysHtml = life.daysText
    ? `<span class="ml-1 font-normal normal-case opacity-80">• ${life.daysText}</span>`
    : "";
  return `<span class="px-3 py-1 text-xs font-bold rounded-full uppercase ${color} ${extraClass}">${life.label}${daysHtml}</span>`;
}