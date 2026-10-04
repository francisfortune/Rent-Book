// assets/js/rental-to-rental.js
// ============================================================================
// Rental to Rental — mirrors the Add + Bookings experience for the business's
// own lends to other rental companies.
//
// Add modal: auto-total (editable), live availability hints, receipt upload.
// List: sorted newest-first, overbooked badges, "Lent On" instead of Out Date.
// Detail modal: gradient header, overbooked + damaged + owing badges.
// Edit modal: no auto-total (Option A) — user's typed total is preserved.
// Return: per-item damage tracking, inventory math same as bookings.js.
// Notifications: on add/edit/return/delete + transition into overbooked.
//
// Borrowed In tab: grouped by vendor, overdue-first sort, vendor header
// deep-links to bookings.html?vendor=<name>.
// ============================================================================

import { auth, db } from "./firebase.js";
import { getBusinessIdByEmail } from "./shared.js";
import { sendPush } from "./onesignal.js";
import { uploadReceiptImage } from "./utils/upload.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  addLentOutBatch,
  updateLentOutBatch,
  markLentOutBatchReturned,
  deleteLentOutBatch,
  getBorrowedInFromBookings,
  getFreshInventory
} from "./services/rentalService.js";

/* =========================================================
   MODULE STATE
========================================================= */
let businessId = null;
let currentUser = null;
let currentRole = "viewer";
let currentBusinessName = "Our Business";

let inventoryItems = [];
let lentOutBatches = [];
let borrowedInRows = [];

let activeTab = "lentOut";
let lentOutUnsubscribe = null;

// Receipt staging for the Add modal
window._loReceiptFiles = [];

// Receipt staging for the Edit modal
window._editLoReceiptImages = [];

/* =========================================================
   SMALL UTILITIES
========================================================= */
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function disableBtn(btn) {
  if (!btn) return;
  btn.disabled = true;
  btn.style.opacity = "0.5";
  btn.style.cursor = "not-allowed";
}

function enableBtn(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.style.opacity = "";
  btn.style.cursor = "";
}

