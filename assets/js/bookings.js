import { auth, db } from "./firebase.js";
import { sendPush } from "./onesignal.js";
import { getBusinessIdByEmail } from "./shared.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  orderBy,
  onSnapshot,
  doc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { editBookingTransaction } from "./services/bookingService.js";
import { uploadReceiptImage } from "./utils/upload.js";
import { generateReceiptImage } from "./pdf.js";
import { checkDateAvailability, getAvailabilityMap, fetchActiveBookings, getBookingWindow } from "./services/availabilityService.js";
import { getBookingLifecycle, renderLifecycleBadge, renderOverbookedBadge, isBookingOverbooked, LIFECYCLE_BADGE_COLORS } from "./services/bookingStatus.js";

import { runAutomatedChecks } from "./services/reminderService.js";

let currentRole = "viewer";
let currentBusinessName = "";
let publicProfileSettings = { enabled: false, slug: "" }; // Store storefront status

// Shown in the return-settlement modal whenever a business hasn't customized
// its own return message yet. Kept in sync with the identical constant in
// setting.js and setup.js.
const DEFAULT_RETURN_MESSAGE_TEMPLATE =
  "Hi {clientName}, thank you for renting with {businessName}! We've received your items back in good condition. We truly appreciate your business and look forward to serving you again soon! 🙏";
let returnMessageTemplate = DEFAULT_RETURN_MESSAGE_TEMPLATE;

// State for whichever booking is currently open in the return-settlement
// modal -- set by openReturnSettlementModal, read by addDamageRow and
// confirmReturnSettlement.
let returnSettlementBooking = null;
let returnSettlementId = null;
let returnSettlementBusinessId = null;

/* =========================
   LISTEN TO BUSINESS PROFILE SETTINGS
========================= */
function listenToBusinessProfile(businessId) {
  const businessRef = doc(db, "businesses", businessId);
  onSnapshot(businessRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      currentBusinessName = data.name || "Our Business";
      publicProfileSettings = {
        enabled: data.publicProfile?.enabled || false,
        slug: data.publicProfile?.slug || ""
      };
      returnMessageTemplate = data.returnMessageTemplate || DEFAULT_RETURN_MESSAGE_TEMPLATE;
    }
  });
}

// Call this inside your onAuthStateChanged block after resolving businessId:
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const businessId = await getBusinessIdByEmail(user.email, user);
    listenToBusinessProfile(businessId); // Initializes live tracking of online status & slug
  } catch (err) {
    console.error("Failed to load business context for receipts:", err);
  }
});

/* =========================
   BADGE PRESENTATION
   One consistent visual language for every status pill in the app:
   - Fixed-height, rounded-full pill
   - Uppercase, letter-spaced micro-label
   - Small leading dot so the eye reads it as "live state"
   - Same font weight and padding everywhere

   The colors themselves come from LIFECYCLE_BADGE_COLORS in
   bookingStatus.js so this file and every other page agree on them.
========================= */
const LIFECYCLE_LABELS = {
  returned: "Returned",
  active: "Active",
  upcoming: "Upcoming",
  overdue: "Overdue"
};

// Fallback palette if bookingStatus.js doesn't export LIFECYCLE_BADGE_COLORS
const LIFECYCLE_FALLBACK = {
  returned:  { bg: "bg-green-100",  text: "text-green-800",  dot: "bg-green-500",  border: "border-green-200"  },
  active:    { bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500", border: "border-purple-200" },
  upcoming:  { bg: "bg-blue-100",   text: "text-blue-800",   dot: "bg-blue-500",   border: "border-blue-200"   },
  overdue:   { bg: "bg-red-100",    text: "text-red-800",    dot: "bg-red-500",    border: "border-red-200"    }
};

function getBadgePalette(key) {
  const fromShared = LIFECYCLE_BADGE_COLORS?.[key];
  if (fromShared && typeof fromShared === "object" && fromShared.bg) return fromShared;
  return LIFECYCLE_FALLBACK[key] || LIFECYCLE_FALLBACK.upcoming;
}

/**
 * Renders the lifecycle badge used across the whole bookings page.
 * Same class shape everywhere, only the palette changes per status.
 * @param {object} booking   the booking document
 * @param {string} sizeClass optional sizing override (e.g. "text-[10px]")
 */
function renderBadge(booking, sizeClass = "text-[10px]") {
  const life = getBookingLifecycle(booking);
  const key = life.key;
  const label = LIFECYCLE_LABELS[key] || key;
  const c = getBadgePalette(key);

  const days = life.daysText
    ? `<span class="ml-1.5 opacity-75 font-medium normal-case tracking-normal">· ${life.daysText}</span>`
    : "";

  return `
    <span class="inline-flex items-center gap-1.5 ${c.bg} ${c.text} ${c.border || ""} border
                 rounded-full px-2.5 py-1 font-black uppercase tracking-wider
                 whitespace-nowrap leading-none ${sizeClass}">
      <span class="inline-block w-1.5 h-1.5 rounded-full ${c.dot}"></span>
      <span>${label}</span>${days}
    </span>`;
}

/**
 * Small "vendor stock used" badge, used in the table rows and the modal header.
 */
function renderOverbookedPill() {
  return `
    <span class="inline-flex items-center gap-1.5 bg-orange-100 text-orange-800 border border-orange-200
                 rounded-full px-2.5 py-1 font-black uppercase tracking-wider
                 whitespace-nowrap leading-none text-[10px]">
      <span class="inline-block w-1.5 h-1.5 rounded-full bg-orange-500"></span>
      <span>Overbooked</span>
    </span>`;
}

// ===== FIX 2: Damaged badge — mirrors renderOverbookedPill but red =====
function renderDamagedPill() {
  return `
    <span class="inline-flex items-center gap-1.5 bg-red-100 text-red-800 border border-red-200
                 rounded-full px-2.5 py-1 font-black uppercase tracking-wider
                 whitespace-nowrap leading-none text-[10px]">
      <span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>
      <span>Damaged</span>
    </span>`;
}

// ===== CHANGE 1: renderOwingPill() — mirrors renderDamagedPill but red for owing balance =====
function renderOwingPill() {
  return `
    <span class="inline-flex items-center gap-1.5 bg-red-100 text-red-800 border border-red-200
                 rounded-full px-2.5 py-1 font-black uppercase tracking-wider
                 whitespace-nowrap leading-none text-[10px]">
      <span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>
      <span>Owing</span>
    </span>`;
}

/* =========================
   RECEIPT TEXT GENERATOR
========================= */
function generateReceiptText(booking) {
  const total = booking.payment?.total || 0;
  const paid = booking.payment?.paid || 0;
  const balance = total - paid;
  const cautionFee = Number(booking.payment?.cautionFee || 0);
  const transportationFee = Number(booking.payment?.transportationFee || 0);
  const otherFees = Number(booking.payment?.otherFees || 0);
  // Backward-compatible reader: old bookings have a single otherFees number;
  // new bookings have an itemized otherFeesList array.
  const otherFeeRows = Array.isArray(booking.payment?.otherFeesList) && booking.payment.otherFeesList.length
    ? booking.payment.otherFeesList
    : (otherFees > 0 ? [{ label: "Other Fees", amount: otherFees }] : []);

  let itemsSummary = booking.items?.map(i => {
    return `• ${i.name} (x${i.qty})\n${i.summary ? `   - ${i.summary}` : ""} - ₦${(i.total || 0).toLocaleString()}`;
  }).join("\n") || "No items";

  const deliveryDate = booking.event?.deliveryDate || booking.event?.date || "Not set";
  const returnDate  = booking.event?.returnDate || "Not set";

  let feesLines = "";
  if (cautionFee) feesLines += `Caution Fee: ₦${cautionFee.toLocaleString()}\n`;
  if (transportationFee) feesLines += `Transportation: ₦${transportationFee.toLocaleString()}\n`;
  otherFeeRows.forEach(f => {
    feesLines += `${f.label || "Other Fee"}: ₦${Number(f.amount || 0).toLocaleString()}\n`;
  });

  let receiptText = `*${currentBusinessName} Booking Receipt*\n\n` +
    `Hi ${booking.client.name}, your booking details are below:\n\n` +
    `Event Date: ${formatDateTime(booking.event.date)}\n` +
    `Delivery Date: ${formatDateTime(deliveryDate)}\n` +
    `Return Date: ${formatDateTime(returnDate)}\n` +
    `Location: ${booking.event.location || "Not specified"}\n\n` +
    `Items Ordered:\n${itemsSummary}\n\n` +
    (feesLines ? `${feesLines}\n` : "") +
    `Total: ₦${total.toLocaleString()}\n` +
    `Paid: ₦${paid.toLocaleString()}\n` +
    `Balance: ₦${balance.toLocaleString()}\n\n` +
    `Thank you for choosing ${currentBusinessName}!\n\n` +
    `---`;

  if (publicProfileSettings.enabled && publicProfileSettings.slug) {
    const storeUrl = `${window.location.origin}/p/${publicProfileSettings.slug}`;
    receiptText += `\n🌐 _View our Online Store and Leave Your Review: ${storeUrl}_`;
  }

  receiptText += `\n_Powered by Tracknrent_\n👉 https://tracknrent.vercel.app`;

  return receiptText;
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "234" + cleaned.slice(1);
  if (!cleaned.startsWith("234") && cleaned.length === 10) cleaned = "234" + cleaned;
  return cleaned;
}

window.shareToWhatsApp = function(phone, message) {
  if (!phone) return alert("No valid phone number found!");
  const cleanPhone = normalizePhone(phone);
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
};

/* =========================
   DYNAMIC STATUS CALCULATOR
========================= */
function getCalculatedStatus(booking) {
  return getBookingLifecycle(booking).key;
}

let inventoryItems = [];
let allBookingsGlobal = [];


async function loadInventory(businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "inventory"));
  inventoryItems = snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
}



/* =========================
   GENERATE RECEIPT IMAGE HTML
========================= */
function getReceiptImageHTML(booking) {
  if (!booking.receiptImage) {
    return `
      <div class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center">
        <span class="material-symbols-outlined text-4xl text-gray-400">image</span>
        <p class="text-xs text-gray-400 mt-2">No receipt image uploaded</p>
      </div>
    `;
  }

  return `
    <div class="relative group">
      <img src="${booking.receiptImage}" 
           alt="Receipt Image" 
           class="w-full max-h-64 object-contain rounded-xl border border-gray-200 shadow-sm"
           onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23f3f4f6%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%239ca3af%22 font-size=%2214%22 font-family=%22sans-serif%22%3ENo Image%3C/text%3E%3C/svg%3E'">
      <button onclick="window.open('${booking.receiptImage}', '_blank')"
              class="absolute top-2 right-2 bg-black/70 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
        <span class="material-symbols-outlined text-sm">open_in_new</span>
      </button>
    </div>
  `;
}

/* =========================
   BUSINESS LOOKUP
========================= */
async function loadBusinessMetadata(user, businessId) {
  const cachedRole = localStorage.getItem(`cachedMemberRole_${user.uid}`);
  const cachedName = localStorage.getItem(`cachedBusinessName_${user.uid}`);
  if (cachedRole && cachedName) {
    currentRole = cachedRole;
    currentBusinessName = cachedName;
    return;
  }

  let role = "viewer";
  const emailLower = user.email ? user.email.toLowerCase().trim() : "";
  const q = query(collection(db, "businessMembers"), where("businessId", "==", businessId), where("email", "==", emailLower));
  const snap = await getDocs(q);
  if (!snap.empty) {
    role = snap.docs[0].data().role;
  } else if (user.phoneNumber) {
    const q2 = query(collection(db, "businessMembers"), where("businessId", "==", businessId), where("phone", "==", user.phoneNumber.trim()));
    const snap2 = await getDocs(q2);
    if (!snap2.empty) role = snap2.docs[0].data().role;
  }
  currentRole = role;
  localStorage.setItem(`cachedMemberRole_${user.uid}`, role);

  const businessRef = doc(db, "businesses", businessId);
  const businessSnap = await getDoc(businessRef);
  if (businessSnap.exists()) {
    currentBusinessName = businessSnap.data().name;
    localStorage.setItem(`cachedBusinessName_${user.uid}`, currentBusinessName);
  }
}

/* =========================
   EXPORT BOOKINGS PDF
========================= */
document.getElementById("exportBookingsBtn")?.addEventListener("click", exportBookingsPDF);

