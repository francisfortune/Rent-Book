// assets/js/services/analytics-service.js
// ============================================================================
// Shared analytics engine for Tracknrent.
//
// Used by:
//   • analytics.js        → renders the full analytics page
//   • ai-assistant.js     → answers owner questions ("who owes me money?")
//
// Every function:
//   1. Takes a businessId + optional { from, to } date range
//   2. Reads businesses/{businessId}/bookings
//   3. Returns plain JSON — no DOM, no rendering
//
// Callers format the numbers their own way.
// ============================================================================

import { db } from "../firebase.js";
import {
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================================
   INTERNAL HELPERS
============================================================================ */

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function isInRange(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/**
 * Booking date we use for filters — the EVENT date, falling back to when it
 * was created. This is what makes "this month" mean "events happening this
 * month", not "rows typed in this month".
 */
function bookingDate(b) {
  return toDate(b.event?.date) || toDate(b.createdAt) || null;
}

/**
 * A booking still counts toward "owed" only if it can plausibly still owe
 * money. Cancelled bookings are dead. Returned bookings can still owe the
 * balance if the client never finished paying.
 */
function isDebtActive(b) {
  const status = String(b.status || "").toLowerCase();
  if (status === "cancelled" || status === "canceled") return false;
  return true;
}

/**
 * Fetch all bookings for a business. Sorted newest-first when possible.
 * Falls back to unordered fetch if orderBy fails (missing composite index).
 */
async function fetchAllBookings(businessId) {
  if (!businessId) throw new Error("analytics-service: businessId required");

  const col = collection(db, "businesses", businessId, "bookings");

  try {
    const q = query(col, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Composite-index error is common. Retry without orderBy — we sort in JS.
    console.warn("[analytics-service] orderBy failed, retrying unordered:", err.message);
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}

/**
 * Build {from, to} Date objects from a preset string.
 * Presets: "this_week" | "this_month" | "this_year" | "all_time"
 */
export function buildRange(preset) {
  const now = new Date();

  switch (preset) {
    case "this_week": {
      const from = new Date(now);
      from.setDate(now.getDate() - now.getDay()); // back to Sunday
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(from.getDate() + 6);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    case "this_month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from, to };
    }
    case "this_year": {
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { from, to };
    }
    case "all_time":
    default:
      return { from: null, to: null };
  }
}

/**
 * FIX #1 — Undated rows are now KEPT in range filters instead of being
 * silently dropped. A booking/batch with no event date AND no createdAt is
 * rare (usually a manual write or a bad import), but dropping it silently
 * caused counts to differ between "All Time" and "This Month".
 */
function filterByRange(bookings, from, to) {
  if (!from && !to) return bookings;
  return bookings.filter(b => {
    const d = bookingDate(b);
    if (!d) return true; // keep undated rather than silently hide it
    return isInRange(d, from, to);
  });
}

/* ============================================================================
   PUBLIC API
============================================================================ */

/**
 * Total revenue + booking count + average booking value for a period.
 * Also returns the previous equivalent period's revenue for % change.
 */
export async function getRevenueSummary(businessId, { from, to } = {}) {
  const all = await fetchAllBookings(businessId);
  const inRange = filterByRange(all, from, to);

  let totalRevenue = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;

  inRange.forEach(b => {
    const total = Number(b.payment?.total || 0);
    const paid = Number(b.payment?.paid || 0);
    totalRevenue += total;
    totalPaid += paid;
    totalOutstanding += Math.max(0, total - paid);
  });

  // Previous period = same length immediately before {from}
  let previousRevenue = 0;
  if (from && to) {
    const spanMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(from.getTime() - spanMs - 1);
    const prevBookings = filterByRange(all, prevFrom, prevTo);
    previousRevenue = prevBookings.reduce(
      (s, b) => s + Number(b.payment?.total || 0), 0
    );
  }

  const changePct = previousRevenue > 0
    ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
    : null;

  return {
    totalRevenue,
    totalPaid,
    totalOutstanding,
    bookingCount: inRange.length,
    avgBooking: inRange.length ? Math.round(totalRevenue / inRange.length) : 0,
    previousRevenue,
    changePct
  };
}

/**
 * Counts for the snapshot cards.
 */
export async function getActivitySnapshot(businessId, { from, to } = {}) {
  const all = await fetchAllBookings(businessId);
  const inRange = filterByRange(all, from, to);
  const now = new Date();

  const returned = inRange.filter(b => b.status === "returned").length;
  const active = inRange.filter(b => b.status === "active").length;

  // Owed / overdue computed across ALL bookings (except cancelled),
  // because debts don't disappear when the period ends.
  const owedTotal = all.reduce((sum, b) => {
    if (!isDebtActive(b)) return sum;
    const total = Number(b.payment?.total || 0);
    const paid = Number(b.payment?.paid || 0);
    return sum + Math.max(0, total - paid);
  }, 0);

  const overdue = all.filter(b => {
    if (!isDebtActive(b)) return false;
    if (b.status === "returned") return false;
    const ret = toDate(b.event?.returnDate);
    return ret && ret < now;
  }).length;

  const damagesTotal = inRange.reduce((sum, b) => {
    if (!Array.isArray(b.damages)) return sum;
    return sum + b.damages.reduce(
      (s, d) => s + Number(d.amount || 0), 0
    );
  }, 0);

  return {
    bookingCount: inRange.length,
    returned,
    active,
    owedTotal,
    overdue,
    damagesTotal
  };
}

/**
 * Who owes you money — grouped by client, sorted biggest debt first.
 * Only considers bookings that aren't fully paid AND aren't cancelled.
 */
export async function getOutstandingByClient(businessId) {
  const all = await fetchAllBookings(businessId);
  const byClient = {};

  all.forEach(b => {
    if (!isDebtActive(b)) return;

    const total = Number(b.payment?.total || 0);
    const paid = Number(b.payment?.paid || 0);
    const owed = Math.max(0, total - paid);
    if (owed <= 0) return;

    const name = b.client?.name || "Unknown";
    const phone = b.client?.phone || "";
    const created = bookingDate(b); // may be null

    if (!byClient[name]) {
      byClient[name] = {
        name,
        phone,
        totalOwed: 0,
        bookingCount: 0,
        oldestSince: created
      };
    }
    byClient[name].totalOwed += owed;
    byClient[name].bookingCount += 1;

    // Track the OLDEST still-unpaid booking. Only replace if the new date
    // is earlier, and only if we actually have a date to compare.
    if (created && (!byClient[name].oldestSince || created < byClient[name].oldestSince)) {
      byClient[name].oldestSince = created;
    }
    if (!byClient[name].phone && phone) byClient[name].phone = phone;
  });

  const today = new Date();
  return Object.values(byClient)
    .map(c => {
      const daysSince = c.oldestSince
        ? Math.max(0, Math.floor((today - c.oldestSince) / 86400000))
        : null; // unknown, not "today"
      return { ...c, daysSince };
    })
    .sort((a, b) => b.totalOwed - a.totalOwed);
}

/**
 * Best customers — sorted by total paid, biggest first.
 */
export async function getBestCustomers(businessId, { from, to, limit = 10 } = {}) {
  const all = await fetchAllBookings(businessId);
  const inRange = filterByRange(all, from, to);
  const byClient = {};

  inRange.forEach(b => {
    const name = b.client?.name || "Unknown";
    const phone = b.client?.phone || "";
    const total = Number(b.payment?.total || 0);
    const paid = Number(b.payment?.paid || 0);

    if (!byClient[name]) {
      byClient[name] = {
        name,
        phone,
        totalSpent: 0,
        bookingCount: 0,
        allPaid: true
      };
    }
    byClient[name].totalSpent += paid;
    byClient[name].bookingCount += 1;
    if (paid < total) byClient[name].allPaid = false;
    if (!byClient[name].phone && phone) byClient[name].phone = phone;
  });

  return Object.values(byClient)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);
}

/**
 * Most rented items — sorted by revenue earned, biggest first.
 */
export async function getTopItems(businessId, { from, to, limit = 10 } = {}) {
  const all = await fetchAllBookings(businessId);
  const inRange = filterByRange(all, from, to);
  const byItem = {};

  inRange.forEach(b => {
    (b.items || []).forEach(it => {
      const name = it.name || "Unknown";
      const qty = Number(it.qty || 0);
      const revenue = Number(it.total || (qty * Number(it.price || 0)) || 0);

      if (!byItem[name]) {
        byItem[name] = {
          name,
          unitsRented: 0,
          revenue: 0,
          timesBooked: 0,
          isCustom: !!it.isCustom
        };
      }
      byItem[name].unitsRented += qty;
      byItem[name].revenue += revenue;
      byItem[name].timesBooked += 1;
    });
  });

  return Object.values(byItem)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/**
 * FIX #2 — Monthly buckets now accept an `anchorDate` so two parallel calls
 * (customer + partner) can be built from the EXACT same "now". Without this,
 * a rare midnight rollover between the two awaits could shift one array by a
 * month and misalign the stacked chart.
 */
export async function getMonthlyRevenue(businessId, { months = 12, anchorDate = null } = {}) {
  const all = await fetchAllBookings(businessId);
  const now = anchorDate || new Date();
  const buckets = {};

  // Seed the last N months with 0 so gaps show as empty bars.
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets[key] = 0;
  }

  all.forEach(b => {
    const d = bookingDate(b);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key in buckets) {
      buckets[key] += Number(b.payment?.total || 0);
    }
  });

  return Object.entries(buckets).map(([key, revenue]) => {
    const [y, m] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    return {
      key,
      label: date.toLocaleString("en-NG", { month: "short", year: "2-digit" }),
      revenue
    };
  });
}

/**
 * Damage losses — three grouped views.
 * Returns { byItem, byClient, cautionRecovery }.
 */
export async function getDamageReport(businessId, { from, to } = {}) {
  const all = await fetchAllBookings(businessId);
  const inRange = filterByRange(all, from, to);

  const byItem = {};
  const byClient = {};

  let totalDamageAmount = 0;
  let totalCautionKept = 0;
  let totalCautionReturned = 0;

  inRange.forEach(b => {
    // Caution settlement is per-booking, not per-damage.
    const kept = Number(b.payment?.cautionFeeKept || 0);
    const returned = Number(b.payment?.cautionFeeReturned || 0);
    totalCautionKept += kept;
    totalCautionReturned += returned;

    (b.damages || []).forEach(d => {
      const itemName = d.itemName || "Unknown";
      const qty = Number(d.quantity || 0);
      const amount = Number(d.amount || 0);
      totalDamageAmount += amount;

      // By item
      if (!byItem[itemName]) {
        byItem[itemName] = { name: itemName, timesDamaged: 0, unitsLost: 0, amount: 0 };
      }
      byItem[itemName].timesDamaged += 1;
      byItem[itemName].unitsLost += qty;
      byItem[itemName].amount += amount;

      // By client
      const clientName = b.client?.name || "Unknown";
      if (!byClient[clientName]) {
        byClient[clientName] = { name: clientName, timesDamaged: 0, amount: 0 };
      }
      byClient[clientName].timesDamaged += 1;
      byClient[clientName].amount += amount;
    });
  });

  const revenueSummary = await getRevenueSummary(businessId, { from, to });
  const damageRatePct = revenueSummary.totalRevenue > 0
    ? (totalDamageAmount / revenueSummary.totalRevenue) * 100
    : 0;

  return {
    totalDamageAmount,
    totalCautionKept,
    totalCautionReturned,
    // Net = what damages cost you AFTER caution fee recovery.
    // Negative means you lost money. Positive means you came out ahead.
    netDamageCost: totalDamageAmount - totalCautionKept,
    damageRatePct,
    byItem: Object.values(byItem).sort((a, b) => b.amount - a.amount),
    byClient: Object.values(byClient).sort((a, b) => b.amount - a.amount)
  };
}

/**
 * One-call aggregate — fetch every dataset the page needs at once.
 * Saves 5+ Firestore reads when rendering the full page.
 */
export async function getFullAnalytics(businessId, { from, to } = {}) {
  const all = await fetchAllBookings(businessId);
  const inRange = filterByRange(all, from, to);
  const now = new Date();

  // ── Revenue ──
  let totalRevenue = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;
  inRange.forEach(b => {
    const t = Number(b.payment?.total || 0);
    const p = Number(b.payment?.paid || 0);
    totalRevenue += t;
    totalPaid += p;
    totalOutstanding += Math.max(0, t - p);
  });

  let previousRevenue = 0;
  if (from && to) {
    const spanMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(from.getTime() - spanMs - 1);
    previousRevenue = filterByRange(all, prevFrom, prevTo)
      .reduce((s, b) => s + Number(b.payment?.total || 0), 0);
  }
  const changePct = previousRevenue > 0
    ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
    : null;

  // ── Snapshot ──
  const returned = inRange.filter(b => b.status === "returned").length;
  const active = inRange.filter(b => b.status === "active").length;
  const owedTotal = all.reduce((sum, b) => {
    if (!isDebtActive(b)) return sum;
    const t = Number(b.payment?.total || 0);
    const p = Number(b.payment?.paid || 0);
    return sum + Math.max(0, t - p);
  }, 0);
  const overdue = all.filter(b => {
    if (!isDebtActive(b)) return false;
    if (b.status === "returned") return false;
    const ret = toDate(b.event?.returnDate);
    return ret && ret < now;
  }).length;

  // ── Outstanding by client ──
  const owedByClient = {};
  all.forEach(b => {
    if (!isDebtActive(b)) return;

    const t = Number(b.payment?.total || 0);
    const p = Number(b.payment?.paid || 0);
    const owed = Math.max(0, t - p);
    if (owed <= 0) return;

    const name = b.client?.name || "Unknown";
    const phone = b.client?.phone || "";
    const created = bookingDate(b); // may be null

    if (!owedByClient[name]) {
      owedByClient[name] = { name, phone, totalOwed: 0, bookingCount: 0, oldestSince: created };
    }
    owedByClient[name].totalOwed += owed;
    owedByClient[name].bookingCount += 1;
    if (created && (!owedByClient[name].oldestSince || created < owedByClient[name].oldestSince)) {
      owedByClient[name].oldestSince = created;
    }
    if (!owedByClient[name].phone && phone) owedByClient[name].phone = phone;
  });
  const outstandingByClient = Object.values(owedByClient)
    .map(c => ({
      ...c,
      daysSince: c.oldestSince
        ? Math.max(0, Math.floor((now - c.oldestSince) / 86400000))
        : null
    }))
    .sort((a, b) => b.totalOwed - a.totalOwed);

  // ── Best customers ──
  const bestByClient = {};
  inRange.forEach(b => {
    const name = b.client?.name || "Unknown";
    const phone = b.client?.phone || "";
    const t = Number(b.payment?.total || 0);
    const p = Number(b.payment?.paid || 0);

    if (!bestByClient[name]) {
      bestByClient[name] = { name, phone, totalSpent: 0, bookingCount: 0, allPaid: true };
    }
    bestByClient[name].totalSpent += p;
    bestByClient[name].bookingCount += 1;
    if (p < t) bestByClient[name].allPaid = false;
    if (!bestByClient[name].phone && phone) bestByClient[name].phone = phone;
  });
  const bestCustomers = Object.values(bestByClient)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // ── Top items ──
  const byItem = {};
  inRange.forEach(b => {
    (b.items || []).forEach(it => {
      const name = it.name || "Unknown";
      const qty = Number(it.qty || 0);
      const revenue = Number(it.total || (qty * Number(it.price || 0)) || 0);
      if (!byItem[name]) {
        byItem[name] = { name, unitsRented: 0, revenue: 0, timesBooked: 0, isCustom: !!it.isCustom };
      }
      byItem[name].unitsRented += qty;
      byItem[name].revenue += revenue;
      byItem[name].timesBooked += 1;
    });
  });
  const topItems = Object.values(byItem)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // ── Damage report ──
  const damageByItem = {};
  const damageByClient = {};
  let totalDamageAmount = 0;
  let totalCautionKept = 0;
  let totalCautionReturned = 0;

  inRange.forEach(b => {
    totalCautionKept += Number(b.payment?.cautionFeeKept || 0);
    totalCautionReturned += Number(b.payment?.cautionFeeReturned || 0);

    (b.damages || []).forEach(d => {
      const itemName = d.itemName || "Unknown";
      const qty = Number(d.quantity || 0);
      const amount = Number(d.amount || 0);
      totalDamageAmount += amount;

      if (!damageByItem[itemName]) {
        damageByItem[itemName] = { name: itemName, timesDamaged: 0, unitsLost: 0, amount: 0 };
      }
      damageByItem[itemName].timesDamaged += 1;
      damageByItem[itemName].unitsLost += qty;
      damageByItem[itemName].amount += amount;

      const clientName = b.client?.name || "Unknown";
      if (!damageByClient[clientName]) {
        damageByClient[clientName] = { name: clientName, timesDamaged: 0, amount: 0 };
      }
      damageByClient[clientName].timesDamaged += 1;
      damageByClient[clientName].amount += amount;
    });
  });

  const damageReport = {
    totalDamageAmount,
    totalCautionKept,
    totalCautionReturned,
    netDamageCost: totalDamageAmount - totalCautionKept,
    damageRatePct: totalRevenue > 0 ? (totalDamageAmount / totalRevenue) * 100 : 0,
    byItem: Object.values(damageByItem).sort((a, b) => b.amount - a.amount),
    byClient: Object.values(damageByClient).sort((a, b) => b.amount - a.amount)
  };

  return {
    revenue: {
      totalRevenue,
      totalPaid,
      totalOutstanding,
      bookingCount: inRange.length,
      avgBooking: inRange.length ? Math.round(totalRevenue / inRange.length) : 0,
      previousRevenue,
      changePct
    },
    snapshot: {
      bookingCount: inRange.length,
      returned,
      active,
      owedTotal,
      overdue,
      damagesTotal: totalDamageAmount
    },
    outstandingByClient,
    bestCustomers,
    topItems,
    damageReport,
    bookingCountInRange: inRange.length
  };
}

/* ============================================================================
   RENTAL PARTNERS — lent-out batches only
   ----------------------------------------------------------------------------
   Reads `businesses/{id}/externalRentals` and keeps ONLY batch-shaped docs
   (those with an `items[]` array). The legacy one-doc-per-item shape lives in
   the same collection — those are skipped here.

   Borrowed-in is intentionally NOT aggregated: borrowed items come from
   bookings, which are already counted in the customer analytics above.
============================================================================ */

/** True if this externalRentals doc uses the batch schema (has items[]). */
function isBatchDoc(d) {
  return Array.isArray(d.items);
}

/**
 * Batch date we filter by: the lend-out date, falling back to createdAt.
 * Matches the semantics of bookingDate() for customer bookings.
 */
function batchDate(b) {
  return toDate(b.rentalDate) || toDate(b.createdAt) || null;
}

async function fetchAllBatches(businessId) {
  if (!businessId) throw new Error("analytics-service: businessId required");

  const col = collection(db, "businesses", businessId, "externalRentals");
  let snap;

  try {
    const q = query(col, orderBy("createdAt", "desc"));
    snap = await getDocs(q);
  } catch (err) {
    console.warn("[analytics-service] externalRentals orderBy failed, retrying unordered:", err.message);
    snap = await getDocs(col);
  }

  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(isBatchDoc); // ignore legacy one-doc-per-item rows
}

/**
 * FIX #1 (batch side) — Undated batches are now KEPT in range filters.
 */
function filterBatchesByRange(batches, from, to) {
  if (!from && !to) return batches;
  return batches.filter(b => {
    const d = batchDate(b);
    if (!d) return true; // keep undated rather than silently hide it
    return isInRange(d, from, to);
  });
}

/** A lent-out batch is "settled" once it's marked returned. */
function isBatchOutstanding(b) {
  return b.status !== "returned";
}

function batchOwed(b) {
  const total = Number(b.payment?.total || 0);
  const paid = Number(b.payment?.paid || 0);
  return Math.max(0, total - paid);
}

/**
 * FULL rental-partners analytics for one range.
 * Returns the same shape family as getFullAnalytics, so analytics.js can
 * render it with the same helpers.
 */
export async function getRentalPartnerAnalytics(businessId, { from, to } = {}) {
  const all = await fetchAllBatches(businessId);
  const inRange = filterBatchesByRange(all, from, to);
  const now = new Date();

  // ── Revenue (lent-out) ──
  let totalRevenue = 0;
  let totalPaid = 0;
  let totalOutstandingInRange = 0;

  inRange.forEach(b => {
    const t = Number(b.payment?.total || 0);
    const p = Number(b.payment?.paid || 0);
    totalRevenue += t;
    totalPaid += p;
    totalOutstandingInRange += Math.max(0, t - p);
  });

  // Previous equivalent period (same span, immediately before `from`)
  let previousRevenue = 0;
  if (from && to) {
    const spanMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(from.getTime() - spanMs - 1);
    previousRevenue = filterBatchesByRange(all, prevFrom, prevTo)
      .reduce((s, b) => s + Number(b.payment?.total || 0), 0);
  }

  const changePct = previousRevenue > 0
    ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
    : null;

  // ── Snapshot ──
  const returned = inRange.filter(b => b.status === "returned").length;
  const active = inRange.filter(b => b.status === "active").length;

  // Owed / overdue are lifetime — debts don't vanish when the period ends.
  const owedTotal = all.reduce((sum, b) => {
    if (!isBatchOutstanding(b)) return sum;
    return sum + batchOwed(b);
  }, 0);

  const overdue = all.filter(b => {
    if (!isBatchOutstanding(b)) return false;
    const ret = toDate(b.returnDate);
    return ret && ret < now;
  }).length;

  // Overbooked batches still open — flag for the UI
  const overbookedOpen = all.filter(b =>
    isBatchOutstanding(b) && (b.items || []).some(i => Number(i.shortage || 0) > 0)
  ).length;

  const damagesTotal = inRange.reduce((sum, b) => {
    if (!Array.isArray(b.items)) return sum;
    return sum + b.items.reduce(
      (s, i) => s + (i.damaged ? Number(i.damageAmount || 0) : 0), 0
    );
  }, 0);

  // ── Outstanding by partner (rental business) ──
  const owedByPartner = {};
  all.forEach(b => {
    if (!isBatchOutstanding(b)) return;
    const owed = batchOwed(b);
    if (owed <= 0) return;

    const name = b.rentedTo || "Unknown partner";
    const phone = b.contactPhone || "";
    const created = batchDate(b);

    if (!owedByPartner[name]) {
      owedByPartner[name] = {
        name,
        phone,
        totalOwed: 0,
        batchCount: 0,
        oldestSince: created
      };
    }
    owedByPartner[name].totalOwed += owed;
    owedByPartner[name].batchCount += 1;
    if (created && (!owedByPartner[name].oldestSince || created < owedByPartner[name].oldestSince)) {
      owedByPartner[name].oldestSince = created;
    }
    if (!owedByPartner[name].phone && phone) owedByPartner[name].phone = phone;
  });

  const outstandingByPartner = Object.values(owedByPartner)
    .map(c => ({
      ...c,
      daysSince: c.oldestSince
        ? Math.max(0, Math.floor((now - c.oldestSince) / 86400000))
        : null
    }))
    .sort((a, b) => b.totalOwed - a.totalOwed);

  // ── Best partners (by amount paid during the period) ──
  const bestByPartner = {};
  inRange.forEach(b => {
    const name = b.rentedTo || "Unknown partner";
    const phone = b.contactPhone || "";
    const t = Number(b.payment?.total || 0);
    const p = Number(b.payment?.paid || 0);

    if (!bestByPartner[name]) {
      bestByPartner[name] = {
        name,
        phone,
        totalSpent: 0,
        batchCount: 0,
        allPaid: true
      };
    }
    bestByPartner[name].totalSpent += p;
    bestByPartner[name].batchCount += 1;
    if (p < t) bestByPartner[name].allPaid = false;
    if (!bestByPartner[name].phone && phone) bestByPartner[name].phone = phone;
  });

  const bestPartners = Object.values(bestByPartner)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // ── Top lent-out items ──
  const byItem = {};
  inRange.forEach(b => {
    (b.items || []).forEach(it => {
      const name = it.name || "Unknown";
      const qty = Number(it.qty || 0);
      const revenue = Number(it.total || (qty * Number(it.price || 0)) || 0);

      if (!byItem[name]) {
        byItem[name] = {
          name,
          unitsLent: 0,
          revenue: 0,
          timesLent: 0
        };
      }
      byItem[name].unitsLent += qty;
      byItem[name].revenue += revenue;
      byItem[name].timesLent += 1;
    });
  });

  const topItems = Object.values(byItem)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // ── Damage report (lent-out) ──
  const damageByItem = {};
  const damageByPartner = {};
  let totalDamageAmount = 0;

  inRange.forEach(b => {
    (b.items || []).forEach(it => {
      if (!it.damaged) return;
      const amount = Number(it.damageAmount || 0);
      if (amount <= 0) return;

      totalDamageAmount += amount;

      const itemName = it.name || "Unknown";
      if (!damageByItem[itemName]) {
        damageByItem[itemName] = { name: itemName, timesDamaged: 0, unitsLost: 0, amount: 0 };
      }
      damageByItem[itemName].timesDamaged += 1;
      damageByItem[itemName].unitsLost += Number(it.qty || 0);
      damageByItem[itemName].amount += amount;

      const partnerName = b.rentedTo || "Unknown partner";
      if (!damageByPartner[partnerName]) {
        damageByPartner[partnerName] = { name: partnerName, timesDamaged: 0, amount: 0 };
      }
      damageByPartner[partnerName].timesDamaged += 1;
      damageByPartner[partnerName].amount += amount;
    });
  });

  const damageReport = {
    totalDamageAmount,
    damageRatePct: totalRevenue > 0 ? (totalDamageAmount / totalRevenue) * 100 : 0,
    byItem: Object.values(damageByItem).sort((a, b) => b.amount - a.amount),
    byPartner: Object.values(damageByPartner).sort((a, b) => b.amount - a.amount)
  };

  return {
    revenue: {
      totalRevenue,
      totalPaid,
      totalOutstandingInRange,
      batchCount: inRange.length,
      avgBatch: inRange.length ? Math.round(totalRevenue / inRange.length) : 0,
      previousRevenue,
      changePct
    },
    snapshot: {
      batchCount: inRange.length,
      returned,
      active,
      owedTotal,
      overdue,
      overbookedOpen,
      damagesTotal
    },
    outstandingByPartner,
    bestPartners,
    topItems,
    damageReport
  };
}

/**
 * FIX #2 (batch side) — Accepts `anchorDate` so the stacked All Revenue chart
 * aligns perfectly with the customer monthly series.
 */
export async function getMonthlyLentOutRevenue(businessId, { months = 12, anchorDate = null } = {}) {
  const all = await fetchAllBatches(businessId);
  const now = anchorDate || new Date();
  const buckets = {};

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets[key] = 0;
  }

  all.forEach(b => {
    const d = batchDate(b);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key in buckets) {
      buckets[key] += Number(b.payment?.total || 0);
    }
  });

  return Object.entries(buckets).map(([key, revenue]) => {
    const [y, m] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    return {
      key,
      label: date.toLocaleString("en-NG", { month: "short", year: "2-digit" }),
      revenue
    };
  });
}