function normalizeRentalPhone(phone) {
  let cleaned = (phone || "").replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "234" + cleaned.slice(1);
  if (!cleaned.startsWith("234") && cleaned.length === 10) cleaned = "234" + cleaned;
  return cleaned;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function getRentalStatus(batch) {
  if (batch.status === "returned") return "returned";
  const today = todayStr();
  if (batch.rentalDate && today < batch.rentalDate) return "upcoming";
  if (batch.returnDate && today <= batch.returnDate) return "active";
  return "overdue";
}

function getBorrowedInDisplayStatus(row) {
  if (row.bookingStatus === "returned" || row.bookingStatus === "cancelled") return "returned";
  const today = todayStr();
  if (row.returnDate && today > row.returnDate) return "overdue";
  if (row.eventDate && today < row.eventDate) return "upcoming";
  return "active";
}

function computeOwing(batch) {
  return Math.max(0, Number(batch.payment?.total || 0) - Number(batch.payment?.paid || 0));
}

/** True if any item in the batch exceeded availability at save time. */
function isRentalOverbooked(batch) {
  return (batch.items || []).some(i => Number(i.shortage || 0) > 0);
}

/* =========================================================
   PILLS
========================================================= */
const STATUS_PALETTE = {
  upcoming: { bg: "bg-blue-100", text: "text-blue-800", dot: "bg-blue-500", border: "border-blue-200" },
  active: { bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500", border: "border-purple-200" },
  overdue: { bg: "bg-red-100", text: "text-red-800", dot: "bg-red-500", border: "border-red-200" },
  returned: { bg: "bg-green-100", text: "text-green-800", dot: "bg-green-500", border: "border-green-200" }
};

function renderStatusPill(status) {
  const p = STATUS_PALETTE[status] || STATUS_PALETTE.active;
  return `<span class="inline-flex items-center gap-1.5 ${p.bg} ${p.text} border ${p.border} rounded-full px-2.5 py-1 font-black uppercase tracking-wider whitespace-nowrap leading-none text-[10px]"><span class="inline-block w-1.5 h-1.5 rounded-full ${p.dot}"></span><span>${status}</span></span>`;
}

function renderDamagedPill() {
  return `<span class="inline-flex items-center gap-1.5 bg-red-100 text-red-800 border border-red-200 rounded-full px-2.5 py-1 font-black uppercase tracking-wider whitespace-nowrap leading-none text-[10px]"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span><span>Damaged</span></span>`;
}

function renderOwingPill() {
  return `<span class="inline-flex items-center gap-1.5 bg-orange-100 text-orange-800 border border-orange-200 rounded-full px-2.5 py-1 font-black uppercase tracking-wider whitespace-nowrap leading-none text-[10px]"><span class="inline-block w-1.5 h-1.5 rounded-full bg-orange-500"></span><span>Owing</span></span>`;
}

function renderOverbookedPill() {
  return `<span class="inline-flex items-center gap-1.5 bg-orange-100 text-orange-800 border border-orange-200 rounded-full px-2.5 py-1 font-black uppercase tracking-wider whitespace-nowrap leading-none text-[10px]"><span class="inline-block w-1.5 h-1.5 rounded-full bg-orange-500"></span><span>Overbooked</span></span>`;
}

function renderDirectionPill(direction) {
  return direction === "out"
    ? `<span class="pill" style="background:#f3e8ff;color:#6b21a8;"><span class="dot" style="background:#a855f7;"></span>&rarr; Out</span>`
    : `<span class="pill" style="background:#fef3c7;color:#92400e;"><span class="dot" style="background:#f59e0b;"></span>&larr; In</span>`;
}

/* =========================================================
   NOTIFICATIONS
========================================================= */
async function sendRentalNotification(message, type, deepLink = "/rental-to-rental.html") {
  try {
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message,
      type,
      triggeredBy: currentUser?.email || "System",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
    try {
      await sendPush(message, deepLink);
    } catch (pushErr) {
      console.warn("Push failed (non-blocking):", pushErr);
    }
  } catch (err) {
    console.error("sendRentalNotification failed:", err);
  }
}

/* =========================================================
   DATA LOADING
========================================================= */
async function refreshInventoryCache() {
  inventoryItems = await getFreshInventory(businessId);
}

async function loadBusinessMetadata() {
  let role = "viewer";
  const emailLower = currentUser.email ? currentUser.email.toLowerCase().trim() : "";
  const q = query(
    collection(db, "businessMembers"),
    where("businessId", "==", businessId),
    where("email", "==", emailLower)
  );
  const snap = await getDocs(q);
  if (!snap.empty) role = snap.docs[0].data().role;
  currentRole = role;

  const businessSnap = await getDoc(doc(db, "businesses", businessId));
  if (businessSnap.exists()) currentBusinessName = businessSnap.data().name || "Our Business";
}

function subscribeLentOut() {
  if (lentOutUnsubscribe) lentOutUnsubscribe();

  try {
    const ref = collection(db, "businesses", businessId, "externalRentals");
    lentOutUnsubscribe = onSnapshot(
      ref,
      snap => {
        lentOutBatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        lentOutBatches.sort((a, b) => {
          const ta = a.createdAt?.toDate?.()?.getTime?.() || new Date(a.createdAt || a.rentalDate || 0).getTime();
          const tb = b.createdAt?.toDate?.()?.getTime?.() || new Date(b.createdAt || b.rentalDate || 0).getTime();
          return tb - ta;
        });
        updateSummaryStats();
        if (activeTab === "lentOut") renderLentOutList();
      },
      async err => {
        console.warn("Lent-out subscription failed, falling back:", err);
        const fallbackSnap = await getDocs(collection(db, "businesses", businessId, "externalRentals"));
        lentOutBatches = fallbackSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        lentOutBatches.sort((a, b) => {
          const ta = a.createdAt?.toDate?.()?.getTime?.() || new Date(a.createdAt || a.rentalDate || 0).getTime();
          const tb = b.createdAt?.toDate?.()?.getTime?.() || new Date(b.createdAt || b.rentalDate || 0).getTime();
          return tb - ta;
        });
        updateSummaryStats();
        if (activeTab === "lentOut") renderLentOutList();
      }
    );
  } catch (err) {
    console.error("subscribeLentOut failed entirely:", err);
  }
}

async function loadBorrowedIn() {
  borrowedInRows = await getBorrowedInFromBookings(businessId);
  updateSummaryStats();
  if (activeTab === "borrowedIn") renderBorrowedInList();
}

/* =========================================================
   SUMMARY STRIP
========================================================= */
function updateSummaryStats() {
  const lentOutActive = lentOutBatches.filter(b => getRentalStatus(b) !== "returned").length;
  const borrowedInActive = borrowedInRows.filter(r => getBorrowedInDisplayStatus(r) !== "returned").length;
  const overdueCount =
    lentOutBatches.filter(b => getRentalStatus(b) === "overdue").length +
    borrowedInRows.filter(r => getBorrowedInDisplayStatus(r) === "overdue").length;

  const lo = document.getElementById("statLentOut");
  const bi = document.getElementById("statBorrowedIn");
  const od = document.getElementById("statOverdue");
  if (lo) lo.textContent = lentOutActive;
  if (bi) bi.textContent = borrowedInActive;
  if (od) od.textContent = overdueCount;
}

/* =========================================================
   TABS + FILTERS
========================================================= */
window.switchRentalTab = function (tab) {
  activeTab = tab;
  document.getElementById("tabLentOut").classList.toggle("active", tab === "lentOut");
  document.getElementById("tabBorrowedIn").classList.toggle("active", tab === "borrowedIn");
  document.getElementById("lentOutPanel").style.display = tab === "lentOut" ? "block" : "none";
  document.getElementById("borrowedInPanel").style.display = tab === "borrowedIn" ? "block" : "none";
  applyRentalFilters();
};

window.applyRentalFilters = function () {
  if (activeTab === "lentOut") renderLentOutList();
  else renderBorrowedInList();
};

function getFilteredLentOut() {
  const statusVal = document.getElementById("statusFilter")?.value || "";
  const search = (document.getElementById("searchFilter")?.value || "").trim().toLowerCase();
  return lentOutBatches.filter(b => {
    if (statusVal && getRentalStatus(b) !== statusVal) return false;
    if (search) {
      const haystack = `${b.rentedTo || ""} ${(b.items || []).map(i => i.name).join(" ")}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function getFilteredBorrowedIn() {
  const statusVal = document.getElementById("statusFilter")?.value || "";
  const search = (document.getElementById("searchFilter")?.value || "").trim().toLowerCase();
  return borrowedInRows.filter(r => {
    if (statusVal && getBorrowedInDisplayStatus(r) !== statusVal) return false;
    if (search) {
      const haystack = `${r.clientName || ""} ${r.itemName || ""} ${r.vendor || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/* =========================================================
   LIST RENDERING — LENT OUT
========================================================= */
function renderLentOutRow(batch) {
  const status = getRentalStatus(batch);
  const itemSummary = (batch.items || []).map(i => `${i.qty} \u00d7 ${i.name}`).join(", ") || "No items";
  const owing = computeOwing(batch) > 0 && status !== "returned";
  const overbooked = isRentalOverbooked(batch);

  return `
    <div class="rt-row" onclick="openLentOutDetail('${batch.id}')">
      <div style="flex:1; min-width:200px;">
        <p style="font-weight:800; color:#1f2937;">${escapeHtml(batch.rentedTo)}</p>
        <p style="font-size:0.8rem; color:#6b7280; margin-top:2px;">${escapeHtml(itemSummary)}</p>
        <p style="font-size:0.75rem; color:#9ca3af; margin-top:2px;">Lent on: ${batch.rentalDate || "\u2014"} &nbsp;•&nbsp; Return: ${batch.returnDate || "\u2014"}</p>
        <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
          ${renderDirectionPill("out")}
          ${renderStatusPill(status)}
          ${batch.damageStatus === "damaged" ? renderDamagedPill() : ""}
          ${overbooked ? renderOverbookedPill() : ""}
          ${owing ? renderOwingPill() : ""}
        </div>
      </div>
      <button type="button" class="rt-row-edit-btn" onclick="event.stopPropagation(); openLentOutEditModal('${batch.id}');" title="Edit">
        <span class="material-symbols-outlined" style="font-size:1.1rem;">edit</span>
      </button>
    </div>`;
}

function renderLentOutList() {
  const container = document.getElementById("lentOutList");
  if (!container) return;
  const rows = getFilteredLentOut();

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">output</span>
        <p>No lent-out batches yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = rows.map(renderLentOutRow).join("");
}

/* =========================================================
   LIST RENDERING — BORROWED IN (grouped by vendor)
========================================================= */

/**
 * Groups the filtered borrowed-in rows by vendor. Within each vendor, the
 * rows keep the order returned by getBorrowedInFromBookings() (which is
 * already per-booking chronological from the source query).
 *
 * Returns an array of vendor groups, sorted overdue-first:
 *   1. Vendors with any overdue item rise to the top.
 *   2. Within the same overdue-status bucket, vendors with more items first.
 *   3. Then alphabetically by vendor name.
 */
function groupBorrowedInByVendor(rows) {
  const groups = new Map();

  rows.forEach(row => {
    const vendorKey = (row.vendor || "Unknown vendor").trim();
    if (!groups.has(vendorKey)) {
      groups.set(vendorKey, {
        vendor: vendorKey,
        contact: row.vendorContact || "",
        rows: []
      });
    }
    const g = groups.get(vendorKey);
    g.rows.push(row);
    // First non-empty contact wins — source may only carry it on some rows.
    if (!g.contact && row.vendorContact) g.contact = row.vendorContact;
  });

  const list = Array.from(groups.values());

  list.forEach(g => {
    g.overdueCount = g.rows.filter(r => getBorrowedInDisplayStatus(r) === "overdue").length;
    g.activeCount = g.rows.length;
  });

  list.sort((a, b) => {
    // 1. Overdue-first
    const aOverdue = a.overdueCount > 0 ? 1 : 0;
    const bOverdue = b.overdueCount > 0 ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;

    // 2. More items first
    if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;

    // 3. Alphabetical
    return a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" });
  });

  return list;
}

function renderBorrowedInRow(row) {
  const status = getBorrowedInDisplayStatus(row);
  const customTag = row.isCustom
    ? ` <span style="font-size:0.65rem; color:#9ca3af; text-transform:uppercase;">(not in inventory)</span>`
    : "";

  return `
    <div class="rt-row" onclick="window.location.href='bookings.html?highlight=${row.bookingId}'">
      <div style="flex:1; min-width:200px;">
        <p style="font-weight:800; color:#1f2937;">${escapeHtml(row.itemName)} \u00d7 ${row.quantity}${customTag}</p>
        <p style="font-size:0.8rem; color:#6b7280; margin-top:2px;">${escapeHtml(row.clientName)} \u2014 ${row.eventDate || "No date"}</p>
        <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
          ${renderDirectionPill("in")}
          ${renderStatusPill(status)}
        </div>
      </div>
    </div>`;
}

function renderBorrowedInVendorCard(group) {
  const headerContact = group.contact
    ? `<p style="font-size:0.78rem; color:#6b7280; margin:4px 0 0;">${escapeHtml(group.contact)}</p>`
    : "";

  const overdueBadge = group.overdueCount > 0
    ? `<span class="inline-flex items-center gap-1.5 bg-red-100 text-red-800 border border-red-200 rounded-full px-2.5 py-1 font-black uppercase tracking-wider whitespace-nowrap leading-none text-[10px]"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>${group.overdueCount} overdue</span>`
    : "";

  return `
    <div class="rt-vendor-card" style="background:#fff; border:1px solid #e5e7eb; border-radius:14px; margin-bottom:14px; overflow:hidden;">
      <div class="rt-vendor-header"
           style="padding:14px 16px; background:#faf5ff; border-bottom:1px solid #f3e8ff; cursor:pointer;"
           onclick="window.location.href='bookings.html?vendor=${encodeURIComponent(group.vendor)}'">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <div style="min-width:0; flex:1;">
            <p style="font-weight:900; color:#6b21a8; font-size:0.95rem; margin:0; word-break:break-word;">
              ${escapeHtml(group.vendor)}
              <span class="material-symbols-outlined" style="font-size:0.9rem; vertical-align:middle; opacity:0.6; margin-left:4px;">open_in_new</span>
            </p>
            ${headerContact}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            <span style="font-size:0.72rem; font-weight:800; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">${group.activeCount} item${group.activeCount === 1 ? "" : "s"}</span>
            ${overdueBadge}
          </div>
        </div>
      </div>
      <div style="padding:6px 8px 8px;">
        ${group.rows.map(renderBorrowedInRow).join("")}
      </div>
    </div>`;
}

function renderBorrowedInList() {
  const container = document.getElementById("borrowedInList");
  if (!container) return;
  const rows = getFilteredBorrowedIn();

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">input</span>
        <p>Nothing borrowed in right now.</p>
      </div>`;
    return;
  }

  const groups = groupBorrowedInByVendor(rows);
  container.innerHTML = groups.map(renderBorrowedInVendorCard).join("");
}

/* =========================================================
   ADD LENT-OUT — modal
========================================================= */
function buildItemOptionsHTML(selectedId = "") {
  if (!inventoryItems.length) {
    return `<option value="">No inventory items — add some on the Inventory page</option>`;
  }
  const opts = inventoryItems.map(inv =>
    `<option value="${inv.id}" ${inv.id === selectedId ? "selected" : ""}>${escapeAttr(inv.name)} (${Number(inv.availableQuantity || 0)} free)</option>`
  ).join("");
  return `<option value="">Select an item</option>${opts}`;
}

function buildLentOutItemRowHTML() {
  return `
    <div class="item-row">
      <div class="item-row-main">
        <select class="item-name">${buildItemOptionsHTML()}</select>
        <input class="item-qty" type="number" min="1" value="1" placeholder="Qty">
        <input class="item-price" type="number" min="0" placeholder="Price (\u20a6)">
        <button type="button" class="remove-item-btn" onclick="this.closest('.item-row').remove(); updateLentOutSelectOptions(); window.clearLentOutTotalOverride(); recalcLentOutPreview();">\u2715</button>
      </div>
      <p class="item-avail-hint"></p>
    </div>`;
}

window.addLentOutItemRow = function () {
  const container = document.getElementById("loItemsContainer");
  if (!container) return;
  container.insertAdjacentHTML("beforeend", buildLentOutItemRowHTML());
  const row = container.lastElementChild;
  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");

  select.addEventListener("change", () => {
    updateLentOutSelectOptions();
    checkLentOutRowAvailability(row);
    clearLentOutTotalOverride();
    recalcLentOutPreview();
  });
  qtyInput.addEventListener("input", () => {
    checkLentOutRowAvailability(row);
    clearLentOutTotalOverride();
    recalcLentOutPreview();
  });
  priceInput.addEventListener("input", () => {
    clearLentOutTotalOverride();
    recalcLentOutPreview();
  });

  updateLentOutSelectOptions();
};

window.updateLentOutSelectOptions = function () {
  const selectedIds = Array.from(document.querySelectorAll("#loItemsContainer .item-name"))
    .map(s => s.value)
    .filter(Boolean);

  document.querySelectorAll("#loItemsContainer .item-name").forEach(select => {
    Array.from(select.options).forEach(opt => {
      if (!opt.value) return;
      opt.disabled = selectedIds.includes(opt.value) && select.value !== opt.value;
    });
  });
};

function checkLentOutRowAvailability(row) {
  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const hint = row.querySelector(".item-avail-hint");
  const itemId = select.value;
  const requested = Number(qtyInput.value || 0);

  if (!itemId) {
    hint.textContent = "";
    return;
  }

  const inv = inventoryItems.find(i => i.id === itemId);
  const free = Number(inv?.availableQuantity || 0);
  const remain = free - requested;

  if (requested > free) {
    hint.innerHTML = `\u26a0 Only ${free} free — ${Math.abs(remain)} over`;
    hint.style.color = "#b91c1c";
  } else {
    hint.innerHTML = `Available now: ${free} \u00b7 ${remain} will remain`;
    hint.style.color = "#059669";
  }
}

/**
 * Clears the "user override" flag so auto-calc resumes on the next recalc.
 */
function clearLentOutTotalOverride() {
  const totalInput = document.getElementById("loTotal");
  if (totalInput) delete totalInput.dataset.lastComputed;
}
// ✅ FIX: expose on window so inline onclick handlers (row ✕ button) can reach it
window.clearLentOutTotalOverride = clearLentOutTotalOverride;

/**
 * Auto-total — recalculates from item rows unless the user typed a value.
 * ✅ FIX: re-entrancy guard prevents the cascade that can freeze the field
 * when JS sets the value and the browser dispatches another input event.
 */
window.recalcLentOutPreview = function () {
  if (window._loRecalcRunning) return;
  window._loRecalcRunning = true;

  try {
    const totalInput = document.getElementById("loTotal");
    const paidInput = document.getElementById("loPaid");

    let itemsSubtotal = 0;
    document.querySelectorAll("#loItemsContainer .item-row").forEach(row => {
      const qty = Number(row.querySelector(".item-qty")?.value || 0);
      const price = Number(row.querySelector(".item-price")?.value || 0);
      itemsSubtotal += qty * price;
    });

    if (totalInput) {
      const lastComputed = totalInput.dataset.lastComputed;
      const currentVal = String(totalInput.value || "").trim();
      const isUserOverride =
        currentVal !== "" &&
        lastComputed !== undefined &&
        currentVal !== lastComputed;

      if (!isUserOverride) {
        totalInput.value = itemsSubtotal || 0;
        totalInput.dataset.lastComputed = String(itemsSubtotal || 0);
      }
    }

    const total = Number(totalInput?.value || 0);
    const paid = Number(paidInput?.value || 0);
    const balance = total - paid;

    const t = document.getElementById("loPreviewTotal");
    const p = document.getElementById("loPreviewPaid");
    const b = document.getElementById("loPreviewBalance");
    if (t) t.textContent = `\u20a6${total.toLocaleString()}`;
    if (p) p.textContent = `\u20a6${paid.toLocaleString()}`;
    if (b) b.textContent = `\u20a6${balance.toLocaleString()}`;
  } finally {
    window._loRecalcRunning = false;
  }
};

// ✅ FIX: single delegated listener so typing in Total or Paid always
// triggers a recalc, and Total typing is correctly recorded as an override.
(function wireAddTotalPaidInputs() {
  if (window._loTotalPaidWired === "1") return;
  window._loTotalPaidWired = "1";

  document.addEventListener("input", (e) => {
    if (!e.target) return;

    if (e.target.id === "loTotal") {
      // User typed → record their value so future recalcs leave it alone
      e.target.dataset.lastComputed = String(e.target.value || "");
      window.recalcLentOutPreview();
    } else if (e.target.id === "loPaid") {
      window.recalcLentOutPreview();
    }
  });
})();

/* ---------- Receipt upload (Add modal) ---------- */
function renderLoReceiptPreviews() {
  const list = document.getElementById("loReceiptPreviewList");
  const text = document.getElementById("loReceiptText");
  if (!list) return;

  list.innerHTML = (window._loReceiptFiles || []).map((entry, idx) => `
    <div style="position:relative; display:inline-block;">
      <img src="${entry.dataUrl}" alt="Receipt ${idx + 1}"
           style="max-width:90px; max-height:90px; border-radius:8px; object-fit:cover; border:1px solid #e2e8f0;">
      <button type="button" data-idx="${idx}"
              style="position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:50%; background:#dc2626; color:#fff; border:none; font-size:11px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;"
              class="remove-lo-receipt-btn">\u2715</button>
    </div>
  `).join("");

  list.querySelectorAll(".remove-lo-receipt-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      window._loReceiptFiles.splice(idx, 1);
      renderLoReceiptPreviews();
    });
  });

  if (text) {
    text.textContent = window._loReceiptFiles.length
      ? `${window._loReceiptFiles.length} image(s) attached`
      : "Tap to add receipt photo(s)";
  }
}

(function wireLoReceiptInput() {
  const input = document.getElementById("loReceiptInput");
  if (!input || input.dataset.wired === "1") return;
  input.dataset.wired = "1";
  input.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    let pending = files.length;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        window._loReceiptFiles.push({ file, dataUrl: ev.target.result });
        pending -= 1;
        if (pending === 0) renderLoReceiptPreviews();
      };
      reader.readAsDataURL(file);
    });

    input.value = "";
  });
})();

/* ---------- Toggle the Add Lent Out modal ---------- */
window.toggleAddLentOutForm = async function (forceShow) {
  const modal = document.getElementById("addLentOutModal");
  if (!modal) return;
  const show = forceShow !== undefined ? forceShow : modal.style.display !== "flex";

  if (!show) {
    modal.style.display = "none";
    document.body.style.overflow = "";
    return;
  }

  ["loBusinessName", "loContactPerson", "loContactPhone", "loOutDate", "loReturnDate", "loTotal", "loPaid", "loNotes"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  clearLentOutTotalOverride();

  window._loReceiptFiles = [];
  renderLoReceiptPreviews();

  const itemsContainer = document.getElementById("loItemsContainer");
  if (itemsContainer) {
    itemsContainer.innerHTML = `<p style="font-size:0.85rem;color:#9ca3af;padding:8px;">Loading inventory…</p>`;
  }

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  const modalCard = modal.querySelector(".modal-card");
  if (modalCard) modalCard.scrollTop = 0;

  try {
    await refreshInventoryCache();
  } catch (err) {
    console.error("Failed to load inventory for Add modal:", err);
  }

  if (itemsContainer) itemsContainer.innerHTML = "";
  window.addLentOutItemRow();
  window.recalcLentOutPreview();
};

/* ---------- Save the batch ---------- */
window.saveNewLentOutBatch = async function () {
  const btn = document.getElementById("saveLentOutBtn");
  const originalText = btn.textContent;
  disableBtn(btn);

  try {
    const rentedTo = document.getElementById("loBusinessName").value.trim();
    const outDate = document.getElementById("loOutDate").value;
    const returnDate = document.getElementById("loReturnDate").value;

    if (!rentedTo) throw new Error("Business name is required.");
    if (!outDate || !returnDate) throw new Error("Lent-on date and return date are required.");

    const items = [];
    document.querySelectorAll("#loItemsContainer .item-row").forEach(row => {
      const itemId = row.querySelector(".item-name").value;
      const qty = Number(row.querySelector(".item-qty").value || 0);
      const price = Number(row.querySelector(".item-price").value || 0);
      if (!itemId || qty <= 0) return;
      const inv = inventoryItems.find(i => i.id === itemId);
      items.push({ itemId, name: inv?.name || "Item", qty, price });
    });

    if (!items.length) throw new Error("Add at least one item.");

    btn.textContent = "Checking stock...";
    const freshInventory = await getFreshInventory(businessId);

    const itemsWithShortage = items.map(i => {
      const inv = freshInventory.find(x => x.id === i.itemId);
      const free = Number(inv?.availableQuantity || 0);
      const shortage = Math.max(0, i.qty - free);
      return { ...i, shortage, availableAtRental: free };
    });

    const overbooked = itemsWithShortage.filter(i => i.shortage > 0);
    if (overbooked.length) {
      const msg = overbooked
        .map(i => `${i.name}: only ${i.availableAtRental} free, lending ${i.qty} (${i.shortage} over)`)
        .join("\n");
      const proceed = confirm(`\u26a0 Not enough stock for:\n${msg}\n\nContinue anyway?`);
      if (!proceed) {
        enableBtn(btn);
        btn.textContent = originalText;
        return;
      }
    }

    const receiptImageUrls = [];
    if (window._loReceiptFiles.length) {
      btn.textContent = "Uploading receipts...";
      for (const entry of window._loReceiptFiles) {
        try {
          const url = await uploadReceiptImage(businessId, entry.file);
          if (url) receiptImageUrls.push(url);
        } catch (err) {
          console.warn("Receipt upload failed for one file:", err);
        }
      }
    }

    const batchData = {
      rentedTo,
      contactPerson: document.getElementById("loContactPerson").value.trim(),
      contactPhone: document.getElementById("loContactPhone").value.trim(),
      rentalDate: outDate,
      returnDate,
      notes: document.getElementById("loNotes").value.trim(),
      payment: {
        total: Number(document.getElementById("loTotal").value || 0),
        paid: Number(document.getElementById("loPaid").value || 0)
      },
      items: itemsWithShortage,
      receiptImages: receiptImageUrls
    };

    btn.textContent = "Saving...";
    await addLentOutBatch(businessId, batchData);
    await sendRentalNotification(`New lent-out batch to ${rentedTo} (${items.length} item(s))`, "rental_lent_out");

    if (overbooked.length) {
      const names = overbooked.map(i => `${i.name} (${i.shortage} over)`).join(", ");
      await sendRentalNotification(
        `OVERBOOKED — lent-out batch to ${rentedTo} exceeded stock: ${names}`,
        "rental_overbooked"
      );
    }

    window._loReceiptFiles = [];
    renderLoReceiptPreviews();
    window.toggleAddLentOutForm(false);
    await refreshInventoryCache();
  } catch (err) {
    console.error("saveNewLentOutBatch failed:", err);
    alert(err.message || "Failed to save lent-out batch.");
  } finally {
    enableBtn(btn);
    btn.textContent = originalText;
  }
};

/* =========================================================
   MODAL — shared overlay
========================================================= */
function showRentalModal() {
  document.getElementById("rentalModal").style.display = "flex";
  document.body.style.overflow = "hidden";
}

window.closeRentalModal = function () {
  document.getElementById("rentalModal").style.display = "none";
  document.body.style.overflow = "";
};

/* =========================================================
   DETAIL MODAL
========================================================= */
window.openLentOutDetail = function (id) {
  const batch = lentOutBatches.find(b => b.id === id);
  if (!batch) return;

  const status = getRentalStatus(batch);
  const owing = computeOwing(batch);
  const total = Number(batch.payment?.total || 0);
  const paid = Number(batch.payment?.paid || 0);
  const overbooked = isRentalOverbooked(batch);

  const statusGradients = {
    returned: "linear-gradient(135deg, #15803d 0%, #166534 100%)",
    active: "linear-gradient(135deg, #800080 0%, #4d004d 100%)",
    upcoming: "linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%)",
    overdue: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)"
  };

  const itemsHtml = (batch.items || []).map(i => `
    <div style="display:flex; flex-direction:column; gap:4px; padding:12px; background:white; border:1px solid #e5e7eb; border-radius:12px; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <p style="font-weight:800; color:#1f2937; margin:0;">
          ${escapeHtml(i.name)}
          ${i.damaged ? `<span style="font-size:9px; margin-left:6px; padding:2px 6px; border-radius:999px; background:#fee2e2; color:#b91c1c; font-weight:900; text-transform:uppercase;">Damaged</span>` : ""}
          ${Number(i.shortage || 0) > 0 ? `<span style="font-size:9px; margin-left:6px; padding:2px 6px; border-radius:999px; background:#ffedd5; color:#9a3412; font-weight:900; text-transform:uppercase;">Short ${i.shortage}</span>` : ""}
        </p>
        <span style="font-weight:800; color:#374151;">\u20a6${Number(i.total || 0).toLocaleString()}</span>
      </div>
      <p style="font-size:10px; color:#800080; font-weight:700; margin:0;">Qty: ${i.qty} @ \u20a6${Number(i.price || 0).toLocaleString()}</p>
    </div>`).join("");

  const receiptImgs = Array.isArray(batch.receiptImages) && batch.receiptImages.length
    ? batch.receiptImages
    : (batch.receiptImage ? [batch.receiptImage] : []);

  const receiptBlock = receiptImgs.length
    ? `<div style="margin-top:16px;">
        <p style="font-size:10px; font-weight:900; color:#800080; text-transform:uppercase; margin-bottom:8px;">Receipt Images (${receiptImgs.length})</p>
        <div style="display:grid; grid-template-columns:1fr; gap:10px;">
          ${receiptImgs.map((url, idx) => `
            <div style="background:white; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
              <img src="${url}" alt="Receipt ${idx + 1}" style="width:100%; max-height:260px; object-fit:contain;">
              <p style="font-size:10px; color:#6b7280; text-align:center; padding:6px 0; border-top:1px solid #f3f4f6; margin:0;">Receipt ${idx + 1} of ${receiptImgs.length}</p>
            </div>`).join("")}
        </div>
      </div>`
    : `<div style="margin-top:16px;">
        <p style="font-size:10px; font-weight:900; color:#9ca3af; text-transform:uppercase; margin-bottom:8px;">Receipt Images</p>
        <div style="background:#f9fafb; border:2px dashed #e5e7eb; border-radius:12px; padding:20px; text-align:center;">
          <span class="material-symbols-outlined" style="font-size:2rem; color:#d1d5db;">image</span>
          <p style="font-size:11px; color:#9ca3af; margin:4px 0 0;">No receipt image uploaded</p>
        </div>
      </div>`;

  const waLines = [];
  waLines.push(`*Rental to ${batch.rentedTo}*`);
  waLines.push("");
  waLines.push(`Lent on: ${batch.rentalDate || "\u2014"}`);
  waLines.push(`Return: ${batch.returnDate || "\u2014"}`);
  waLines.push("");
  waLines.push("Items:");
  (batch.items || []).forEach(i => waLines.push(`• ${i.name} \u00d7 ${i.qty} @ \u20a6${Number(i.price || 0).toLocaleString()}`));
  waLines.push("");
  waLines.push(`Total: \u20a6${total.toLocaleString()}`);
  waLines.push(`Paid: \u20a6${paid.toLocaleString()}`);
  waLines.push(`Balance: \u20a6${owing.toLocaleString()}`);
  const waText = waLines.join("\n");

  document.getElementById("rentalModalTitle").textContent = batch.rentedTo;
  document.getElementById("rentalModalContent").innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">

      <div style="background:${statusGradients[status]}; color:white; padding:18px 20px; border-radius:16px;">
        <p style="font-size:10px; letter-spacing:0.15em; text-transform:uppercase; opacity:0.85; margin:0 0 4px;">Business</p>
        <p style="font-size:1.35rem; font-weight:900; margin:0; word-break:break-word;">${escapeHtml(batch.rentedTo)}</p>
        ${batch.contactPerson || batch.contactPhone ? `
          <p style="font-size:0.85rem; opacity:0.9; margin:4px 0 0;">
            ${escapeHtml(batch.contactPerson || "")}${batch.contactPerson && batch.contactPhone ? " \u2022 " : ""}${escapeHtml(batch.contactPhone || "")}
          </p>` : ""}
        <div style="margin-top:12px; display:flex; gap:6px; flex-wrap:wrap;">
          ${renderStatusPill(status)}
          ${batch.damageStatus === "damaged" ? renderDamagedPill() : ""}
          ${overbooked ? renderOverbookedPill() : ""}
          ${owing > 0 && status !== "returned" ? renderOwingPill() : ""}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div style="background:#f9fafb; border-bottom:4px solid #800080; border-radius:12px; padding:12px;">
          <p style="font-size:10px; font-weight:900; color:#6b7280; text-transform:uppercase; margin:0;">Lent On</p>
          <p style="font-weight:900; color:#1f2937; margin:4px 0 0; font-size:0.95rem;">${batch.rentalDate || "\u2014"}</p>
        </div>
        <div style="background:#f9fafb; border-bottom:4px solid ${status === "overdue" ? "#dc2626" : "#800080"}; border-radius:12px; padding:12px;">
          <p style="font-size:10px; font-weight:900; color:#6b7280; text-transform:uppercase; margin:0;">Return Date</p>
          <p style="font-weight:900; color:${status === "overdue" ? "#dc2626" : "#1f2937"}; margin:4px 0 0; font-size:0.95rem;">${batch.returnDate || "\u2014"}</p>
        </div>
      </div>

      <div>
        <p style="font-size:10px; font-weight:900; color:#800080; text-transform:uppercase; margin:0 0 8px;">Items</p>
        <div>${itemsHtml || `<p style="font-size:0.85rem; color:#9ca3af;">No items.</p>`}</div>
      </div>

      <div style="background:white; border:2px solid #f3e8ff; border-radius:14px; padding:14px;">
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; text-align:center;">
          <div style="background:#f9fafb; padding:10px; border-radius:10px;">
            <p style="font-size:10px; color:#6b7280; font-weight:900; text-transform:uppercase; margin:0;">Total</p>
            <p style="font-weight:900; color:#1f2937; margin:2px 0 0;">\u20a6${total.toLocaleString()}</p>
          </div>
          <div style="background:#ecfdf5; padding:10px; border-radius:10px;">
            <p style="font-size:10px; color:#059669; font-weight:900; text-transform:uppercase; margin:0;">Paid</p>
            <p style="font-weight:900; color:#047857; margin:2px 0 0;">\u20a6${paid.toLocaleString()}</p>
          </div>
          <div style="background:${owing > 0 ? "#fef2f2" : "#ecfdf5"}; padding:10px; border-radius:10px;">
            <p style="font-size:10px; color:${owing > 0 ? "#b91c1c" : "#059669"}; font-weight:900; text-transform:uppercase; margin:0;">Balance</p>
            <p style="font-weight:900; color:${owing > 0 ? "#b91c1c" : "#047857"}; margin:2px 0 0;">\u20a6${owing.toLocaleString()}</p>
          </div>
        </div>
      </div>

      ${batch.notes ? `<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px; font-size:0.85rem; color:#374151;">${escapeHtml(batch.notes)}</div>` : ""}

      ${receiptBlock}

      ${batch.contactPhone ? `
        <button type="button" onclick='window.shareRentalToWhatsApp("${escapeAttr(batch.contactPhone)}", ${JSON.stringify(waText)})'
          style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:14px; background:#16a34a; color:white; border:none; border-radius:12px; font-weight:900; font-size:0.95rem; cursor:pointer; box-shadow:0 6px 20px rgba(22,163,74,0.25);">
          <span class="material-symbols-outlined" style="font-size:1.15rem;">share</span>
          Share via WhatsApp
        </button>` : ""}

      <div style="display:flex; flex-direction:column; gap:8px;">
        ${status !== "returned" ? `<button class="btn" onclick="openLentOutEditModal('${batch.id}')">Edit</button>` : ""}
        ${status !== "returned" ? `<button class="btn" style="background:#15803d;" onclick="openLentOutReturnModal('${batch.id}')">Mark Returned</button>` : ""}
        ${currentRole === "owner" ? `<button class="btn btn-danger" onclick="deleteLentOutBatchHandler('${batch.id}')">Delete</button>` : ""}
        <button class="btn btn-secondary" onclick="closeRentalModal()">Close</button>
      </div>
    </div>`;

  showRentalModal();
};

window.shareRentalToWhatsApp = function (phone, message) {
  if (!phone) return;
  const clean = normalizeRentalPhone(phone);
  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(message)}`, "_blank");
};

/* =========================================================
   EDIT MODAL — Option A: no auto-total
========================================================= */
function buildEditLoItemRowHTML(item = {}) {
  return `
    <div class="item-row" data-original-qty="${item.qty || 0}">
      <div class="item-row-main">
        <select class="item-name">${buildItemOptionsHTML(item.itemId || "")}</select>
        <input class="item-qty" type="number" min="1" value="${item.qty || 1}">
        <input class="item-price" type="number" min="0" value="${item.price || 0}">
        <button type="button" class="remove-item-btn" onclick="this.closest('.item-row').remove(); updateEditLoSelectOptions();">\u2715</button>
      </div>
      <p class="edit-item-avail-hint" style="width:100%; font-size:0.72rem; font-weight:600; margin-top:2px; color:#6b7280;"></p>
    </div>`;
}

window.updateEditLoSelectOptions = function () {
  const selectedIds = Array.from(document.querySelectorAll("#editLoItemsContainer .item-name"))
    .map(s => s.value)
    .filter(Boolean);

  document.querySelectorAll("#editLoItemsContainer .item-name").forEach(select => {
    Array.from(select.options).forEach(opt => {
      if (!opt.value) return;
      opt.disabled = selectedIds.includes(opt.value) && select.value !== opt.value;
    });
  });
};

window.addEditLoItemRow = function () {
  const container = document.getElementById("editLoItemsContainer");
  if (!container) return;
  container.insertAdjacentHTML("beforeend", buildEditLoItemRowHTML());
  const row = container.lastElementChild;
  row.querySelector(".item-name").addEventListener("change", () => {
    window.updateEditLoSelectOptions();
    checkEditLoRowAvailability(row);
  });
  row.querySelector(".item-qty").addEventListener("input", () => checkEditLoRowAvailability(row));
  window.updateEditLoSelectOptions();
};

function checkEditLoRowAvailability(row) {
  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const hint = row.querySelector(".edit-item-avail-hint");
  if (!hint) return;

  const itemId = select.value;
  if (!itemId) { hint.textContent = ""; return; }

  const inv = inventoryItems.find(i => i.id === itemId);
  const currentFree = Number(inv?.availableQuantity || 0);
  const requested = Number(qtyInput.value || 0);
  const remain = currentFree - requested;

  if (requested > currentFree) {
    hint.innerHTML = `\u26a0 ${Math.abs(remain)} over available (${currentFree} free now)`;
    hint.style.color = "#b91c1c";
  } else {
    hint.innerHTML = `${currentFree} free now \u00b7 ${remain} will remain`;
    hint.style.color = "#059669";
  }
}

window.renderEditLoReceiptGallery = function () {
  const gallery = document.getElementById("editLoReceiptGallery");
  if (!gallery) return;
  const imgs = window._editLoReceiptImages || [];

  if (!imgs.length) {
    gallery.innerHTML = `
      <div style="background:#f9fafb; border:2px dashed #d8b4fe; border-radius:8px; padding:20px; text-align:center; cursor:pointer;"
           onclick="document.getElementById('editLoReceiptInput').click()">
        <span class="material-symbols-outlined" style="font-size:2rem; color:#800080;">photo_camera</span>
        <p style="font-size:12px; color:#6b7280; margin:4px 0 0;">Tap to upload receipt image(s)</p>
      </div>`;
    return;
  }

  gallery.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:8px;">
      ${imgs.map((url, idx) => `
        <div style="position:relative; display:inline-block;">
          <img src="${url}" alt="Receipt ${idx + 1}"
               style="max-height:100px; max-width:140px; border-radius:8px; border:1px solid #e5e5e5; object-fit:contain; background:#fff;">
          <button type="button" onclick="window.removeEditLoReceipt(${idx})"
                  style="position:absolute; top:-6px; right:-6px; width:22px; height:22px; border-radius:50%; background:#dc2626; color:#fff; border:none; font-size:12px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;">\u2715</button>
        </div>
      `).join("")}
    </div>
    <button type="button" onclick="document.getElementById('editLoReceiptInput').click()"
            style="margin-top:10px; padding:8px 14px; font-size:12px; font-weight:700; color:#800080; background:#f5f0ff; border:1px solid #d8b4fe; border-radius:8px; cursor:pointer;">
      + Add another receipt
    </button>`;
};

window.removeEditLoReceipt = function (idx) {
  if (!Array.isArray(window._editLoReceiptImages)) return;
  window._editLoReceiptImages.splice(idx, 1);
  window.renderEditLoReceiptGallery();
};

window.openLentOutEditModal = async function (id) {
  const batch = lentOutBatches.find(b => b.id === id);
  if (!batch) return;

  if (!inventoryItems.length) {
    try {
      await refreshInventoryCache();
    } catch (err) {
      console.error("Failed to load inventory for Edit modal:", err);
    }
  }

  document.getElementById("rentalModalTitle").textContent = "Edit Lent Out";
  document.getElementById("rentalModalContent").innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div class="form-group">
        <label>Business Name</label>
        <input id="editLoBusinessName" value="${escapeAttr(batch.rentedTo)}" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;">
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px;">
        <div class="form-group"><label>Contact Person</label><input id="editLoContactPerson" value="${escapeAttr(batch.contactPerson || "")}" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;"></div>
        <div class="form-group"><label>Phone</label><input id="editLoContactPhone" value="${escapeAttr(batch.contactPhone || "")}" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;"></div>
        <div class="form-group"><label>Lent On</label><input type="date" id="editLoOutDate" value="${batch.rentalDate || ""}" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;"></div>
        <div class="form-group"><label>Return Date</label><input type="date" id="editLoReturnDate" value="${batch.returnDate || ""}" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;"></div>
      </div>

      <h4 style="color:#800080; font-size:0.95rem;">Items</h4>
      <div id="editLoItemsContainer" style="display:flex; flex-direction:column; gap:8px;"></div>
      <button type="button" class="btn btn-secondary" style="width:fit-content;" onclick="addEditLoItemRow()">+ Add Item</button>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div class="form-group"><label>Total (\u20a6)</label><input type="number" id="editLoTotal" value="${batch.payment?.total || 0}" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;"></div>
        <div class="form-group"><label>Amount Paid (\u20a6)</label><input type="number" id="editLoPaid" value="${batch.payment?.paid || 0}" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;"></div>
      </div>

      <div class="form-group"><label>Notes</label><textarea id="editLoNotes" style="padding:10px; border:1px solid #d8b4fe; border-radius:8px; outline:none;">${escapeHtml(batch.notes || "")}</textarea></div>

      <div style="display:flex; flex-direction:column; gap:6px; border-top:1px solid #e5e5e5; padding-top:12px;">
        <label style="font-size:12px; color:#800080; font-weight:600;">Receipt Images</label>
        <div id="editLoReceiptGallery"></div>
        <input type="file" id="editLoReceiptInput" accept="image/*" style="display:none;">
        <p id="editLoReceiptStatus" style="font-size:11px; color:#059669; margin-top:4px; display:none;">Image uploaded \u2705</p>
      </div>

      <div class="form-actions">
        <button class="btn btn-secondary" onclick="openLentOutDetail('${batch.id}')">Cancel</button>
        <button class="btn" id="saveLoEditBtn" onclick="saveLentOutEdit('${batch.id}')">Save Changes</button>
      </div>
    </div>`;

  const container = document.getElementById("editLoItemsContainer");
  container.innerHTML = "";
  (batch.items || []).forEach(item => {
    container.insertAdjacentHTML("beforeend", buildEditLoItemRowHTML(item));
  });
  document.querySelectorAll("#editLoItemsContainer .item-row").forEach(row => {
    row.querySelector(".item-name")?.addEventListener("change", () => {
      window.updateEditLoSelectOptions();
      checkEditLoRowAvailability(row);
    });
    row.querySelector(".item-qty")?.addEventListener("input", () => checkEditLoRowAvailability(row));
    checkEditLoRowAvailability(row);
  });
  window.updateEditLoSelectOptions();

  window._editLoReceiptImages =
    Array.isArray(batch.receiptImages) && batch.receiptImages.length
      ? [...batch.receiptImages]
      : (batch.receiptImage ? [batch.receiptImage] : []);
  window.renderEditLoReceiptGallery();

  const fileInput = document.getElementById("editLoReceiptInput");
  if (fileInput && fileInput.dataset.wired !== "1") {
    fileInput.dataset.wired = "1";
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById("editLoReceiptStatus");
      if (statusEl) { statusEl.textContent = "Uploading..."; statusEl.style.display = "block"; statusEl.style.color = "#6b7280"; }

      try {
        const url = await uploadReceiptImage(businessId, file);
        if (url) {
          window._editLoReceiptImages.push(url);
          window.renderEditLoReceiptGallery();
        }
        if (statusEl) { statusEl.textContent = "\u2705 Image uploaded!"; statusEl.style.color = "#059669"; setTimeout(() => { statusEl.style.display = "none"; }, 1500); }
      } catch (err) {
        console.error("Upload failed:", err);
        if (statusEl) { statusEl.textContent = "\u274c Upload failed"; statusEl.style.color = "#dc2626"; }
      }
      fileInput.value = "";
    });
  }

  showRentalModal();
};

window.saveLentOutEdit = async function (id) {
  const btn = document.getElementById("saveLoEditBtn");
  const originalText = btn.textContent;
  disableBtn(btn);

  try {
    const batch = lentOutBatches.find(b => b.id === id);
    if (!batch) throw new Error("Batch not found.");

    const newItems = [];
    document.querySelectorAll("#editLoItemsContainer .item-row").forEach(row => {
      const itemId = row.querySelector(".item-name").value;
      const qty = Number(row.querySelector(".item-qty").value || 0);
      const price = Number(row.querySelector(".item-price").value || 0);
      if (!itemId || qty <= 0) return;
      const inv = inventoryItems.find(i => i.id === itemId);
      newItems.push({
        itemId,
        name: inv?.name || "Item",
        qty,
        price,
        returned: false,
        returnedAt: null,
        damaged: false,
        damageAmount: 0
      });
    });

    if (!newItems.length) throw new Error("Add at least one item.");

    const freshInventory = await getFreshInventory(businessId);
    const itemsWithShortage = newItems.map(i => {
      const inv = freshInventory.find(x => x.id === i.itemId);
      const currentFree = Number(inv?.availableQuantity || 0);
      const shortage = Math.max(0, i.qty - currentFree);
      return { ...i, shortage, availableAtRental: currentFree };
    });

    const rentedTo = document.getElementById("editLoBusinessName").value.trim();
    const receiptImages = Array.isArray(window._editLoReceiptImages) ? [...window._editLoReceiptImages] : [];

    const updates = {
      rentedTo,
      contactPerson: document.getElementById("editLoContactPerson").value.trim(),
      contactPhone: document.getElementById("editLoContactPhone").value.trim(),
      rentalDate: document.getElementById("editLoOutDate").value,
      returnDate: document.getElementById("editLoReturnDate").value,
      notes: document.getElementById("editLoNotes").value.trim(),
      payment: {
        total: Number(document.getElementById("editLoTotal").value || 0),
        paid: Number(document.getElementById("editLoPaid").value || 0)
      },
      receiptImages
    };

    await updateLentOutBatch(businessId, id, updates, batch.items || [], itemsWithShortage);
    await sendRentalNotification(`Lent-out batch to ${rentedTo} was edited`, "rental_edited");

    const overbookedNow = itemsWithShortage.filter(i => i.shortage > 0);
    const wasOverbooked = isRentalOverbooked(batch);
    if (overbookedNow.length && !wasOverbooked) {
      const names = overbookedNow.map(i => `${i.name} (${i.shortage} over)`).join(", ");
      await sendRentalNotification(
        `OVERBOOKED — lent-out batch to ${rentedTo} is now over stock: ${names}`,
        "rental_overbooked"
      );
    }

    await refreshInventoryCache();

    window._editLoReceiptImages = [];
    window.openLentOutDetail(id);
  } catch (err) {
    console.error("saveLentOutEdit failed:", err);
    alert(err.message || "Failed to save changes.");
  } finally {
    enableBtn(btn);
    btn.textContent = originalText;
  }
};

/* =========================================================
   RETURN MODAL
========================================================= */
window.openLentOutReturnModal = function (id) {
  const batch = lentOutBatches.find(b => b.id === id);
  if (!batch) return;

  const rowsHtml = (batch.items || []).map(item => `
    <div class="item-row" data-item-id="${item.itemId || ""}" data-qty="${item.qty}" data-price="${item.price}" data-name="${escapeAttr(item.name)}">
      <div style="width:100%;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <p style="font-weight:700;">${escapeHtml(item.name)}</p>
          <p style="font-size:0.85rem; color:#6b7280;">${item.qty} \u00d7 \u20a6${Number(item.price || 0).toLocaleString()}</p>
        </div>
        <label style="display:flex; align-items:center; gap:6px; margin-top:6px; font-size:0.85rem; cursor:pointer;">
          <input type="checkbox" class="damage-toggle" onchange="toggleReturnDamageFields(this)"> Damaged?
        </label>
        <div class="damage-fields" style="display:none; gap:8px; margin-top:6px;">
          <input type="number" class="damage-qty" min="0" max="${item.qty}" placeholder="Damaged qty" style="flex:1; padding:8px; border:1px solid #fca5a5; border-radius:8px; outline:none;">
          <input type="number" class="damage-amount" min="0" placeholder="\u20a6 charge" style="flex:1; padding:8px; border:1px solid #fca5a5; border-radius:8px; outline:none;">
        </div>
      </div>
    </div>`).join("");

  document.getElementById("rentalModalTitle").textContent = `Return \u2014 ${batch.rentedTo}`;
  document.getElementById("rentalModalContent").innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <p style="font-size:0.85rem; color:#6b7280; margin:0;">Mark every item's condition, then confirm. Damaged items will reduce your inventory.</p>
      <div id="returnItemsContainer" style="display:flex; flex-direction:column; gap:10px;">${rowsHtml || `<p style="font-size:0.85rem;color:#9ca3af;">No items on this batch.</p>`}</div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="openLentOutDetail('${batch.id}')">Cancel</button>
        <button class="btn" style="background:#15803d;" id="confirmReturnBtn" onclick="confirmLentOutReturn('${batch.id}')">Confirm Return</button>
      </div>
    </div>`;

  showRentalModal();
};

window.toggleReturnDamageFields = function (checkbox) {
  const fields = checkbox.closest(".item-row").querySelector(".damage-fields");
  fields.style.display = checkbox.checked ? "flex" : "none";
};

window.confirmLentOutReturn = async function (id) {
  const btn = document.getElementById("confirmReturnBtn");
  const originalText = btn.textContent;
  disableBtn(btn);

  try {
    const batch = lentOutBatches.find(b => b.id === id);
    if (!batch) throw new Error("Batch not found.");

    const settledItems = [];
    document.querySelectorAll("#returnItemsContainer .item-row").forEach(row => {
      const itemId = row.dataset.itemId;
      const qty = Number(row.dataset.qty);
      const price = Number(row.dataset.price);
      const name = row.dataset.name;
      const damagedChecked = row.querySelector(".damage-toggle")?.checked || false;
      const damageQty = damagedChecked ? Number(row.querySelector(".damage-qty")?.value || 0) : 0;
      const damageAmount = damagedChecked ? Number(row.querySelector(".damage-amount")?.value || 0) : 0;
      settledItems.push({
        itemId,
        name,
        qty,
        price,
        damaged: damagedChecked && damageQty > 0,
        damageQty,
        damageAmount
      });
    });

    const result = await markLentOutBatchReturned(businessId, id, settledItems);

    await sendRentalNotification(
      `${batch.rentedTo}'s lent-out items were returned${result.damaged ? " \u2014 damage recorded" : ""}`,
      "rental_returned"
    );

    for (const item of settledItems) {
      if (item.damaged && item.itemId) {
        await sendRentalNotification(
          `${item.name} reduced due to damage on ${batch.rentedTo}'s return`,
          "inventory_damage",
          "/inventory.html"
        );
      }
    }

    closeRentalModal();
    await refreshInventoryCache();

    if (batch.contactPhone) {
      const summaryLines = settledItems.map(i =>
        `${i.name} x${i.qty}${i.damaged ? ` (damaged: \u20a6${Number(i.damageAmount || 0).toLocaleString()})` : ""}`
      );
      const msg = `Hi, this confirms the return of items rented to ${batch.rentedTo}:\n\n${summaryLines.join("\n")}\n\nThank you!`;
      const cleanPhone = normalizeRentalPhone(batch.contactPhone);
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, "_blank");
    }
  } catch (err) {
    console.error("confirmLentOutReturn failed:", err);
    alert(err.message || "Failed to confirm return.");
  } finally {
    enableBtn(btn);
    btn.textContent = originalText;
  }
};

/* =========================================================
   DELETE
========================================================= */
window.deleteLentOutBatchHandler = async function (id) {
  const batch = lentOutBatches.find(b => b.id === id);
  if (!batch) return;
  if (currentRole !== "owner") {
    alert("Only the owner can delete a lent-out batch.");
    return;
  }
  if (!confirm(`Delete the lent-out batch to ${batch.rentedTo}? This cannot be undone.`)) return;

  try {
    await deleteLentOutBatch(businessId, id, batch);
    await sendRentalNotification(`Lent-out batch to ${batch.rentedTo} was deleted`, "rental_deleted");
    closeRentalModal();
    await refreshInventoryCache();
  } catch (err) {
    console.error("deleteLentOutBatchHandler failed:", err);
    alert(err.message || "Failed to delete lent-out batch.");
  }
};

/* =========================================================
   AUTH INIT
========================================================= */
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    currentUser = user;
    businessId = await getBusinessIdByEmail(user.email, user);

    await loadBusinessMetadata();
    await refreshInventoryCache();

    const brandEl = document.getElementById("brand-name-mobile");
    if (brandEl) brandEl.textContent = currentBusinessName;
    const avatar = document.getElementById("user-avatar");
    if (avatar) avatar.textContent = (currentBusinessName || "?").trim().charAt(0).toUpperCase();

    subscribeLentOut();
    await loadBorrowedIn();
    updateSummaryStats();
  } catch (err) {
    console.error("Rental-to-rental init failed:", err);
    alert("Could not load this page: " + (err.message || err));
  }
});