async function exportBookingsPDF() {
  try {
    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF();
    docPDF.setFontSize(18);
    docPDF.text(`${currentBusinessName} Bookings Report`, 14, 20);
    docPDF.setFontSize(11);
    docPDF.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

    const rows = allBookingsGlobal.map(({ data }, index) => {
      const status = getCalculatedStatus(data);
      return [
        index + 1,
        data.client?.name || "",
        data.client?.phone || "",
        data.event?.type || "",
        data.event?.date || "",
        `₦${(data.payment?.total || 0).toLocaleString()}`,
        `₦${(data.payment?.paid || 0).toLocaleString()}`,
        status.toUpperCase()
      ];
    });

    docPDF.autoTable({
      startY: 35,
      head: [["#", "Client", "Phone", "Event", "Date", "Total", "Paid", "Status"]],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [128, 0, 128] }
    });

    docPDF.save(`Bookings_Report_${Date.now()}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Failed to export PDF");
  }
}

/* =========================
   RETURN BOOKING
========================= */
/* =========================
   RETURN BOOKING -- entry point (unchanged name/signature so the
   "MARK RETURNED" button's markup never has to change). Now opens the
   Return Settlement modal instead of marking returned immediately.
========================= */
window.returnBooking = async function(bookingId, businessId, items) {
  if (!items || items.length === 0) { alert("No items found in booking"); return; }
  if (currentRole === "viewer") { alert("Permission denied: viewers cannot process returns."); return; }

  // ===== CHANGE 4: Combined reminder (owing + borrowed) in one confirm =====
  // We need the booking doc to compute owing. Fetch it here, then decide
  // whether a confirm is needed at all.
  try {
    const bookingRef = doc(db, "businesses", businessId, "bookings", bookingId);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) { alert("Booking not found"); return; }

    const booking = { id: bookingId, ...snap.data() };

    const owing = Math.max(
      0,
      Number(booking.payment?.total || 0) - Number(booking.payment?.paid || 0)
    );
    const hasBorrowedItems = items.some(i => (i.shortage || 0) > 0);

    // Only show a confirm if there's something to remind about.
    if (owing > 0 || hasBorrowedItems) {
      const lines = [];
      if (owing > 0) {
        lines.push(
          `This booking has ₦${owing.toLocaleString()} owing. You can still mark it as returned — just a reminder.`
        );
      }
      if (hasBorrowedItems) {
        lines.push(
          "This booking had borrowed items. Confirm you've returned them to the vendor."
        );
      }
      const proceed = confirm(`Confirm return:\n\n${lines.join("\n\n")}`);
      if (!proceed) return;
    }

    window.openReturnSettlementModal(booking, bookingId, businessId);
  } catch (error) {
    console.error("Failed to open return settlement:", error);
    alert("Could not open the return settlement screen: " + error.message);
  }
};
// ===== END CHANGE 4 =====

// ===== NEW: Token demo-safety =====
// The saved template may be missing {clientName} / {businessName} tokens
// entirely (business deleted them). We still want the real client name in
// the greeting, so we ALWAYS guarantee a "Hi {realName}," opening line:
//   1. If the template contains {clientName}, replace as before.
//   2. If it doesn't, prepend "Hi {realName}," so the client name is never lost.
// This makes the tokens a soft/demo hint rather than a hard requirement.
function applyReturnMessageTemplate(template, booking) {
  const clientName = booking?.client?.name || "there";
  const bizName = currentBusinessName || "us";

  let output = (template || DEFAULT_RETURN_MESSAGE_TEMPLATE)
    .replace(/\{clientName\}/g, clientName)
    .replace(/\{businessName\}/g, bizName);

  // If the template never mentioned the client name, prepend a real greeting
  // so the customer always sees their own name. Skip if the template already
  // opens with a greeting line containing the name.
  const startsWithClientGreeting =
    output.trimStart().toLowerCase().startsWith(`hi ${clientName.toLowerCase()}`) ||
    output.trimStart().toLowerCase().startsWith(`hello ${clientName.toLowerCase()}`) ||
    output.trimStart().toLowerCase().startsWith(`dear ${clientName.toLowerCase()}`);

  if (!startsWithClientGreeting) {
    output = `Hi ${clientName},\n\n${output}`;
  }

  return output;
}
// ===== END NEW =====

function escapeHtmlForTextarea(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One damage repeater row. Items offered are the ones actually in THIS
 * booking (so you can only record damage on something that was rented),
 * tagged so we know later whether it's a catalog item (safe to deduct from
 * inventory) or a custom/vendor-borrowed one (nothing of yours to deduct). */
// ===== FIX 1: Damage amount input — remove pre-typed value, keep hint =====
// ===== NEW: Per-item damage qty clamp (can't exceed what was rented) =====
function buildDamageRowHTML() {
  const items = returnSettlementBooking?.items || [];

  // Each option carries the max qty that was actually rented for that item.
  // For custom (not-in-inventory) items we fall back to the qty on that row.
  const options = items.map(i => {
    const rentedQty = Math.max(1, Number(i.qty || 0));
    return `<option value="${escapeHtmlForTextarea(i.name)}" data-is-custom="${!!i.isCustom}" data-max="${rentedQty}">${escapeHtmlForTextarea(i.name)}${i.isCustom ? " (not in inventory)" : ""} — rented: ${rentedQty}</option>`;
  }).join("");

  return `
    <div class="damage-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#fff;border:0.5px solid #e5e5e5;border-radius:6px;padding:8px 10px;">
      <select class="damage-item-select" onchange="window.syncDamageQtyMax(this)"
        style="flex:2 1 140px;min-width:0;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;">
        <option value="">-- Select item --</option>
        ${options}
      </select>
      <input class="damage-qty" type="number" min="1" max="1" placeholder="Qty"
        oninput="window.clampDamageQty(this)"
        style="flex:0 1 70px;min-width:0;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;">
      <input class="damage-amount" type="number" min="0" placeholder="\u20a6 charge"
        style="flex:0 1 100px;min-width:0;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;">
      <button type="button" onclick="this.parentElement.remove();" style="width:28px;height:28px;flex-shrink:0;border:0.5px solid #fca5a5;border-radius:6px;background:#fef2f2;color:#b91c1c;cursor:pointer;">\u2715</button>
    </div>`;
}

// ===== NEW: Keep the damage qty input's max in sync with the picked item =====
window.syncDamageQtyMax = function (selectEl) {
  const row = selectEl.closest(".damage-row");
  if (!row) return;
  const qtyInput = row.querySelector(".damage-qty");
  if (!qtyInput) return;

  const selectedOpt = selectEl.selectedOptions[0];
  const maxQty = Number(selectedOpt?.dataset.max || 0);
  if (maxQty > 0) {
    qtyInput.max = String(maxQty);
  } else {
    qtyInput.removeAttribute("max");
  }
  // Clamp current value to the new max (or back to 1 if no item picked yet).
  window.clampDamageQty(qtyInput);
};

// ===== NEW: Clamp the damage qty value to [1, max] as the user types =====
window.clampDamageQty = function (qtyInput) {
  const raw = Number(qtyInput.value || 0);
  const max = Number(qtyInput.max || 0) || Infinity;
  let clamped = Math.floor(raw);
  if (!isFinite(clamped) || clamped < 1) clamped = 1;
  if (clamped > max) clamped = max;
  if (String(clamped) !== qtyInput.value) {
    qtyInput.value = String(clamped);
  }
};


window.addDamageRow = function() {
  const container = document.getElementById("damageRowsContainer");
  if (!container) return;
  container.insertAdjacentHTML("beforeend", buildDamageRowHTML());
};

window.updateCautionFeeUI = function() {
  const selected = document.querySelector('input[name="cautionHandling"]:checked')?.value;
  const wrap = document.getElementById("partialCautionWrap");
  if (wrap) wrap.style.display = selected === "partial" ? "block" : "none";
};

/* =========================
   RETURN SETTLEMENT MODAL
   ===== NEW: Redesigned with #800080 inline styles =====
========================= */
window.openReturnSettlementModal = function(booking, id, businessId) {
  returnSettlementBooking = booking;
  returnSettlementId = id;
  returnSettlementBusinessId = businessId;

  const cautionFee = Number(booking.payment?.cautionFee || 0);
  const prefilledNote = applyReturnMessageTemplate(returnMessageTemplate, booking);

  // ===== NEW: #800080 brand color =====
  const BRAND = "#800080";
  const BRAND_LIGHT = "#f5edf6";
  const BRAND_BORDER = "#d8b4fe";

  modalContent.innerHTML = `
<div style="display:flex;flex-direction:column;gap:20px;padding:4px;width:100%;max-width:640px;margin:0 auto;box-sizing:border-box;">

  <div style="background:linear-gradient(135deg, ${BRAND} 0%, #5c005c 100%);padding:22px 24px;border-radius:18px;color:#fff;box-shadow:0 10px 30px rgba(128,0,128,0.25);">
    <p style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;opacity:0.85;margin:0 0 6px;">Return Settlement</p>
    <h3 style="font-size:22px;font-weight:900;line-height:1.2;margin:0;word-break:break-word;">${booking.client?.name || "Client"}</h3>
  </div>

  <div style="background:${BRAND_LIGHT};border:1px solid ${BRAND_BORDER};border-radius:16px;padding:18px 20px;">
    <h4 style="font-size:14px;font-weight:800;color:${BRAND};margin:0 0 6px;">Caution Fee</h4>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px;">Collected: <strong style="color:#374151;">\u20a6${cautionFee.toLocaleString()}</strong></p>
    <div style="display:flex;flex-direction:column;gap:10px;font-size:14px;color:#374151;">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="radio" name="cautionHandling" value="full" checked onchange="updateCautionFeeUI()" style="accent-color:${BRAND};">
        <span>Full return</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="radio" name="cautionHandling" value="partial" onchange="updateCautionFeeUI()" style="accent-color:${BRAND};">
        <span>Partial return</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="radio" name="cautionHandling" value="kept" onchange="updateCautionFeeUI()" style="accent-color:${BRAND};">
        <span>Kept (damage/loss)</span>
      </label>
    </div>
    <div id="partialCautionWrap" style="display:none;margin-top:14px;">
      <label style="font-size:11px;font-weight:800;color:${BRAND};text-transform:uppercase;display:block;margin-bottom:6px;">Amount to keep (\u20a6)</label>
      <input id="cautionKeptAmount" type="number" min="0" max="${cautionFee}" value="0"
        style="width:100%;padding:10px 12px;border:1px solid ${BRAND_BORDER};border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;background:#fff;">
    </div>
  </div>

  <div style="background:${BRAND_LIGHT};border:1px solid ${BRAND_BORDER};border-radius:16px;padding:18px 20px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
      <h4 style="font-size:14px;font-weight:800;color:${BRAND};margin:0;">Damages</h4>
      <button type="button" onclick="addDamageRow()"
        style="font-size:12px;font-weight:800;padding:8px 14px;border-radius:10px;border:1px solid ${BRAND_BORDER};background:#fff;color:${BRAND};cursor:pointer;">
        + Add damaged item
      </button>
    </div>
    <div id="damageRowsContainer" style="display:flex;flex-direction:column;gap:8px;"></div>
    <p style="font-size:11px;color:#9ca3af;margin:10px 0 0;">Leave empty if everything came back in good condition.</p>
  </div>

  <div style="background:${BRAND_LIGHT};border:1px solid ${BRAND_BORDER};border-radius:16px;padding:18px 20px;">
    <h4 style="font-size:14px;font-weight:800;color:${BRAND};margin:0 0 10px;">Thank-you message</h4>
    <textarea id="returnNoteTextarea" rows="5"
      style="width:100%;padding:12px;border:1px solid ${BRAND_BORDER};border-radius:10px;font-size:13px;outline:none;box-sizing:border-box;background:#fff;font-family:inherit;resize:vertical;">${escapeHtmlForTextarea(prefilledNote)}</textarea>
    <p style="font-size:11px;color:#9ca3af;margin:8px 0 0;">Pre-filled from your Settings template — edit freely for this customer. Sent via WhatsApp when you confirm.</p>
  </div>

  <div style="display:flex;flex-direction:column;gap:10px;">
    <button onclick="confirmReturnSettlement('${id}', '${businessId}')"
      style="width:100%;padding:14px;background:${BRAND};color:#fff;border:none;border-radius:12px;font-weight:900;font-size:14px;cursor:pointer;box-shadow:0 6px 20px rgba(128,0,128,0.3);">
      Confirm Return
    </button>
    <button onclick="closeModal()"
      style="width:100%;padding:12px;background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb;border-radius:12px;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;">
      Cancel
    </button>
  </div>
</div>`;

  bookingModal.style.display = "flex";
  document.body.style.overflow = "hidden";
};
// ===== END NEW =====

/** Builds the customer-facing settlement message: greeting, damage summary,
 * caution settlement, the (possibly edited) thank-you note, and the review
 * link -- same URL/guard as generateReceiptText uses. */
function buildReturnSettlementMessage(booking) {
  const lines = [];
  lines.push(`Hi ${booking.client?.name || "there"},`);
  lines.push("");

  if (booking.damages && booking.damages.length) {
    lines.push("Return summary:");
    booking.damages.forEach(d => {
      lines.push(`- ${d.itemName} x${d.quantity}: \u20a6${Number(d.amount || 0).toLocaleString()} charged`);
    });
    lines.push("");
  }

  const p = booking.payment || {};
  if (p.cautionFeeReturned || p.cautionFeeKept) {
    let line = `Caution fee: \u20a6${Number(p.cautionFee || 0).toLocaleString()} held -- \u20a6${Number(p.cautionFeeReturned || 0).toLocaleString()} refunded`;
    if (p.cautionFeeKept) line += `, \u20a6${Number(p.cautionFeeKept).toLocaleString()} retained`;
    lines.push(line + ".");
    lines.push("");
  }

  if (booking.returnNote) lines.push(booking.returnNote);

  if (publicProfileSettings.enabled && publicProfileSettings.slug) {
    const storeUrl = `${window.location.origin}/p/${publicProfileSettings.slug}`;
    lines.push("");
    lines.push(`\u{1F310} Leave a review or rate us: ${storeUrl}`);
  }

  return lines.join("\n");
}

/**
 * STUB -- no backend wired yet. Builds the message + payload for each
 * channel the customer has contact info for, and logs it. No network call,
 * no Firestore write. Swap console.info for a fetch() call once the backend
 * exists; nothing else here changes.
 */
async function notifyReturnSettlementByChannel(booking, business) {
  const body = buildReturnSettlementMessage(booking);
  const attempts = [];
  if (booking.client?.email) attempts.push({ channel: "email", to: booking.client.email });
  if (booking.client?.phone) attempts.push({ channel: "sms", to: booking.client.phone });

  for (const attempt of attempts) {
    try {
      const payload = {
        channel: attempt.channel,
        to: attempt.to,
        subject: "Your rental has been returned \u2014 settlement summary",
        body,
        businessId: business?.id || business,
        bookingId: booking.id,
        type: "return_settlement"
      };
      console.info("[ReturnSettlement] would send:", payload);
    } catch (err) {
      console.error("[ReturnSettlement] stub failed for channel", attempt.channel, err);
    }
  }
}

/* =========================
   CONFIRM RETURN SETTLEMENT -- the actual commit.
   Writes the booking's return audit trail, deducts damaged catalog items
   from BOTH totalQuantity and availableQuantity (never just one -- see the
   spec notes), runs the post-return overbooked cascade, then fires the
   WhatsApp message and the email/SMS stub hooks.
========================= */
window.confirmReturnSettlement = async function(id, businessId) {
  const confirmBtn = event?.target;
  if (confirmBtn) disableButton(confirmBtn);

  try {
    const booking = returnSettlementBooking;
    if (!booking || returnSettlementId !== id) {
      throw new Error("Return session expired -- please reopen this booking and try again.");
    }

    // ---- Caution fee settlement ----
    const cautionFee = Number(booking.payment?.cautionFee || 0);
    const handling = document.querySelector('input[name="cautionHandling"]:checked')?.value || "full";
    let cautionFeeKept = 0;
    let cautionFeeReturned = 0;
    if (handling === "full") {
      cautionFeeReturned = cautionFee;
    } else if (handling === "kept") {
      cautionFeeKept = cautionFee;
    } else {
      cautionFeeKept = Math.min(cautionFee, Math.max(0, Number(document.getElementById("cautionKeptAmount")?.value || 0)));
      cautionFeeReturned = cautionFee - cautionFeeKept;
    }

    // ---- Damages + the critical inventory deduction rule ----
    const damageRowEls = document.querySelectorAll("#damageRowsContainer .damage-row");
    const damages = [];
    const inventoryMap = getInventoryMap(); // { nameLower: inventoryDoc }

    for (const row of damageRowEls) {
      const select = row.querySelector(".damage-item-select");
      const itemName = select?.value || "";
      if (!itemName) continue;

      const isCustom = select.selectedOptions[0]?.dataset.isCustom === "true";
            // ===== NEW: Clamp qty at save time too — defence in depth =====
      // Even if someone bypasses the UI, we never record more damage
      // than what was actually rented for this booking.
      const rentedQtyForItem = Math.max(
        0,
        Number(
          (returnSettlementBooking?.items || []).find(
            it => (it.name || "").trim().toLowerCase() === itemName.trim().toLowerCase()
          )?.qty || 0
        )
      );
      const rawQty = Math.max(0, Number(row.querySelector(".damage-qty")?.value || 0));
      const qty = rentedQtyForItem > 0
        ? Math.min(rawQty, rentedQtyForItem)
        : rawQty; // fallback: no matching line item, use raw qty as-is
      const amount = Math.max(0, Number(row.querySelector(".damage-amount")?.value || 0));
      if (qty <= 0) continue;

      const invMatch = !isCustom ? inventoryMap[itemName.trim().toLowerCase()] : null;
      damages.push({ itemId: invMatch?.id || "", itemName, quantity: qty, amount });

      // Only a real catalog match gets deducted -- vendor-borrowed / custom
      // items never touch your own inventory, because none of it was yours.
      if (invMatch?.id) {
        const itemRef = doc(db, "businesses", businessId, "inventory", invMatch.id);
        const freshSnap = await getDoc(itemRef);
        if (freshSnap.exists()) {
          const freshData = freshSnap.data();
          // BOTH fields drop by the same amount, clamped at 0 -- never negative,
          // and never just one of the two (see spec: deducting only one breaks
          // either the Total display or the live availability engine).
          const newTotal = Math.max(0, Number(freshData.totalQuantity || 0) - qty);
          const newAvailable = Math.max(0, Number(freshData.availableQuantity || 0) - qty);
          await updateDoc(itemRef, {
            totalQuantity: newTotal,
            availableQuantity: newAvailable,
            updatedAt: serverTimestamp()
          });

          // ===== FIX 4: Per-item damage notification (in-app + push) =====
          const notifMsg =
            `${invMatch.name} reduced from ${Number(freshData.totalQuantity || 0)} to ${newTotal} due to damage on ${booking.client?.name || "client"}'s return`;

          await sendNotification(
            businessId,
            notifMsg,
            auth.currentUser?.email || "System",
            "inventory_damage",
            id
          );

          try {
            await sendPush(notifMsg, "/inventory.html");
          } catch (e) {
            console.warn("Damage push failed (non-blocking):", e);
          }
        }
      }
    }

    const returnNote = document.getElementById("returnNoteTextarea")?.value?.trim() || "";
    const damageStatus = damages.length ? "damaged" : "clean";

    // ===== CHANGE 5: Compute owing at return for audit trail =====
    const owingAtReturn = Math.max(
      0,
      Number(booking.payment?.total || 0) - Number(booking.payment?.paid || 0)
    );
    // ===== END CHANGE 5 (calculation) =====

    // ---- Write the booking's return audit trail (purely additive) ----
    const bookingRef = doc(db, "businesses", businessId, "bookings", id);
    await updateDoc(bookingRef, {
      status: "returned",
      "payment.cautionFeeReturned": cautionFeeReturned,
      "payment.cautionFeeKept": cautionFeeKept,
      "payment.cautionFeeSettledAt": serverTimestamp(),
      damages,
      damagesRecordedAt: serverTimestamp(),
      returnNote,
      returnNoteSentAt: serverTimestamp(),
      damageStatus,
      // ===== CHANGE 5: Store owingAtReturn (0 if fully paid) =====
      owingAtReturn
      // ===== END CHANGE 5 =====
    });

    const updatedSnap = await getDoc(bookingRef);
    const updatedBooking = { id, ...updatedSnap.data() };

    // ---- Post-return cascade: does any OTHER active booking now come up short? ----
    // Only worth checking when inventory actually changed (i.e. there were
    // damages on catalog items) -- nothing else in a return touches stock.
    if (damages.some(d => d.itemId)) {
      try {
        const invSnap = await getDocs(collection(db, "businesses", businessId, "inventory"));
        const freshInventory = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const otherActiveBookings = await fetchActiveBookings(businessId, id);

        const newlyOverbooked = otherActiveBookings.filter(ob => {
          const { start, end } = getBookingWindow(ob);
          const map = getAvailabilityMap(freshInventory, otherActiveBookings, start, end, ob.id);
          return (ob.items || []).some(it => {
            if (it.isCustom) return false;
            const key = (it.name || "").trim().toLowerCase();
            const free = map.has(key) ? map.get(key) : 0;
            const ownPortion = Math.max(0, Number(it.qty || 0) - Number(it.shortage || it.borrowed || 0));
            return ownPortion > free;
          });
        });

        if (newlyOverbooked.length) {
          const names = newlyOverbooked.map(b => b.client?.name || "Unknown client").join(", ");
          await sendNotification(
            businessId,
            `Damage on this return made ${newlyOverbooked.length} booking(s) overbooked: ${names}`,
            auth.currentUser.email,
            "booking_overbooked",
            id
          );
        }
      } catch (cascadeErr) {
        console.error("Post-return overbooked cascade failed:", cascadeErr);
      }
    }

    closeModal();
    alert(`Booking marked as returned and settled successfully! \u2705${damages.length ? ` (${damages.length} damage item(s) recorded)` : ""}`);

    await sendNotification(
      businessId,
      `${booking.client.name}'s items have been returned successfully \u2705${damages.length ? ` -- ${damages.length} item(s) recorded with damage` : ""}`,
      auth.currentUser.email,
      "booking_returned",
      id
    );

    // ===== CHANGE 7: Second notification when returned with owing balance =====
    if (owingAtReturn > 0) {
      await sendNotification(
        businessId,
        `${booking.client.name}'s booking was returned with ₦${owingAtReturn.toLocaleString()} still owing.`,
        auth.currentUser?.email || "System",
        "return_owing",
        id
      );
    }
    // ===== END CHANGE 7 =====

    // ---- WhatsApp: still fires immediately, exactly as before ----
    const finalMessage = buildReturnSettlementMessage(updatedBooking);
    if (updatedBooking.client?.phone) {
      shareToWhatsApp(updatedBooking.client.phone, finalMessage);
    }

    // ---- Email/SMS stub hooks -- never allowed to block the return ----
    try {
      await notifyReturnSettlementByChannel(updatedBooking, { id: businessId, name: currentBusinessName });
    } catch (stubErr) {
      console.error("notifyReturnSettlementByChannel failed:", stubErr);
    }

  } catch (error) {
    console.error("Return settlement failed:", error);
    alert("An error occurred while settling the return: " + error.message);
  } finally {
    if (confirmBtn) enableButton(confirmBtn);
    returnSettlementBooking = null;
    returnSettlementId = null;
    returnSettlementBusinessId = null;
  }
};

/* =========================
   DELETE BOOKING (OWNER ONLY)
========================= */
window.deleteBooking = async function(bookingId, businessId) {
  const btn = event?.target;
  if (btn) disableButton(btn);
  if (currentRole !== "owner") return alert("Permission Denied: Only Owners can delete.");

  try {
    const bookingRef = doc(db, "businesses", businessId, "bookings", bookingId);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) return alert("Booking not found.");

    const booking = snap.data();
    if (booking.status !== "returned") {
      const confirmDelete = confirm("⚠️ This booking has NOT been marked as returned.\n\nDeleting it will free up its reserved stock immediately.\n\nDo you want to proceed?");
      if (!confirmDelete) return;
    } else {
      if (!confirm(`Delete ${booking.client.name} booking permanently?`)) return;
    }

    await deleteDoc(bookingRef);
    await sendNotification(
      businessId,
      `${booking.client.name}'s booking has been deleted`,
      auth.currentUser.email,
      "booking_deleted",
      bookingId
    );

    closeModal();
    alert("Booking deleted successfully ✅");
  } catch (error) {
    console.error("Delete error:", error);
    alert("Error deleting booking: " + error.message);
  }
};

/* =========================
   URL HIGHLIGHT / STATUS PRE-FILTER / VENDOR PRE-FILTER
========================= */
const urlParams = new URLSearchParams(window.location.search);
const highlightId = urlParams.get("highlight");
const presetStatus = urlParams.get("status");
const presetVendor = urlParams.get("vendor");

if (presetStatus) {
  const filterEl = document.getElementById("filterStatus");
  if (filterEl) filterEl.value = presetStatus;
}

// ===== NEW: Vendor deep-link from rental-to-rental.html =====
// The Borrowed In tab's vendor header navigates here with ?vendor=<name>.
// We prefill the search box with that name and dispatch an input event so
// the existing filterAndRender() runs and narrows the table. The extended
// search predicate (further down) also matches on item supplier, so this
// works whether the vendor is spelled exactly or with different casing.
if (presetVendor) {
  const searchEl = document.getElementById("searchInput");
  if (searchEl) {
    searchEl.value = presetVendor;
    // Defer so the Firestore snapshot has rendered at least once. If the
    // snapshot hasn't arrived yet, the input event still fires and the
    // snapshot callback will use the current value when it renders.
    setTimeout(() => searchEl.dispatchEvent(new Event("input")), 0);
  }
}

function getInventoryMap() {
  const map = {};
  inventoryItems.forEach(i => { map[i.name.toLowerCase()] = i; });
  return map;
}

/* ========================================================
   REAL-TIME CALCULATION ENGINE FOR EDIT WORKSPACE
======================================================== */
let editAvailabilityMap = new Map();
let editingBookingId = null;

function getEditRowItemName(row) {
  const select = row.querySelector(".item-name");
  const isCustom = select?.value === "__custom__";
  const customInput = row.querySelector(".item-custom-name");
  const name = isCustom ? (customInput?.value.trim() || "") : (select?.value || "");
  return { name, isCustom };
}

function getEditDateWindow() {
  const deliveryEl = document.getElementById("editDelivery");
  const dateEl = document.getElementById("editDate");
  const returnEl = document.getElementById("editReturn");
  const start = (deliveryEl?.value || dateEl?.value || "").trim();
  const end = (returnEl?.value || start).trim();
  return { start: start || null, end: end || null };
}

async function refreshEditAvailability(businessId) {
  const { start, end } = getEditDateWindow();
  if (!start) { editAvailabilityMap = new Map(); return; }
  try {
    const bookings = await fetchActiveBookings(businessId, editingBookingId);
    editAvailabilityMap = getAvailabilityMap(inventoryItems, bookings, new Date(start), new Date(end), editingBookingId);
  } catch (err) {
    console.error("Error refreshing edit-modal availability:", err);
  }
  document.querySelectorAll("#editItemsContainer .item-name").forEach(select => {
    const currentValue = select.value;
    Array.from(select.options).forEach(opt => {
      if (!opt.value || opt.value === "__custom__") return;
      const key = opt.value.trim().toLowerCase();
      const free = editAvailabilityMap.has(key) ? editAvailabilityMap.get(key) : Number(opt.dataset.stock || 0);
      opt.dataset.freeForDates = free;
      opt.textContent = `${opt.value} (${free} free for these dates)`;
    });
    select.value = currentValue;
  });
  recalculateEditWorkspace();
}

/* ========================================================
   THE PRICING RULES
======================================================== */
function markEditTotalUserEdited() {
  const totalEl = document.getElementById("editTotal");
  if (totalEl) totalEl.dataset.userEdited = "true";
}

function clearEditTotalOverride() {
  const totalEl = document.getElementById("editTotal");
  if (totalEl) {
    delete totalEl.dataset.userEdited;
    // Drop the "seeded from saved booking" flag too — the user is making
    // a change that legitimately affects the total, so let recalc run.
    delete totalEl.dataset.seeded;
  }
}

function recalculateEditWorkspace() {
  const rows = document.querySelectorAll("#editItemsContainer .item-row");
  let itemsSubtotal = 0;
  let workspaceOverbooked = false;

  rows.forEach(row => {
    const qtyInput = row.querySelector(".item-qty");
    const priceInput = row.querySelector(".item-price");
    const vendorWrap = row.querySelector(".edit-vendor-wrap");
    const { name, isCustom } = getEditRowItemName(row);

    const qty = Number(qtyInput?.value || 0);
    const price = Number(priceInput?.value || 0);
    const rowTotal = qty * price;
    itemsSubtotal += rowTotal;

    let short = false;
    if (isCustom) {
      short = qty > 0;
      if (vendorWrap) vendorWrap.style.display = "block";
    } else if (name) {
      const key = name.trim().toLowerCase();
      const freeForDates = editAvailabilityMap.has(key) ? editAvailabilityMap.get(key) : 0;
      short = qty > freeForDates;
      if (vendorWrap) vendorWrap.style.display = short ? "block" : "none";
    }

    if (short) {
      workspaceOverbooked = true;
      row.classList.add("border-l-4", "border-red-500", "bg-red-50");
    } else {
      row.classList.remove("border-l-4", "border-red-500", "bg-red-50");
    }
  });

  const cautionFee = Number(document.getElementById("editCautionFee")?.value || 0);
  const transportationFee = Number(document.getElementById("editTransportationFee")?.value || 0);
  const otherFees = Number(document.getElementById("editOtherFees")?.value || 0);
  const feesTotal = cautionFee + transportationFee + otherFees;
  const computedTotal = itemsSubtotal + feesTotal;

  const totalEl = document.getElementById("editTotal");
  // Treat the total as "user-owned" if:
  //   • the user typed in it during THIS session, OR
  //   • the booking already had a saved total when the modal opened.
  // We mark that second case below in openEditModal() by setting
  // data-seeded="true" on the input. Until the user actually edits
  // items/qty/price/fees, we NEVER overwrite their real total.
  const isUserOwned =
    totalEl?.dataset.userEdited === "true" ||
    totalEl?.dataset.seeded === "true";

  if (totalEl && !isUserOwned) {
    totalEl.value = computedTotal;
  }


    const subtotalDisplay = document.getElementById("editItemsSubtotalDisplay");
  if (subtotalDisplay) {
    const realTotal = Number(totalEl?.value || 0);

    // Always show the REAL total first (that's what the customer is paying).
    // Show the freshly-computed breakdown as a secondary hint only when it
    // differs from the real total — otherwise the hint is just noise.
    if (realTotal === computedTotal) {
      subtotalDisplay.innerHTML =
        `Real total: <strong>₦${realTotal.toLocaleString()}</strong> ` +
        `<span style="color:#9ca3af;">(matches items + fees)</span>`;
    } else {
      subtotalDisplay.innerHTML =
        `Real total: <strong>₦${realTotal.toLocaleString()}</strong> ` +
        `<span style="color:#9ca3af;">(items + fees breakdown: ₦${computedTotal.toLocaleString()})</span>`;
    }
  }

  const warningBadge = document.getElementById("editOverbookWarning");
  if (warningBadge) warningBadge.style.display = workspaceOverbooked ? "inline-block" : "none";
}

window.useEditSubtotal = function () {
  // Manually requesting the subtotal means the user WANTS to overwrite
  // whatever total is currently there — so drop the seed flag too.
  const tEl = document.getElementById("editTotal");
  if (tEl) {
    delete tEl.dataset.seeded;
    delete tEl.dataset.userEdited;
  }
  recalculateEditWorkspace();
};

function attachRowCalculationListeners(row) {
  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");
  const customNameInput = row.querySelector(".item-custom-name");

  select?.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (e.target.value === "__custom__") {
      customNameInput?.classList.remove("hidden");
      customNameInput?.focus();
    } else {
      customNameInput?.classList.add("hidden");
      if (opt && priceInput) priceInput.value = opt.dataset.price || 0;
    }
    recalculateEditWorkspace();
  });
  qtyInput?.addEventListener("input", recalculateEditWorkspace);
  priceInput?.addEventListener("input", recalculateEditWorkspace);
  customNameInput?.addEventListener("input", recalculateEditWorkspace);

  let dateDebounce;
  ["editDate", "editDelivery", "editReturn"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.availabilityWired) {
      el.dataset.availabilityWired = "true";
      el.addEventListener("input", () => {
        clearTimeout(dateDebounce);
        dateDebounce = setTimeout(() => refreshEditAvailability(el.closest("[data-business-id]")?.dataset.businessId || window._editBusinessId), 250);
      });
    }
  });
}

function wireEditTotalAndFeeListeners() {
  const editTotalEl = document.getElementById("editTotal");
  if (editTotalEl && !editTotalEl.dataset.wiredUserEdit) {
    editTotalEl.dataset.wiredUserEdit = "true";
    editTotalEl.addEventListener("input", () => {
      markEditTotalUserEdited();
      recalculateEditWorkspace();
    });
  }

  ["editCautionFee", "editTransportationFee", "editOtherFees"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.wiredCalc) {
      el.dataset.wiredCalc = "true";
      el.addEventListener("input", () => {
        clearEditTotalOverride();
        recalculateEditWorkspace();
      });
    }
  });
}

/* ========================================================
   OTHER FEES REPEATER (edit modal)
   Same pattern as add.js: the hidden #editOtherFees input keeps holding the
   computed SUM and fires its normal "input" event when that sum changes, so
   the existing listener above (clearEditTotalOverride + recalculateEditWorkspace)
   keeps working completely unchanged. We only ever add payment.otherFeesList
   alongside the untouched payment.otherFees number.
======================================================== */
function buildEditOtherFeeRowHTML(label = "", amount = "") {
  const safeLabel = String(label).replace(/"/g, '&quot;');
  return `
    <div class="edit-other-fee-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <input type="text" class="edit-other-fee-label" placeholder="e.g. Diesel" value="${safeLabel}"
        style="flex:2 1 120px;min-width:0;padding:8px 10px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;box-sizing:border-box;">
      <input type="text" class="edit-other-fee-amount" inputmode="numeric" placeholder="₦0" value="${amount}"
        style="flex:1 1 80px;min-width:0;padding:8px 10px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;box-sizing:border-box;">
      <button type="button" class="remove-edit-other-fee-btn" style="width:28px;height:28px;flex-shrink:0;border:0.5px solid #fca5a5;border-radius:6px;background:#fef2f2;color:#b91c1c;cursor:pointer;">✕</button>
    </div>`;
}

function syncEditOtherFeesHidden() {
  const rows = document.querySelectorAll("#editOtherFeesRepeater .edit-other-fee-row");
  let sum = 0;
  rows.forEach(row => {
    const amount = parseFloat((row.querySelector(".edit-other-fee-amount")?.value || "0").toString().replace(/,/g, '')) || 0;
    sum += amount;
  });

  const display = document.getElementById("editOtherFeesSubtotalDisplay");
  if (display) display.textContent = `Other fees total: ₦${sum.toLocaleString()}`;

  const hidden = document.getElementById("editOtherFees");
  if (hidden) {
    hidden.value = sum;
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function getEditOtherFeesList() {
  const rows = document.querySelectorAll("#editOtherFeesRepeater .edit-other-fee-row");
  const list = [];
  rows.forEach(row => {
    const label = (row.querySelector(".edit-other-fee-label")?.value || "").trim();
    const amount = parseFloat((row.querySelector(".edit-other-fee-amount")?.value || "0").toString().replace(/,/g, '')) || 0;
    if (label || amount > 0) list.push({ label: label || "Other Fee", amount });
  });
  return list;
}

window.addEditOtherFeeRow = function(label = "", amount = "") {
  const container = document.getElementById("editOtherFeesRepeater");
  if (!container) return;
  container.insertAdjacentHTML("beforeend", buildEditOtherFeeRowHTML(label, amount));
  const row = container.lastElementChild;
  row.querySelector(".edit-other-fee-label")?.addEventListener("input", syncEditOtherFeesHidden);
  row.querySelector(".edit-other-fee-amount")?.addEventListener("input", syncEditOtherFeesHidden);
  row.querySelector(".remove-edit-other-fee-btn")?.addEventListener("click", () => {
    row.remove();
    syncEditOtherFeesHidden();
  });
  syncEditOtherFeesHidden();
};

/** Pre-fills the edit modal's fee repeater from the booking -- itemized list
 * if present, otherwise a single row carrying the old lump sum (if any). */
function populateEditOtherFeesRepeater(booking) {
  const container = document.getElementById("editOtherFeesRepeater");
  if (!container) return;
  container.innerHTML = "";
  const rows = Array.isArray(booking.payment?.otherFeesList) && booking.payment.otherFeesList.length
    ? booking.payment.otherFeesList
    : (booking.payment?.otherFees > 0 ? [{ label: "Other Fees", amount: booking.payment.otherFees }] : []);
  rows.forEach(r => window.addEditOtherFeeRow(r.label || "", r.amount || 0));
  syncEditOtherFeesHidden();
}

/* =========================
   OPEN BOOKING MODAL
========================= */
// ===== FIX 3: Full audit trail card for the booking modal =====
// ===== FIX 3 (updated): Booking History card =====
// Only renders when the booking has actually been RETURNED. Active /
// upcoming / overdue bookings see NO history card at all — nothing to
// tell them yet. When returned, the card leads with the return date so
// the most important fact is the first thing the eye lands on.
// ===== REDESIGN: Booking History as a vertical timeline =====
// Replaces the old flat-list version. Each event is a node on a vertical
// timeline with a colored dot + connector line, a bold title, a subtler
// subtitle, and a right-aligned timestamp. Newest events appear first so
// what just happened is what the eye lands on. Events cascade in with a
// short fade-in animation when the modal opens.
function buildAuditTrailHTML(booking) {
  // Hide the entire card for anything that hasn't been returned.
  if (booking.status !== "returned") return "";

  // ── Collect timeline events (newest first) ──
  // Each event: { icon, title, subtitle, timestamp, tone }
  const events = [];

  // ── 1. Returned (headline event, always first) ──
  const returnStamp =
    booking.payment?.cautionFeeSettledAt ||
    booking.damagesRecordedAt ||
    booking.event?.returnDate;

  if (returnStamp) {
    const d = returnStamp?.toDate?.() ? returnStamp.toDate() : new Date(returnStamp);
    if (!isNaN(d.getTime())) {
      events.push({
        icon: "task_alt",
        title: "Returned",
        subtitle: "Booking marked as returned and settled.",
        timestamp: d,
        tone: "green"
      });
    }
  }

  // ── 2. Damage summary OR clean return ──
  const hasDamages =
    booking.damageStatus === "damaged" &&
    Array.isArray(booking.damages) &&
    booking.damages.length > 0;

  if (hasDamages) {
    const totalDamageAmount = booking.damages.reduce(
      (s, d) => s + Number(d.amount || 0),
      0
    );
    const damageList = booking.damages
      .map(d => `${d.itemName} ×${d.quantity}`)
      .join(", ");

    events.push({
      icon: "report",
      title: "Damages reported",
      subtitle: `${damageList} — ₦${totalDamageAmount.toLocaleString()} charged`,
      timestamp: null,
      tone: "red"
    });
  } else {
    events.push({
      icon: "verified",
      title: "All items in good shape",
      subtitle: "No damages reported.",
      timestamp: null,
      tone: "green"
    });
  }

  // ── 3. Caution fee settlement ──
  const returnedFee = Number(booking.payment?.cautionFeeReturned || 0);
  const keptFee = Number(booking.payment?.cautionFeeKept || 0);
  if (returnedFee || keptFee) {
    let subtitle = `₦${returnedFee.toLocaleString()} refunded`;
    if (keptFee > 0) subtitle += `, ₦${keptFee.toLocaleString()} retained`;

    events.push({
      icon: "payments",
      title: "Caution fee settled",
      subtitle,
      timestamp: null,
      tone: keptFee > 0 ? "amber" : "purple"
    });
  }

  // ── 4. Owing at return ──
  const owingAtReturn = Number(booking.owingAtReturn || 0);
  if (owingAtReturn > 0) {
    events.push({
      icon: "error",
      title: "Owing at return",
      subtitle: `₦${owingAtReturn.toLocaleString()} was still unpaid.`,
      timestamp: null,
      tone: "amber"
    });
  }

  // ── 5. Thank-you message sent ──
  if (booking.returnNote) {
    const preview =
      booking.returnNote.length > 60
        ? booking.returnNote.slice(0, 60).trim() + "…"
        : booking.returnNote;

    events.push({
      icon: "mail",
      title: "Thank-you sent",
      subtitle: `"${preview}"`,
      timestamp: booking.returnNoteSentAt?.toDate?.() || null,
      tone: "purple"
    });
  }

  // ── 6. Booking created (oldest — shown at the bottom) ──
  if (booking.createdAt) {
    const createdDate = booking.createdAt?.toDate?.()
      ? booking.createdAt.toDate()
      : new Date(booking.createdAt);
    if (!isNaN(createdDate.getTime())) {
      events.push({
        icon: "add_circle",
        title: "Booking created",
        subtitle: "Booking was saved to your system.",
        timestamp: createdDate,
        tone: "gray"
      });
    }
  }

  if (!events.length) return "";

  // ── Tone palette — one place to tune the whole design ──
  const TONES = {
    green:  { dot: "#059669", ring: "#d1fae5", icon: "#059669" },
    red:    { dot: "#dc2626", ring: "#fee2e2", icon: "#dc2626" },
    amber:  { dot: "#d97706", ring: "#fef3c7", icon: "#b45309" },
    purple: { dot: "#800080", ring: "#f3e8ff", icon: "#800080" },
    gray:   { dot: "#9ca3af", ring: "#f3f4f6", icon: "#6b7280" }
  };

  function formatStamp(d) {
    if (!d) return "";
    return d.toLocaleString("en-NG", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  }

  // ── Build each timeline node ──
  const timelineHTML = events
    .map((ev, idx) => {
      const t = TONES[ev.tone] || TONES.gray;
      const isLast = idx === events.length - 1;

      return `
        <div class="audit-node" style="display:flex;gap:14px;position:relative;">
          <!-- Node + connector column -->
          <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:32px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${t.ring};display:flex;align-items:center;justify-content:center;flex-shrink:0;z-index:2;position:relative;">
              <span class="material-symbols-outlined" style="font-size:16px;color:${t.icon};font-variation-settings:'wght' 600;">${ev.icon}</span>
            </div>
            ${!isLast ? `<div style="flex:1;width:2px;background:linear-gradient(to bottom, ${t.dot}55, #e5e7eb);margin:4px 0;min-height:20px;"></div>` : ""}
          </div>

          <!-- Content column -->
          <div style="flex:1;min-width:0;padding-bottom:${isLast ? "0" : "16px"};">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
              <p style="font-size:13.5px;font-weight:800;color:#1f2937;margin:0;line-height:1.3;">${ev.title}</p>
              ${ev.timestamp ? `<p style="font-size:11px;color:#9ca3af;font-weight:600;white-space:nowrap;margin:0;">${formatStamp(ev.timestamp)}</p>` : ""}
            </div>
            <p style="font-size:12px;color:#6b7280;margin:2px 0 0;line-height:1.5;word-break:break-word;">${ev.subtitle}</p>
          </div>
        </div>`;
    })
    .join("");

  // ── Wrap in the card, include the cascade animation ──
  return `
    <style>
      @keyframes auditFadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .audit-node {
        opacity: 0;
        animation: auditFadeIn 0.35s ease both;
      }
      .audit-node:nth-child(1) { animation-delay: 0.05s; }
      .audit-node:nth-child(2) { animation-delay: 0.10s; }
      .audit-node:nth-child(3) { animation-delay: 0.15s; }
      .audit-node:nth-child(4) { animation-delay: 0.20s; }
      .audit-node:nth-child(5) { animation-delay: 0.25s; }
      .audit-node:nth-child(6) { animation-delay: 0.30s; }
    </style>

    <div style="background:linear-gradient(180deg,#faf7fb 0%,#ffffff 100%);border:1px solid #ecd9ef;border-radius:14px;padding:18px 20px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <span class="material-symbols-outlined" style="font-size:18px;color:#800080;">history</span>
        <p style="text-transform:uppercase;font-weight:900;color:#800080;font-size:12px;letter-spacing:1.5px;margin:0;">Booking History</p>
      </div>
      ${timelineHTML}
    </div>`;
}



window.openBooking = function(booking, id, businessId) {
  const life = getBookingLifecycle(booking);
  const status = life.key;
  const isOverbooked = isBookingOverbooked(booking);
  const totalAmount = booking.payment?.total || 0;
  const amountPaid = booking.payment?.paid || 0;
  const balanceRemaining = totalAmount - amountPaid;
  const fees = booking.payment || {};

  // ===== FIX 5A: Itemized fee lines (backward-compatible with single otherFees number) =====
  const otherFeeRows =
    Array.isArray(fees.otherFeesList) && fees.otherFeesList.length
      ? fees.otherFeesList
      : (Number(fees.otherFees || 0) > 0
          ? [{ label: "Other Fees", amount: Number(fees.otherFees) }]
          : []);

  const feeLines = [
    fees.cautionFee
      ? `Caution Fee: ₦${Number(fees.cautionFee).toLocaleString()}`
      : null,
    fees.transportationFee
      ? `Transportation: ₦${Number(fees.transportationFee).toLocaleString()}`
      : null,
    ...otherFeeRows.map(
      r => `${r.label || "Other Fee"}: ₦${Number(r.amount || 0).toLocaleString()}`
    )
  ].filter(Boolean);

  // Broadened filter: anything borrowed OR not in inventory OR custom shows here.
  const borrowedItems = (booking.items || [])
    .filter(i => Number(i.shortage || 0) > 0 || (i.supplier && i.supplier.trim() !== "") || i.isCustom)
    .map(i => {
      const qty = Number(i.shortage || i.qty || 0);
      const vendor = i.supplier || "Unknown vendor";
      const customTag = i.isCustom ? " (not in inventory)" : "";
      return `• ${i.name}${customTag} — Borrowed: ${qty} from ${vendor}`;
    });

  const vendorBlock = borrowedItems.length
    ? `<div class="bg-purple-50 border border-purple-200 rounded-xl p-4"><p class="text-xs font-bold text-purple-700 uppercase">Vendor / Borrowed Items</p><p class="text-sm text-gray-700 mt-1">${borrowedItems.join("<br>")}</p></div>`
    : "";

  const receiptText = generateReceiptText(booking);

  // The header keeps a distinct gradient per status — the pill itself
  // is now the shared renderBadge() so it looks identical to the table rows.
  const statusGradients = {
    returned: "from-green-600 to-green-800",
    active: "from-purple-700 to-purple-900",
    upcoming: "from-blue-600 to-blue-800",
    overdue: "from-red-600 to-red-800"
  };

  modalContent.innerHTML = `
<div class="space-y-6 animate__animated animate__fadeIn w-full max-w-5xl mx-auto px-3 sm:px-4">
  <div class="relative overflow-hidden bg-gradient-to-r ${statusGradients[status]} p-4 sm:p-6 rounded-2xl text-white shadow-xl">
    <div class="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-start gap-4">
      <div class="min-w-0 flex-1">
        <p class="text-[10px] sm:text-xs uppercase tracking-widest opacity-80">Client Profile</p>
        <h3 class="text-lg sm:text-2xl font-black break-words leading-tight">${booking.client.name}</h3>
        <p class="text-xs sm:text-sm opacity-90 italic break-all">${booking.client.email || "No Email"}</p>
        <p class="text-xs sm:text-sm opacity-90 italic flex items-center gap-2">
          <span class="material-symbols-outlined text-sm">call</span>
          <a href="tel:+${booking.client.phone}" class="break-all">${booking.client.phone}</a>
        </p>
      </div>
      <div class="flex flex-col items-start sm:items-end gap-2 w-full sm:w-auto">
        ${renderBadge(booking, "text-[11px]")}
        ${booking.damageStatus === "damaged" ? renderDamagedPill() : ""}
        ${isOverbooked ? renderOverbookedPill() : ""}
        ${Math.max(0, totalAmount - amountPaid) > 0 ? renderOwingPill() : ""}
      </div>
    </div>
  </div>

  ${buildAuditTrailHTML(booking)}

  <div class="flex flex-col gap-3">
    <div class="flex flex-col sm:flex-row gap-3">
      <div class="flex-1 min-w-0 bg-gray-50 border-b-4 border-purple-500 p-4 rounded-2xl shadow-sm">
        <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">Event Type</p>
        <div class="flex items-center gap-2 mt-1">
          <span class="material-symbols-outlined text-purple-600">auto_awesome</span>
          <p class="font-black text-gray-800 text-sm sm:text-base break-words">${booking.event.type || "Other"}</p>
        </div>
      </div>
      <div class="flex-1 min-w-0 bg-gray-50 border-b-4 border-purple-500 p-4 rounded-2xl shadow-sm">
        <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">Event Date</p>
        <div class="flex items-center gap-2 mt-1">
          <span class="material-symbols-outlined text-purple-600">calendar_today</span>
          <p class="font-black text-gray-800 text-sm sm:text-base break-all">${booking.event.date ? formatDateOnly(booking.event.date) : "Not set"}</p>
        </div>
      </div>
    </div>
    <div class="flex flex-col lg:flex-row gap-3">
      <div class="flex-1 min-w-0 bg-gray-50 border-b-4 border-purple-500 p-4 rounded-2xl shadow-sm">
        <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">Delivery Date</p>
        <div class="flex items-start gap-2 mt-1">
          <span class="material-symbols-outlined text-purple-600 mt-1">inventory_2</span>
          <p class="font-black text-gray-800 text-sm break-all leading-relaxed">${formatDateTime(booking.event.deliveryDate || booking.event.date)}</p>
        </div>
      </div>
      <div class="flex-1 min-w-0 bg-gray-50 border-b-4 ${status === "overdue" ? "border-red-500" : "border-purple-500"} p-4 rounded-2xl shadow-sm">
        <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">Return Date</p>
        <div class="flex items-start gap-2 mt-1">
          <span class="material-symbols-outlined ${status === "overdue" ? "text-red-600" : "text-purple-600"} mt-1">assignment_return</span>
          <p class="font-black text-sm break-all leading-relaxed ${status === "overdue" ? "text-red-600" : "text-gray-800"}">${formatDateTime(booking.event.returnDate)}</p>
        </div>
      </div>
    </div>
  </div>

  ${vendorBlock}

  <div>
    <h4 class="flex items-center gap-2 font-bold text-purple-800 mb-3 text-base">
      <span class="material-symbols-outlined">shopping_cart</span>Rental Items
    </h4>
    <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
      ${(booking.items || []).map(i => `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-white border border-gray-100 p-3 rounded-xl shadow-sm">
          <div>
            <p class="font-bold text-gray-800">${i.name}${i.isCustom ? `<span class="text-[9px] ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase font-black tracking-wide">Not in inventory</span>` : ''}${i.shortage > 0 ? `<span class="text-[9px] ml-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 uppercase font-black tracking-wide">Short ${i.shortage}</span>` : ''}</p>
            <p class="text-[10px] text-purple-600 font-bold">Qty: ${i.qty} @ ₦${(i.price || 0).toLocaleString()}</p>
          </div>
          <span class="font-black text-gray-700">₦${(i.total || 0).toLocaleString()}</span>
        </div>
      `).join("")}
    </div>
  </div>

  ${feeLines.length ? `
  <div class="bg-purple-50 border border-purple-100 rounded-xl p-4">
    <p class="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">Additional Fees</p>
    <p class="text-sm text-gray-700">${feeLines.join("<br>")}</p>
  </div>` : ""}

  <div class="bg-white border-2 border-purple-100 rounded-2xl p-4 shadow-inner">
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
      <div class="bg-gray-50 p-3 rounded-xl"><p class="text-xs text-gray-500 font-bold">Total</p><p class="text-lg font-black text-gray-800">₦${(booking.payment?.total || 0).toLocaleString()}</p></div>
      <div class="bg-green-50 p-3 rounded-xl"><p class="text-xs text-green-600 font-bold">Paid</p><p class="text-lg font-black text-green-700">₦${(booking.payment?.paid || 0).toLocaleString()}</p></div>
      <div class="bg-red-50 p-3 rounded-xl">
        <p class="text-xs text-red-600 font-bold">${amountPaid >= totalAmount ? "Change" : "Balance"}</p>
        <p class="text-lg font-black text-red-700">
          ${amountPaid === totalAmount ? "✓ Paid Full" : amountPaid > totalAmount ? `₦${(amountPaid - totalAmount).toLocaleString()}` : `₦${(totalAmount - amountPaid).toLocaleString()}`}
        </p>
      </div>
    </div>
  </div>

  <!-- ===== FIX 5B: Multiple receipt images (backward-compatible with single receiptImage) ===== -->
  ${(() => {
    const imgs =
      Array.isArray(booking.receiptImages) && booking.receiptImages.length
        ? booking.receiptImages
        : (booking.receiptImage ? [booking.receiptImage] : []);

    if (!imgs.length) {
      return `
        <div class="mt-4">
          <p class="text-[10px] font-black text-gray-400 uppercase flex items-center gap-2 mb-2">
            <span class="material-symbols-outlined text-sm">receipt_long</span> Receipt Images
          </p>
          <div class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
            <span class="material-symbols-outlined text-4xl text-gray-300">image</span>
            <p class="text-xs text-gray-400 mt-2">No receipt image available</p>
          </div>
        </div>`;
    }

    return `
      <div class="mt-4">
        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <p class="text-[10px] font-black text-purple-700 uppercase flex items-center gap-2">
            <span class="material-symbols-outlined text-sm">receipt_long</span> Receipt Images (${imgs.length})
          </p>
          <span class="inline-flex items-center gap-1.5 bg-purple-100 text-purple-800 border border-purple-200 rounded-full px-2.5 py-1 font-black uppercase tracking-wider text-[10px] leading-none">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-purple-500"></span>
            ${imgs.length} uploaded
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${imgs.map((url, idx) => `
            <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <img src="${url}" alt="Receipt ${idx + 1}"
                   class="w-full max-h-64 object-contain"
                   onerror="this.parentElement.innerHTML='<div class=\\'p-4 text-center text-gray-400 text-sm\\'>Image failed to load</div>'">
              <p class="text-[10px] text-gray-500 text-center py-2 border-t border-gray-100">
                Receipt ${idx + 1} of ${imgs.length}
              </p>
            </div>`).join("")}
        </div>
      </div>`;
  })()}

  ${booking.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4"><p class="text-xs font-bold text-yellow-700 uppercase">Notes</p><p class="text-sm text-gray-700 mt-1 break-words">${booking.notes}</p></div>` : ""}

  <div class="mt-6">
    <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
      <p class="text-[10px] font-black text-purple-700 uppercase">Live Receipt Preview</p>
      <span class="inline-flex items-center gap-1.5 bg-green-100 text-green-800 border border-green-200 rounded-full px-2.5 py-1 font-black uppercase tracking-wider text-[10px] leading-none">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-green-500"></span>
        WhatsApp Ready
      </span>
    </div>
    <div class="bg-gray-900 text-green-400 p-4 rounded-2xl font-mono text-xs whitespace-pre-wrap border-2 border-gray-800 shadow-inner overflow-auto max-h-72">${receiptText}</div>
    <div class="flex flex-col sm:flex-row gap-3 mt-4">
      <button onclick="shareToWhatsApp('${booking.client.phone}', \`${receiptText.replace(/`/g, "\\`")}\`)"
        class="flex-1 min-h-[55px] px-4 bg-green-500 hover:bg-green-600 transition text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" style="width:20px;height:20px;"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>
        <span class="text-sm sm:text-base text-center">Share Receipt</span>
      </button>
      <button id="downloadReceiptImgBtn"
        class="flex-1 min-h-[55px] px-4 bg-purple-600 hover:bg-purple-700 transition text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg">
        <span class="material-symbols-outlined text-xl">image</span>
        <span class="text-sm sm:text-base text-center">Download Receipt Image</span>
      </button>
    </div>
  </div>

  <div class="space-y-3">
    ${status !== "returned" && currentRole !== "viewer" ? `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button class="py-3 bg-white border-2 border-purple-700 text-purple-700 rounded-xl font-black text-sm shadow-md hover:bg-purple-50 transition"
          onclick='openEditModal(${JSON.stringify(booking)}, "${id}", "${businessId}")'>EDIT BOOKING</button>
        <button class="py-3 bg-purple-700 text-white rounded-xl font-black text-sm shadow-lg hover:bg-purple-800 transition"
          onclick='returnBooking("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>MARK RETURNED</button>
      </div>
    ` : status === "returned" ? `
      <!-- ===== CHANGE 8: Returned banner + optional Record Payment button ===== -->
      <div class="p-4 bg-green-50 text-green-700 text-center font-bold rounded-xl border border-green-200">✓ Items Successfully Returned</div>
      ${(Math.max(0, totalAmount - amountPaid) > 0 && currentRole !== "viewer") ? `
        <button class="w-full py-3 bg-purple-700 text-white rounded-xl font-black text-sm shadow-lg hover:bg-purple-800 transition flex items-center justify-center gap-2"
          onclick='window.openRecordPaymentModal("${id}", "${businessId}")'>
          <span class="material-symbols-outlined" style="font-size:1.1rem;">payments</span>
          Record Payment
        </button>
      ` : ""}
      <!-- ===== END CHANGE 8 ===== -->
    ` : ""}
    <div class="flex flex-col sm:flex-row gap-3">
      <button onclick="closeModal()" class="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold uppercase text-xs hover:bg-gray-300 transition">Close</button>
      ${currentRole === "owner" ? `
        <button onclick='deleteBooking("${id}", "${businessId}")' class="sm:w-auto w-full px-6 py-3 bg-red-100 text-red-600 rounded-xl shadow-sm hover:bg-red-600 hover:text-white transition flex items-center justify-center gap-2">
          <span class="material-symbols-outlined" style="font-size:1.25rem;">delete</span>Delete
        </button>
      ` : ""}
    </div>
  </div>
</div>`;

  bookingModal.style.display = "flex";
  document.body.style.overflow = "hidden";

  const dlBtn = document.getElementById("downloadReceiptImgBtn");
  if (dlBtn) dlBtn.addEventListener("click", () => generateReceiptImage(booking, currentBusinessName));
};

/* ========================================================
   ===== CHANGE 9: openRecordPaymentModal() =====
   Small modal for recording an additional payment on an already-returned
   booking that still has an owing balance.
======================================================== */
window.openRecordPaymentModal = async function(id, businessId) {
  try {
    const bookingRef = doc(db, "businesses", businessId, "bookings", id);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) {
      alert("Booking not found.");
      return;
    }
    const booking = snap.data();

    const total = Number(booking.payment?.total || 0);
    const paid = Number(booking.payment?.paid || 0);
    const owing = Math.max(0, total - paid);

    const BRAND = "#800080";

    modalContent.innerHTML = `
<div style="display:flex;flex-direction:column;gap:20px;padding:4px;width:100%;max-width:520px;margin:0 auto;box-sizing:border-box;">

  <div style="background:linear-gradient(135deg, ${BRAND} 0%, #5c005c 100%);padding:20px 22px;border-radius:16px;color:#fff;box-shadow:0 10px 30px rgba(128,0,128,0.25);">
    <p style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;opacity:0.85;margin:0 0 6px;">Record Payment</p>
    <h3 style="font-size:20px;font-weight:900;line-height:1.2;margin:0;word-break:break-word;">${booking.client?.name || "Client"}</h3>
  </div>

  <div style="background:#f5edf6;border:1px solid #d8b4fe;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;">
    <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;color:#374151;">
      <span style="opacity:0.75;">Total:</span>
      <strong>₦${total.toLocaleString()}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;color:#374151;">
      <span style="opacity:0.75;">Paid so far:</span>
      <strong>₦${paid.toLocaleString()}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;font-size:15px;border-top:1px solid #d8b4fe;padding-top:10px;">
      <span style="font-weight:800;color:#b91c1c;">Owing:</span>
      <strong style="font-weight:900;color:#b91c1c;">₦${owing.toLocaleString()}</strong>
    </div>
  </div>

  <div style="display:flex;flex-direction:column;gap:6px;">
    <label style="font-size:12px;color:${BRAND};font-weight:700;">Amount received (₦)</label>
    <input id="recordPaymentAmount" type="number" min="0" max="${owing}" placeholder="0"
      style="width:100%;padding:14px 16px;font-size:18px;font-weight:700;border-radius:10px;border:1px solid #d8b4fe;background:#fff;color:#111827;outline:none;box-sizing:border-box;">
  </div>

  <div style="display:flex;gap:10px;">
    <button onclick="closeModal()"
      style="flex:1;padding:12px;background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;">
      Cancel
    </button>
    <button onclick='window.submitRecordedPayment("${id}", "${businessId}")'
      style="flex:1;padding:12px;background:${BRAND};color:#fff;border:none;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;box-shadow:0 6px 20px rgba(128,0,128,0.3);">
      Add Payment
    </button>
  </div>
</div>`;

    bookingModal.style.display = "flex";
    document.body.style.overflow = "hidden";

    // Focus + Enter-to-submit
    const input = document.getElementById("recordPaymentAmount");
    if (input) {
      input.focus();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          window.submitRecordedPayment(id, businessId);
        }
      });
    }
  } catch (err) {
    console.error("openRecordPaymentModal failed:", err);
    alert("Could not open the payment modal: " + err.message);
  }
};
// ===== END CHANGE 9 =====

/* ========================================================
   ===== CHANGE 10: submitRecordedPayment() =====
   Commits an additional payment, updates payment.paid, notifies, then
   reopens the booking modal with fresh data.
======================================================== */
window.submitRecordedPayment = async function(id, businessId) {
  try {
    const input = document.getElementById("recordPaymentAmount");
    const entered = Math.max(0, Number(input?.value || 0));

    const bookingRef = doc(db, "businesses", businessId, "bookings", id);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) {
      alert("Booking not found.");
      return;
    }
    const booking = snap.data();

    const total = Number(booking.payment?.total || 0);
    const paid = Number(booking.payment?.paid || 0);
    const owing = Math.max(0, total - paid);

    if (entered <= 0) {
      alert("Enter a valid amount.");
      return;
    }

    // Clamp so we never overpay.
    const clamped = Math.min(entered, owing);
    const newPaid = Math.min(total, paid + clamped);
    const newOwing = Math.max(0, total - newPaid);

    await updateDoc(bookingRef, { "payment.paid": newPaid });

    if (newOwing <= 0) {
      await sendNotification(
        businessId,
        `${booking.client.name}'s balance is now fully settled. 🎉`,
        auth.currentUser?.email || "System",
        "payment_recorded",
        id
      );
    } else {
      await sendNotification(
        businessId,
        `Payment received from ${booking.client.name}: ₦${clamped.toLocaleString()} — owing now ₦${newOwing.toLocaleString()}.`,
        auth.currentUser?.email || "System",
        "payment_recorded",
        id
      );
    }

    closeModal();
    alert("Payment recorded ✅");

    // Reopen the booking modal with fresh data so badges + totals refresh.
    const freshSnap = await getDoc(bookingRef);
    if (freshSnap.exists()) {
      openBooking(freshSnap.data(), id, businessId);
    }
  } catch (err) {
    console.error("submitRecordedPayment failed:", err);
    alert("Failed to record payment: " + err.message);
  }
};
// ===== END CHANGE 10 =====

/* ========================================================
   ===== OPTION B: Multi-receipt gallery for the EDIT modal =====
   State + rendering helpers. Populated by openEditModal(), mutated
   by add/remove clicks, snapshotted by saveEdit().
======================================================== */
window._editReceiptImages = [];

window.renderEditReceiptGallery = function () {
  const gallery = document.getElementById("editReceiptGallery");
  if (!gallery) return;

  const imgs = window._editReceiptImages || [];

  if (!imgs.length) {
    gallery.innerHTML = `
      <div style="background:#f9fafb;border:2px dashed #d8b4fe;border-radius:8px;padding:20px;text-align:center;cursor:pointer;"
           onclick="document.getElementById('editReceiptInput').click()">
        <span style="font-size:2rem;color:purple;">📸</span>
        <p style="font-size:12px;color:#6b7280;margin:4px 0 0;">Tap to upload receipt image(s)</p>
      </div>`;
    return;
  }

  gallery.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${imgs.map((url, idx) => `
        <div style="position:relative;display:inline-block;">
          <img src="${url}" alt="Receipt ${idx + 1}"
               style="max-height:100px;max-width:140px;border-radius:8px;border:1px solid #e5e5e5;object-fit:contain;background:#fff;">
          <button type="button"
                  onclick="window.removeEditReceipt(${idx})"
                  style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:#dc2626;color:#fff;border:none;font-size:12px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">
            ✕
          </button>
        </div>
      `).join("")}
    </div>
    <button type="button"
            onclick="document.getElementById('editReceiptInput').click()"
            style="margin-top:10px;padding:8px 14px;font-size:12px;font-weight:700;color:purple;background:#f5f0ff;border:1px solid #d8b4fe;border-radius:8px;cursor:pointer;">
      + Add another receipt
    </button>`;
};

window.removeEditReceipt = function (idx) {
  if (!Array.isArray(window._editReceiptImages)) return;
  window._editReceiptImages.splice(idx, 1);
  window.renderEditReceiptGallery();
};
/* ===== END OPTION B ===== */

/* =========================
   EDIT MODAL
========================= */
window.openEditModal = async function(booking, id, businessId) {
  modalContent.innerHTML = `
<div style="display:flex;flex-direction:column;gap:1.25rem;padding:1.75rem;max-width:680px;margin:0 auto;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:1rem;border-bottom:0.5px solid #e5e5e5;">
    <div>
      <h3 style="font-size:16px;font-weight:500;margin:0 0 2px;color:purple;">Edit booking</h3>
      <p style="font-size:13px;color:#6b7280;margin:0;">Changes recalculate inventory instantly.</p>
      <div id="editOverbookWarning" style="display:none;margin-top:8px;background:#fef2f2;color:#b91c1c;font-size:12px;font-weight:500;padding:5px 10px;border-radius:6px;border:0.5px solid #fca5a5;">⚠ One or more entries exceed stock capacity.</div>
    </div>
    <div style="width:36px;height:36px;border-radius:8px;background:#f5f0ff;border:0.5px solid #d8b4fe;display:flex;align-items:center;justify-content:center;">
      <span class="material-symbols-outlined" style="font-size:18px;color:purple;">edit</span>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;">
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:0.5px solid #e5e5e5;">
        <span class="material-symbols-outlined" style="font-size:16px;color:purple;">person</span>
        <span style="font-size:12px;font-weight:600;color:purple;text-transform:uppercase;letter-spacing:.04em;">Customer</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="font-size:12px;color:purple;">Full name</label>
        <input id="editName" type="text" value="${booking.client.name || ""}" style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Phone</label>
          <input id="editPhone" type="text" value="${booking.client.phone || ""}" style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Email</label>
          <input id="editEmail" type="email" value="${booking.client.email || ""}" style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
      </div>
    </div>
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:0.5px solid #e5e5e5;">
        <span class="material-symbols-outlined" style="font-size:16px;color:purple;">calendar_today</span>
        <span style="font-size:12px;font-weight:600;color:purple;text-transform:uppercase;letter-spacing:.04em;">Logistics</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Event type</label>
          <input id="editEventType" type="text" list="eventTypesDataList" value="${booking.event.type || "Other"}" style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
          <datalist id="eventTypesDataList"><option value="Wedding"><option value="Birthday"><option value="Burial"><option value="Conference"><option value="Other"></datalist>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Event date</label>
          <input id="editDate" type="date" value="${booking.event.date || ""}" style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Delivery</label>
          <input id="editDelivery" type="datetime-local" value="${booking.event.deliveryDate || ""}" style="padding:8px 10px;font-size:12px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Return deadline</label>
          <input id="editReturn" type="datetime-local" value="${booking.event.returnDate || ""}" style="padding:8px 10px;font-size:12px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="font-size:12px;color:purple;">Venue</label>
        <input id="editLocation" type="text" value="${booking.event.location || ""}" style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
      </div>
    </div>
  </div>

  <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:10px;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;border-bottom:0.5px solid #e5e5e5;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="material-symbols-outlined" style="font-size:16px;color:purple;">format_list_bulleted</span>
        <span style="font-size:12px;font-weight:600;color:purple;text-transform:uppercase;letter-spacing:.04em;">Items</span>
      </div>
      <button type="button" onclick="addEditItem()" style="font-size:13px;font-weight:500;padding:5px 12px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f5f0ff;color:purple;cursor:pointer;">+ Add item</button>
    </div>
    <div id="editItemsContainer" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;">
      ${(booking.items || []).map(item => `
        <div class="item-row" style="display:flex;gap:6px;align-items:center;background:#fff;border:0.5px solid #e5e5e5;border-radius:6px;padding:8px 10px;flex-wrap:wrap;">
          <div style="flex:2;min-width:120px;">
            <select class="item-name" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;color:#374151;outline:none;">
              <option value="">Select item</option>
              ${inventoryItems.map(inv => `<option value="${inv.name}" data-price="${inv.price}" data-stock="${inv.availableQuantity}" ${!item.isCustom && inv.name.toLowerCase() === item.name.toLowerCase() ? "selected" : ""}>${inv.name} (Stock: ${inv.availableQuantity})</option>`).join("")}
              <option value="__custom__" ${item.isCustom ? "selected" : ""}>✏️ Not in inventory (type item name)</option>
            </select>
          </div>
          <div style="width:70px;"><input class="item-qty" type="number" placeholder="Qty" value="${item.qty || 0}" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
          <div style="width:90px;"><input class="item-price" type="number" placeholder="₦" value="${item.price || 0}" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
          <input class="item-custom-name ${item.isCustom ? "" : "hidden"}" type="text" value="${item.isCustom ? item.name : ""}" placeholder="Type the item name" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;">
          <div class="edit-vendor-wrap" style="display:${(item.isCustom || item.shortage > 0) ? "block" : "none"};width:100%;background:#f5f0ff;border:0.5px solid #d8b4fe;border-radius:6px;padding:6px 8px;">
            <label style="font-size:10px;font-weight:700;color:purple;text-transform:uppercase;display:block;margin-bottom:2px;">Vendor (borrow from)</label>
            <input class="item-supplier" type="text" value="${item.supplier || ""}" placeholder="Vendor" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;box-sizing:border-box;">
          </div>
          <button type="button" onclick="this.parentElement.remove(); recalculateEditWorkspace();" style="width:30px;height:30px;border:0.5px solid #fca5a5;border-radius:6px;background:#fef2f2;color:#b91c1c;cursor:pointer;font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
      `).join("")}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:0.75rem 1rem;">
      <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:4px;">Caution Fee (₦)</label>
      <input id="editCautionFee" type="number" value="${booking.payment?.cautionFee || 0}" style="width:100%;padding:4px 0;font-size:15px;font-weight:500;border:none;background:transparent;color:#374151;outline:none;box-sizing:border-box;">
    </div>
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:0.75rem 1rem;">
      <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:4px;">Transportation (₦)</label>
      <input id="editTransportationFee" type="number" value="${booking.payment?.transportationFee || 0}" style="width:100%;padding:4px 0;font-size:15px;font-weight:500;border:none;background:transparent;color:#374151;outline:none;box-sizing:border-box;">
    </div>
  </div>

  <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <label style="font-size:12px;color:purple;font-weight:600;">Other Fees</label>
      <button type="button" onclick="addEditOtherFeeRow()" style="font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f5f0ff;color:purple;cursor:pointer;">+ Add fee</button>
    </div>
    <div id="editOtherFeesRepeater" style="display:flex;flex-direction:column;gap:6px;"></div>
    <p id="editOtherFeesSubtotalDisplay" style="font-size:11px;color:#9ca3af;margin:0;">Other fees total: ₦0</p>
    <!-- Computed sum of the rows above -- still read exactly like before (payment.otherFees). -->
    <input type="hidden" id="editOtherFees" value="${booking.payment?.otherFees || 0}">
  </div>

  <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;">
    <label style="font-size:12px;color:#9ca3af;display:block;margin-bottom:6px;">Amount paid (₦)</label>
    <input id="editPaid" type="number" value="${booking.payment?.paid || 0}" style="width:100%;padding:4px 0;font-size:20px;font-weight:500;border:none;background:transparent;color:#374151;outline:none;box-sizing:border-box;">
  </div>

  <div style="background:#f5f0ff;border-radius:12px;border:1px solid #d8b4fe;padding:1rem 1.25rem;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
      <label for="editTotal" style="font-size:12px;color:purple;font-weight:600;">Total valuation (₦)</label>
      <span style="display:inline-flex;align-items:center;gap:1.5px;background:#fff;color:purple;border:1px solid #d8b4fe;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;">Editable</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #d8b4fe;border-radius:8px;padding:6px 10px;">
      <span style="font-size:18px;font-weight:700;color:purple;">₦</span>
      <input id="editTotal" type="number" min="0" inputmode="numeric"
        value="${booking.payment?.total || 0}"
        style="width:100%;padding:6px 0;font-size:20px;font-weight:700;border:none;background:transparent;color:purple;outline:none;box-sizing:border-box;">
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap;">
      <p id="editItemsSubtotalDisplay" style="font-size:11px;color:#6b7280;margin:0;">Items + fees subtotal: ₦0</p>
      <button type="button" onclick="useEditSubtotal()"
        style="font-size:11px;font-weight:700;color:purple;background:#fff;border:1px solid #d8b4fe;border-radius:6px;cursor:pointer;padding:4px 10px;">
        Use subtotal
      </button>
    </div>
    <p style="font-size:10px;color:#9ca3af;margin-top:6px;line-height:1.4;">
      Type any amount here — that's what the customer pays. Fees added below will update it automatically until you type your own number.
    </p>
  </div>

<!-- ===== OPTION B: Multi-receipt gallery in edit modal ===== -->
<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;border-top:1px solid #e5e5e5;padding-top:12px;">
  <label style="font-size:12px;color:purple;font-weight:600;">Receipt Images</label>
  <div id="editReceiptGallery"></div>
  <input type="file" id="editReceiptInput" accept="image/*" style="display:none;">
  <p id="editReceiptStatus" style="font-size:11px;color:#059669;margin-top:4px;display:none;">Image uploaded ✅</p>
</div>
<!-- ===== END OPTION B ===== -->

  <div style="display:flex;flex-direction:column;gap:6px;">
    <label style="font-size:12px;color:purple;font-weight:600;">Internal notes</label>
    <textarea id="editNotes" placeholder="Internal updates, client agreements, balance notes..." style="width:100%;padding:10px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;color:#374151;outline:none;min-height:72px;resize:vertical;box-sizing:border-box;font-family:inherit;">${booking.notes || ""}</textarea>
  </div>

  <div style="display:flex;gap:8px;padding-top:4px;">
    <button style="flex:1;padding:11px;font-size:14px;font-weight:500;border-radius:6px;border:none;background:purple;color:#fff;cursor:pointer;"
      onclick='saveEdit("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>Save changes</button>
    <button style="padding:11px 24px;font-size:14px;font-weight:500;border-radius:6px;border:0.5px solid #d1d5db;background:#f9fafb;color:#6b7280;cursor:pointer;"
      onclick="closeModal()">Cancel</button>
  </div>
</div>`;

  // Set business context BEFORE wiring listeners so date changes can resolve it.
  window._editBusinessId = businessId;
  editingBookingId = id;

  document.querySelectorAll("#editItemsContainer .item-row").forEach(attachRowCalculationListeners);

  populateEditOtherFeesRepeater(booking);
  wireEditTotalAndFeeListeners();


  // ===== NEW: Seed the total as "user-owned" so recalculateEditWorkspace
  // doesn't overwrite it with the freshly-computed value on modal open.
  // It only becomes editable-by-recalc again once the user manually changes
  // the total itself (which flips it to dataset.userEdited = "true") OR
  // clears items/fees (which our clearEditTotalOverride() will handle).
  {
    const tEl = document.getElementById("editTotal");
    if (tEl) {
      tEl.dataset.seeded = "true";
      // The seed flag must be dropped the moment the user starts
      // interacting with anything that would legitimately recompute the
      // total — otherwise a stale "seeded" value would override a real
      // recalculation forever.
      const dropSeed = () => { delete tEl.dataset.seeded; };
      ["editCautionFee","editTransportationFee","editOtherFees","editPaid"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", dropSeed, { once: true });
      });
      document.querySelectorAll("#editItemsContainer .item-qty, #editItemsContainer .item-price").forEach(el => {
        el.addEventListener("input", dropSeed, { once: true });
      });
    }
  }



  await refreshEditAvailability(businessId);

  // ===== OPTION B: Bootstrap the multi-receipt gallery for this booking =====
  // Reads receiptImages[] if present; otherwise falls back to the single
  // legacy receiptImage field so old bookings show their one image.
  window._editReceiptImages =
    Array.isArray(booking.receiptImages) && booking.receiptImages.length
      ? [...booking.receiptImages]
      : (booking.receiptImage ? [booking.receiptImage] : []);
  window.renderEditReceiptGallery();

  const editReceiptInput = document.getElementById('editReceiptInput');
  if (editReceiptInput) {
    // Each change adds ONE image to the gallery. User can repeat as many
    // times as they want — mirrors the "Change" affordance they're used to.
    editReceiptInput.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      const statusEl = document.getElementById('editReceiptStatus');
      statusEl.textContent = 'Uploading...';
      statusEl.style.display = 'block';
      statusEl.style.color = '#6b7280';

      try {
        const imageUrl = await uploadReceiptImage(businessId, file);
        if (imageUrl) {
          window._editReceiptImages.push(imageUrl);
          window.renderEditReceiptGallery();
        }
        statusEl.textContent = '✅ Image uploaded!';
        statusEl.style.color = '#059669';
        setTimeout(() => { statusEl.style.display = 'none'; }, 1500);
      } catch (error) {
        console.error('Upload failed:', error);
        statusEl.textContent = '❌ Upload failed';
        statusEl.style.color = '#dc2626';
      }

      // Reset so the same file can be picked again if needed.
      editReceiptInput.value = "";
    });
  }
  // ===== END OPTION B =====
};

/* =========================
   DATE FORMATTERS
========================= */
// Full date with weekday, no time — used for the Event Date field.
function formatDateOnly(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (isNaN(date.getTime())) return value; // fall back to raw string if unparseable
  return date.toLocaleDateString("en-NG", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// Full date + time with weekday — used for Delivery / Return.
function formatDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleString("en-NG", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

window.addEditItem = function() {
  const container = document.getElementById("editItemsContainer");
  const tempRowId = "row_" + Date.now();
  const elementString = `
    <div id="${tempRowId}" class="item-row" style="display:flex;gap:6px;align-items:center;background:#fff;border:0.5px solid #e5e5e5;border-radius:6px;padding:8px 10px;flex-wrap:wrap;animation:fadeIn 0.2s ease;">
      <div style="flex:2;min-width:120px;">
        <select class="item-name" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;color:#374151;outline:none;">
          <option value="">-- Choose Inventory --</option>
          ${inventoryItems.map(inv => `<option value="${inv.name}" data-price="${inv.price}" data-stock="${inv.availableQuantity}">${inv.name} (Available: ${inv.availableQuantity})</option>`).join("")}
          <option value="__custom__">✏️ Not in inventory (type item name)</option>
        </select>
      </div>
      <div style="width:70px;"><input class="item-qty" type="number" value="1" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
      <div style="width:90px;"><input class="item-price" type="number" value="0" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
      <input class="item-custom-name hidden" type="text" placeholder="Type the item name" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;">
      <div class="edit-vendor-wrap" style="display:none;width:100%;background:#f5f0ff;border:0.5px solid #d8b4fe;border-radius:6px;padding:6px 8px;">
        <label style="font-size:10px;font-weight:700;color:purple;text-transform:uppercase;display:block;margin-bottom:2px;">Vendor (borrow from)</label>
        <input class="item-supplier" type="text" placeholder="Vendor" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;box-sizing:border-box;">
      </div>
      <button type="button" onclick="this.parentElement.remove(); recalculateEditWorkspace();" style="width:30px;height:30px;border:0.5px solid #fca5a5;border-radius:6px;background:#fef2f2;color:#b91c1c;cursor:pointer;font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>`;
  container.insertAdjacentHTML("beforeend", elementString);
  const newRow = document.getElementById(tempRowId);
  attachRowCalculationListeners(newRow);
  recalculateEditWorkspace();
};

window.saveEdit = async function(id, businessId, originalItems) {
  const saveBtn = event?.target;
  if (saveBtn) disableButton(saveBtn);

  try {
    const rows = document.querySelectorAll("#editItemsContainer .item-row");
    const updatedItems = [];
    let hasError = false;

    rows.forEach(row => {
      const { name, isCustom } = getEditRowItemName(row);
      const qtyInput = row.querySelector(".item-qty");
      const priceInput = row.querySelector(".item-price");
      const supplierInput = row.querySelector(".item-supplier");

      const qty = Number(qtyInput?.value || 0);
      const price = Number(priceInput?.value || 0);
      const supplier = supplierInput?.value?.trim() || "";

      if (!name || qty <= 0) { hasError = true; return; }
      updatedItems.push({ name, qty, price, total: qty * price, supplier, isCustom, shortage: 0 });
    });

    if (hasError || updatedItems.length === 0) {
      alert("Please fill all items correctly.");
      if (saveBtn) enableButton(saveBtn);
      return;
    }

    // ===== OPTION B: Snapshot the multi-receipt gallery at save time =====
    const finalReceiptImages = Array.isArray(window._editReceiptImages)
      ? [...window._editReceiptImages]
      : [];
    const receiptImageUrl = finalReceiptImages[0] || null;

    const updatedBookingData = {
      "client.name": document.getElementById("editName").value.trim(),
      "client.phone": document.getElementById("editPhone").value.trim(),
      "client.email": document.getElementById("editEmail").value.trim(),
      "event.type": document.getElementById("editEventType").value,
      "event.date": document.getElementById("editDate").value,
      "event.deliveryDate": document.getElementById("editDelivery").value,
      "event.returnDate": document.getElementById("editReturn").value,
      "event.location": document.getElementById("editLocation").value.trim(),
      "payment.total": Number(document.getElementById("editTotal").value || 0),
      "payment.paid": Number(document.getElementById("editPaid").value || 0),
      "payment.cautionFee": Number(document.getElementById("editCautionFee")?.value || 0),
      "payment.transportationFee": Number(document.getElementById("editTransportationFee")?.value || 0),
      "payment.otherFees": Number(document.getElementById("editOtherFees")?.value || 0),
      "payment.otherFeesList": getEditOtherFeesList(),
      // Write BOTH fields — array for new code, first-or-null for legacy readers.
      receiptImage: receiptImageUrl,
      receiptImages: finalReceiptImages,
      notes: document.getElementById("editNotes").value.trim()
    };
    // ===== END OPTION B =====

    const { shortages } = await editBookingTransaction(businessId, id, updatedBookingData, originalItems, updatedItems);

    if (shortages && shortages.length) {
      const msg = shortages.map(s => `${s.name}: borrow ${s.shortage} (only ${s.available} free for these dates)`).join("\n");
      alert(`⚠ Saved, but not enough stock for these dates — vendor borrow recorded automatically:\n${msg}`);
    } else {
      alert("Booking updated successfully! ✅");
    }
    closeModal();

    // ===== OPTION B: Clear the gallery state after save =====
    window._editReceiptImages = [];
    // ===== END OPTION B =====

    await sendNotification(
      businessId,
      `Booking for ${updatedBookingData["client.name"]} was updated.`,
      auth.currentUser.email,
      "booking_edited",
      id
    );
  } catch (error) {
    console.error("Error saving booking edit:", error);
    alert("Failed to save booking edits: " + error.message);
    if (saveBtn) enableButton(saveBtn);
  }
};

window.closeModal = function() {
  bookingModal.style.display = "none";
  document.body.style.overflow = "";
};

function disableButton(button, duration = 1500) {
  button.disabled = true;
  button.style.opacity = "0.5";
  button.style.cursor = "not-allowed";
  setTimeout(() => {
    button.disabled = false;
    button.style.opacity = "";
    button.style.cursor = "";
  }, duration);
}

function enableButton(button) {
  button.disabled = false;
  button.style.opacity = "";
  button.style.cursor = "";
}

/* =========================
   RENDER ROW (TABLE)
   Uses the same renderBadge() and renderOverbookedPill() as the modal,
   so badges are visually identical across the table and the detail view.
========================= */
// ===== CHANGE 2: renderRow() now also shows the Owing pill =====
function renderRow(b, id, businessId) {
  const isOverbooked = isBookingOverbooked(b);
  const owing = Math.max(0, Number(b.payment?.total || 0) - Number(b.payment?.paid || 0));

  return `
    <tr class="hover:bg-gray-50 transition-colors border-b border-gray-100">
      <td class="p-4 font-medium text-gray-800 cursor-pointer" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)">${b.client.name}</td>
      <td class="p-4 text-gray-600 text-sm cursor-pointer" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)">${formatDateTime(b.event.deliveryDate || b.event.date)}</td>
      <td class="p-4 cursor-pointer" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)">
        <div class="flex items-center gap-2 flex-wrap">
          ${renderBadge(b, "text-[10px]")}
          ${b.damageStatus === "damaged" ? renderDamagedPill() : ""}
          ${isOverbooked ? renderOverbookedPill() : ""}
          ${owing > 0 ? renderOwingPill() : ""}
        </div>
      </td>
      <td class="p-4">
        <button type="button" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)"
          class="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl font-bold text-sm shadow-md transition-all duration-200">View</button>
      </td>
    </tr>`;
}
// ===== END CHANGE 2 =====

window.handleViewClick = function(element) {
  openBookingById(element.dataset.id, element.dataset.business);
};

window.openBookingById = async function(id, businessId) {
  try {
    if (!id || !businessId) return alert("Missing booking details");
    const snap = await getDoc(doc(db, "businesses", businessId, "bookings", id));
    if (!snap.exists()) return alert("Booking not found");
    openBooking(snap.data(), id, businessId);
  } catch (error) {
    console.error("OPEN ERROR:", error);
    alert("Failed to open booking: " + error.message);
  }
};

async function checkAndNotifyStatusChange(booking, id, businessId) {
  const calculated = getCalculatedStatus(booking);
  const bookingRef = doc(db, "businesses", businessId, "bookings", id);
  const isOverbooked = booking.items?.some(i => (i.shortage || 0) > 0);
  const updates = {};

  if (booking.status !== calculated) {
    updates.status = calculated;
    if (calculated === "overdue" && !booking.overdueNotified) {
      await sendNotification(businessId, `OVERDUE - Booking for ${booking.client.name} is OVERDUE`, auth.currentUser?.email, "booking_overdue", id);
      updates.overdueNotified = true;
    }
    if (calculated === "returned" && !booking.returnNotified) {
      await sendNotification(businessId, `RETURNED - Booking for ${booking.client.name} has been RETURNED`, auth.currentUser?.email, "booking_returned", id);
      updates.returnNotified = true;
    }
  }
  if (isOverbooked && !booking.overbookedNotified) {
    await sendNotification(businessId, `OVERBOOKED - Booking for ${booking.client.name} is OVERBOOKED (vendor stock used)`, auth.currentUser?.email, "booking_overbooked", id);
    updates.overbookedNotified = true;
  }
  if (Object.keys(updates).length > 0) await updateDoc(bookingRef, updates);
}

function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;background:rgba(128,0,128,0.95);backdrop-filter:blur(10px);color:white;text-align:center;padding:12px;z-index:99999;font-weight:500;font-size:14px;box-shadow:0 4px 15px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;gap:8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

function showErrorBanner(message) {
  if (document.getElementById("errorBanner")) return;
  const banner = document.createElement("div");
  banner.id = "errorBanner";
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;background:rgba(220,38,38,0.95);backdrop-filter:blur(10px);color:white;text-align:center;padding:12px;z-index:99999;font-weight:500;font-size:14px;box-shadow:0 4px 15px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;gap:8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;">error</span> Error: ${message}. Please refresh or try logging out.`;
  document.body.appendChild(banner);
}

/* =========================
   NOTIFICATION HELPER
========================= */
async function sendNotification(businessId, message, userEmail, type, bookingId = "") {
    try {
        const notifRef = collection(db, "businesses", businessId, "notifications");
        await addDoc(notifRef, {
            message,
            triggeredBy: userEmail || "System",
            type,
            bookingId,
            createdAt: serverTimestamp(),
            readBy: [],
            deletedFor: []
        });

        const deepLink = bookingId
            ? `/bookings.html?highlight=${bookingId}`
            : `/dashboard.html`;

        try {
            if (typeof sendPush === 'function') {
                await sendPush(message, deepLink);
            } else if (window.sendPush) {
                await window.sendPush(message, deepLink);
            } else {
                const { sendPush: importedSendPush } = await import('./onesignal.js');
                await importedSendPush(message, deepLink);
            }
        } catch (pushError) {
            console.warn('[Notification] Push failed but in-app saved:', pushError.message);
        }

        console.log("✅ Notification saved:", message);
    } catch (err) {
        console.error("[Notification] Error:", err);
    }
}

/* =========================
   AUTH & MAIN LOAD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "signup.html"; return; }

  try {
    const businessId = await getBusinessIdByEmail(user.email, user);
    await loadBusinessMetadata(user, businessId);

    if (!navigator.onLine) showOfflineBanner();

    runAutomatedChecks(businessId).catch(err => console.error("Auto checks error:", err));

    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data?.type === 'TRIGGER_AUTO_CHECKS') {
        runAutomatedChecks(businessId).catch(err => console.error(err));
      }
    });

    await loadInventory(businessId);

    const tbody = document.getElementById("bookingsTable");
    const q = query(collection(db, "businesses", businessId, "bookings"));

    onSnapshot(q, (snap) => {
      let mapped = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      mapped.sort((a, b) => {
        const getTime = (x) => x.data.createdAt?.toDate?.()?.getTime() || new Date(x.data.createdAt || x.data.event?.date || x.data.date || 0).getTime();
        return getTime(b) - getTime(a);
      });
      allBookingsGlobal = mapped;

      function filterAndRender() {
        const sFilter = document.getElementById("filterStatus")?.value || "";
        const dFilter = document.getElementById("filterDate")?.value || "";
        // ===== FIX: lowercase the search term ONCE so every comparison is
        // case-insensitive regardless of what the user (or a deep-link from
        // the Borrowed In vendor header) typed.
        const search = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();

        if (!tbody) return;
        tbody.innerHTML = "";

        const filtered = allBookingsGlobal.filter(({ data }) => {
          const currentStatus = getCalculatedStatus(data);
          const isOverbooked = isBookingOverbooked(data);

          let matchesStatus = !sFilter || (sFilter === "overbooked" ? isOverbooked : currentStatus === sFilter);
          const matchesDate   = !dFilter || data.event?.date === dFilter;

          // ===== FIX: case-insensitive search across client name AND every
          // item's supplier. This is what makes the ?vendor=<name> deep-link
          // from rental-to-rental.html land on the right bookings regardless
          // of casing differences between the two pages.
          const matchesSearch = !search ||
            (data.client?.name || "").toLowerCase().includes(search) ||
            (data.items || []).some(i =>
              (i.supplier || "").toLowerCase().includes(search)
            );

          return matchesStatus && matchesDate && matchesSearch;
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center py-20 opacity-40 font-bold">No Bookings Found</td></tr>`;
          return;
        }

        filtered.forEach(({ id, data }) => {
          tbody.innerHTML += renderRow(data, id, businessId);
          checkAndNotifyStatusChange(data, id, businessId);
        });
      }

      const sF = document.getElementById("filterStatus");
      const dF = document.getElementById("filterDate");
      const sI = document.getElementById("searchInput");
      if (sF) sF.onchange = filterAndRender;
      if (dF) dF.onchange = filterAndRender;
      if (sI) sI.oninput = filterAndRender;

      // ===== FIX: if a ?vendor= deep-link landed on this page, populate the
      // search box BEFORE the first filterAndRender() runs so the table is
      // already filtered on the first paint — no flash of unfiltered rows.
      if (presetVendor && sI && sI.value !== presetVendor) {
        sI.value = presetVendor;
      }

      filterAndRender();

      if (highlightId) {
        const match = allBookingsGlobal.find(b => b.id === highlightId);
        if (match) openBooking(match.data, match.id, businessId);
      }
    }, (err) => {
      console.error("Snapshot error:", err);
      showErrorBanner(err.message || "Failed to load bookings");
    });

  } catch (err) {
    console.error("Dashboard Load Error:", err);
    if (!navigator.onLine || err.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else if (err.message === "NO_BUSINESS" || err.message === "Business not found") {
      if (user?.uid) localStorage.removeItem(`businessId_${user.uid}`);
      window.location.href = "setup.html";
    } else {
      if (user?.uid) localStorage.removeItem(`businessId_${user.uid}`);
      showErrorBanner(err.message || err);
    } 
  }
});