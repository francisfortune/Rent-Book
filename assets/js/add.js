import { auth, db, storage } from "./firebase.js";
import { checkDateAvailability, getAvailabilityMap, fetchActiveBookings } from "./services/availabilityService.js";
import { getBusinessIdByEmail } from "./shared.js";
import { sendPush } from "./onesignal.js";
import { uploadReceiptImage } from "./utils/upload.js";

import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


let currentBusinessName = "Our Business";
let inventoryItems = [];
let activeBookingsCache = []; // other bookings, refreshed whenever the event/delivery/return dates change
let availabilityMap = new Map(); // itemNameLower -> units free for the currently selected date window

function getFormDateWindow() {
  const deliveryEl = document.getElementById("deliveryDate");
  const eventEl = document.getElementById("eventDate");
  const returnEl = document.getElementById("returnDate");
  const start = (deliveryEl?.value || eventEl?.value || "").trim();
  const end = (returnEl?.value || start).trim();
  return { start: start || null, end: end || null };
}

/**
 * Refetch other active bookings and rebuild the per-item availability map for
 * whatever dates are currently in the form, then refresh every item-row
 * dropdown so the "(X avail)" labels reflect THOSE dates, not just raw stock.
 */
async function refreshAvailabilityForFormDates() {
  const { start, end } = getFormDateWindow();
  if (!start) {
    availabilityMap = new Map();
    return;
  }
  try {
    activeBookingsCache = await fetchActiveBookings(businessId);
    availabilityMap = getAvailabilityMap(inventoryItems, activeBookingsCache, new Date(start), new Date(end));
  } catch (err) {
    console.error("Error refreshing date-based availability:", err);
  }
  refreshAllItemRowOptions();
  document.querySelectorAll(".item-row").forEach(row => checkRowShortage(row));
}

function refreshAllItemRowOptions() {
  document.querySelectorAll(".item-row .item-name").forEach(select => {
    const currentValue = select.value;
    Array.from(select.options).forEach(opt => {
      if (!opt.value || opt.value === "__custom__") return;
      const key = opt.value.trim().toLowerCase();
      const free = availabilityMap.has(key) ? availabilityMap.get(key) : Number(opt.dataset.avail || 0);
      opt.dataset.freeForDates = free;
      opt.textContent = `${opt.value} (${free} avail for these dates)`;
    });
    select.value = currentValue;
  });
}

/* ========================================================
   DRAFT AUTOSAVE — like a WhatsApp draft: everything typed is kept in this
   browser (localStorage) as you go, is restored if you navigate away and
   come back — even days later — but is never written to your bookings
   until you actually tap "Save"/"Create Booking".
======================================================== */
const DRAFT_FIELD_IDS = [
  "clientName", "clientPhone", "clientEmail", "eventType", "eventDate",
  "deliveryDate", "returnDate", "eventLocation", "paymentMethod", "notes",
  "totalAmount", "amountPaid", "cautionFee", "transportationFee", "otherFees"
];

function getDraftKey() {
  return businessId ? `addBookingDraft_${businessId}` : null;
}

function collectDraftState() {
  const fields = {};
  DRAFT_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) fields[id] = el.value;
  });

  const items = Array.from(document.querySelectorAll(".item-row")).map(row => ({
    itemName: row.querySelector(".item-name")?.value || "",
    customName: row.querySelector(".item-custom-name")?.value || "",
    qty: row.querySelector(".item-qty")?.value || "",
    price: row.querySelector(".item-price")?.value || "",
    vendor: row.querySelector(".vendor-name")?.value || ""
  }));

  return { fields, items, savedAt: Date.now() };
}

let draftSaveTimer;
function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    const key = getDraftKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(collectDraftState()));
    } catch (err) {
      console.warn("[Draft] Could not save draft:", err);
    }
  }, 400);
}

function clearDraft() {
  const key = getDraftKey();
  if (key) localStorage.removeItem(key);
}

function draftHasContent(draft) {
  if (!draft) return false;
  const fieldsHaveContent = Object.values(draft.fields || {}).some(v => (v || "").toString().trim().length > 0);
  const itemsHaveContent = (draft.items || []).some(i => (i.itemName || i.customName || "").trim().length > 0);
  return fieldsHaveContent || itemsHaveContent;
}

/** Restores a saved draft (with confirmation) if one exists. Returns true if it restored a draft's item rows. */
async function restoreDraftIfAny() {
  const key = getDraftKey();
  if (!key) return false;

  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    draft = null;
  }

  if (!draftHasContent(draft)) return false;

  if (!confirm("You have an unsaved booking draft from before. Restore it?")) {
    clearDraft();
    return false;
  }

  Object.entries(draft.fields || {}).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  // A restored total/paid value should behave exactly like one the user just
  // typed — recalcTotal must not silently overwrite it.
  if (draft.fields?.totalAmount) document.getElementById("totalAmount")?.setAttribute("data-user-edited", "true");
  if (draft.fields?.amountPaid) document.getElementById("amountPaid")?.setAttribute("data-user-edited", "true");

  const container = document.getElementById("itemsContainer");
  container.innerHTML = "";
  const draftItems = draft.items && draft.items.length ? draft.items : [{}];
  draftItems.forEach(itemDraft => {
    addItemRow();
    const row = container.lastElementChild;
    const select = row.querySelector(".item-name");
    const customInput = row.querySelector(".item-custom-name");

    if (itemDraft.itemName) select.value = itemDraft.itemName;
    if (itemDraft.itemName === "__custom__" || itemDraft.customName) {
      select.value = "__custom__";
      customInput.classList.remove("hidden");
      customInput.value = itemDraft.customName || "";
    }
    if (itemDraft.qty) row.querySelector(".item-qty").value = itemDraft.qty;
    if (itemDraft.price) row.querySelector(".item-price").value = itemDraft.price;
    if (itemDraft.vendor) row.querySelector(".vendor-name").value = itemDraft.vendor;
    checkRowShortage(row);
  });
  updateSelectOptions();

  return true;
}

async function sendNotification(businessId, message, userEmail, type = "general", bookingId = null) {
  try {
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message,
      triggeredBy: userEmail,
      type,
      bookingId,          // link to booking if exists
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error("Notification error:", e);
  }
}

/* =========================
   BUSINESS LOOKUP
========================= */


/* =========================
   TOTAL CALCULATION
========================= */



function getFeeValue(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return parseFloat((el.value || "0").toString().replace(/,/g, '')) || 0;
}

/**
 * When items or fees change, clear the "user override" state on the total,
 * so recalcTotal() will auto-update it again with the new computed value.
 * This is what makes "edit items → total updates" work even after the user
 * has manually typed a custom total.
 */
function clearTotalUserOverride() {
  const totalInput = document.getElementById("totalAmount");
  if (totalInput) {
    delete totalInput.dataset.lastComputed;
    // Also clear any legacy flag from the old logic
    delete totalInput.dataset.userEdited;
  }
}

function recalcTotal() {
  let itemsSubtotal = 0;
  let itemsSummary = "";

  document.querySelectorAll(".item-row").forEach(row => {
    const { name } = getRowItemName(row);
    const qty = Number(row.querySelector(".item-qty")?.value || 0);
    const price = Number(row.querySelector(".item-price")?.value || 0);
    const vendor = row.querySelector(".vendor-name")?.value;

    const rowTotal = qty * price;
    itemsSubtotal += rowTotal;

    if (qty > 0 && name) {
      const vendorTag = vendor ? ` [Ext: ${vendor}]` : "";
      itemsSummary += `• ${name} (x${qty})${vendorTag} - ₦${rowTotal.toLocaleString()}\n`;
    }
  });

  const cautionFee = getFeeValue("cautionFee");
  const transportationFee = getFeeValue("transportationFee");
  const otherFees = getFeeValue("otherFees");
  const feesTotal = cautionFee + transportationFee + otherFees;
  const computedTotal = itemsSubtotal + feesTotal;

  const itemsSubtotalDisplay = document.getElementById("itemsSubtotalDisplay");
  if (itemsSubtotalDisplay) {
    itemsSubtotalDisplay.textContent = `Items subtotal: ₦${itemsSubtotal.toLocaleString('en-NG')}${feesTotal ? ` + ₦${feesTotal.toLocaleString('en-NG')} fees = ₦${computedTotal.toLocaleString('en-NG')}` : ""}`;
  }

  const totalAmountInput = document.getElementById("totalAmount");
  const amountPaidInput = document.getElementById("amountPaid");

  // ✅ Track the last auto-computed value so we can detect user overrides.
  // If the user's typed total matches what we last computed (or is empty),
  // it means they didn't truly override it — so keep auto-updating.
  // If they typed something DIFFERENT from our last computed value, treat
  // that as a manual override (skip auto-update until items/fees change).
  const lastComputed = totalAmountInput?.dataset.lastComputed;
  const currentVal = (totalAmountInput?.value || "").toString().trim();

  const isUserOverride =
    totalAmountInput &&
    currentVal !== "" &&
    lastComputed !== undefined &&
    currentVal !== lastComputed;

  if (totalAmountInput && !isUserOverride) {
    totalAmountInput.value = computedTotal || 0;
    totalAmountInput.dataset.lastComputed = String(computedTotal || 0);
  }

  const total = totalAmountInput
    ? parseFloat((totalAmountInput.value || "0").toString().replace(/,/g, '')) || 0
    : computedTotal;

  const paidRaw = amountPaidInput ? amountPaidInput.value.replace(/,/g, '') : '0';
  const paidValue = parseFloat(paidRaw) || 0;

  if (amountPaidInput && !amountPaidInput.dataset.userEdited) {
    amountPaidInput.value = paidValue || 0;
  }

  const balance = total - paidValue;

  const formattedTotal = total.toLocaleString('en-NG');
  const formattedPaid = paidValue.toLocaleString('en-NG');

  let feesLines = "";
  if (cautionFee) feesLines += `Caution Fee: ₦${cautionFee.toLocaleString('en-NG')}\n`;
  if (transportationFee) feesLines += `Transportation: ₦${transportationFee.toLocaleString('en-NG')}\n`;
  if (otherFees) feesLines += `Other Fees: ₦${otherFees.toLocaleString('en-NG')}\n`;

  // Build Preview with formatted values
  const previewText = 
    `*BOOKING CONFIRMATION - ${currentBusinessName.toUpperCase()}*\n\n` +
    `Hi ${document.getElementById("clientName")?.value || "Customer"}, your booking is confirmed! ✅\n\n` +
    `Event Date: ${document.getElementById("eventDate")?.value || "Date"}\n` +
       `Delivery Date: ${document.getElementById("deliveryDate")?.value || "Date"}\n` +
    `Return Date: ${document.getElementById("returnDate")?.value || "Date"}\n` +
    `Location: ${document.getElementById("eventLocation")?.value || "Not specified"}\n\n` +
    `Items Ordered: \n${itemsSummary}\n` +
    (feesLines ? `${feesLines}\n` : "") +
    `Total: ₦${formattedTotal}\n` +
    `Paid: ₦${formattedPaid}\n` +
    `Balance: ₦${balance.toLocaleString()}\n\n` +
    `Thank you for choosing ${currentBusinessName}!\n\n` +
    `--- \n` + 
    `_Powered by Tracknrent_ \n` + 
    `👉 https://tracknrent.vercel.app`;
  


  const previewBox = document.getElementById("liveReceiptText");
  if (previewBox) {
    previewBox.innerText = previewText;
  }
}



// ✅ Add event listeners for text inputs (type="text" with inputmode="numeric")
document.addEventListener('DOMContentLoaded', function() {
  const totalAmountInput = document.getElementById("totalAmount");
  const amountPaidInput = document.getElementById("amountPaid");
  
  // ===== TOTAL AMOUNT: allow editing but auto-update on item/fee change =====
  if (totalAmountInput) {
    totalAmountInput.addEventListener('focus', function() {
      // Show raw number when focused
      const raw = this.value.replace(/,/g, '');
      if (raw) this.value = raw;
    });
    totalAmountInput.addEventListener('blur', function() {
      // Keep raw value (no commas in input)
      const raw = parseFloat(this.value.replace(/,/g, '')) || 0;
      this.value = raw;
    });
    // ❌ NO input listener setting data-user-edited —
    // the new logic in recalcTotal() handles user override detection.
  }
  
  // ===== AMOUNT PAID: user-edited flag (independent) =====
  if (amountPaidInput) {
    amountPaidInput.addEventListener('focus', function() {
      const raw = this.value.replace(/,/g, '');
      if (raw) this.value = raw;
    });
    amountPaidInput.addEventListener('blur', function() {
      const raw = parseFloat(this.value.replace(/,/g, '')) || 0;
      this.value = raw;
    });
    amountPaidInput.addEventListener('input', function() {
      this.dataset.userEdited = 'true';
    });
  }

  // ===== FEES: clear total override so items + fees recalc =====
  ["cautionFee", "transportationFee", "otherFees"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        clearTotalUserOverride();
        recalcTotal();
      });
    }
  });

  // ===== DATE CHANGES: refresh availability =====
  let dateDebounce;
  ["eventDate", "deliveryDate", "returnDate"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        clearTimeout(dateDebounce);
        dateDebounce = setTimeout(refreshAvailabilityForFormDates, 250);
      });
    }
  });
});


/* =========================
   ADD ITEM ROW
========================= */

/**
 * Reads the effective item name for a row: either the picked catalog item,
 * or whatever the user typed in the "not in inventory" text box.
 */
function getRowItemName(row) {
  const select = row.querySelector(".item-name");
  const isCustom = select.value === "__custom__";
  const customInput = row.querySelector(".item-custom-name");
  const name = isCustom ? (customInput?.value.trim() || "") : (select.value || "");
  return { name, isCustom };
}

/**
 * Looks up how many units are free for the CURRENT form dates (not just raw
 * stock) and shows/hides the vendor field accordingly. Custom items always
 * show the vendor field, since there's no catalog stock to check them against.
 */
function checkRowShortage(row) {
  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const vendorContainer = row.querySelector(".vendor-container");
  const { name, isCustom } = getRowItemName(row);
  const requested = Number(qtyInput.value || 0);

  if (isCustom) {
    // Not in inventory at all — always borrowed from a vendor.
    vendorContainer.classList.remove("hidden");
    recalcTotal();
    return;
  }

  const key = name.trim().toLowerCase();
  const freeForDates = availabilityMap.has(key)
    ? availabilityMap.get(key)
    : Number(select.selectedOptions[0]?.dataset.avail || 0);

  if (requested > freeForDates) {
    vendorContainer.classList.remove("hidden");
  } else {
    vendorContainer.classList.add("hidden");
  }
  recalcTotal();
}

window.addItemRow = function () {
  const container = document.getElementById("itemsContainer");
  const row = document.createElement("div");
  row.className = "item-row flex flex-wrap gap-2 items-center mb-2 bg-gray-50 p-2 rounded-xl relative";

  row.innerHTML = `
    <select class="item-name flex-[2] p-2 border rounded-lg outline-none" required>
      <option value="">Select an Item</option>
      ${inventoryItems.map(item => `
        <option value="${item.name}" data-price="${item.price}" data-avail="${item.availableQuantity}">
          ${item.name} (${item.availableQuantity} avail)
        </option>
      `).join("")}
      <option value="__custom__">✏️ Not in inventory (type item name)</option>
    </select>
    <div class="flex gap-2 w-full sm:w-auto">
        <input class="item-qty w-20 p-2 border rounded-lg outline-none" type="number" min="1" value="1" required>
        <input class="item-price w-24 p-2 border rounded-lg outline-none" type="number" placeholder="Price">
    </div>

    <input class="item-custom-name hidden w-full p-2 border rounded-lg outline-none"
           placeholder="Type the item name">

    <div class="vendor-container hidden w-full mt-2 p-3 border border-purple-200 bg-purple-50 rounded-lg">
        <label class="block text-[10px] font-bold text-purple-700 uppercase mb-1">Vendor Name (To borrow from):</label>
        <input class="vendor-name w-full p-2 border border-purple-300 rounded-md text-sm outline-none" 
               placeholder="e.g. Demo Rentals" title='Vendor to borrow shortage from'>
    </div>
    
    
    <button type="button" class="absolute top-2 right-2 sm:static w-10 h-10 flex items-center justify-center bg-red-50 text-red-600 rounded-lg">✕</button>
  `;

  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");
  const customNameInput = row.querySelector(".item-custom-name");
  const vendorInput = row.querySelector(".vendor-name");
  const vendorContainer = row.querySelector(".vendor-container");
  const removeBtn = row.querySelector("button");

  select.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (e.target.value === "__custom__") {
      customNameInput.classList.remove("hidden");
      customNameInput.focus();
      priceInput.value = "";               // clear stale price
      priceInput.placeholder = "price";
    } else {
      customNameInput.classList.add("hidden");
      customNameInput.value = "";
      priceInput.value = opt?.dataset.price || "";
      priceInput.placeholder = "Price";
    }
    clearTotalUserOverride();  // ✅ Reset total override on item change
    checkRowShortage(row);
    updateSelectOptions();
  });

  qtyInput.addEventListener("input", () => {
    clearTotalUserOverride();  // ✅ Reset total override on qty change
    checkRowShortage(row);
  });

  priceInput.addEventListener("input", () => {
    clearTotalUserOverride();  // ✅ Reset total override on price change
    recalcTotal();
  });

  customNameInput.addEventListener("input", () => {
    clearTotalUserOverride();  // ✅ Reset total override on name change
    recalcTotal();
  });

  vendorInput.addEventListener("input", recalcTotal);

  removeBtn.addEventListener("click", () => {
    row.remove();
    clearTotalUserOverride();  // ✅ Reset total override on row removal
    recalcTotal();
    updateSelectOptions();
  });

  container.appendChild(row);
  updateSelectOptions();
};


let businessId = "";
let currentUser = null;

/* =========================
   AUTH + SUBMIT
========================= */

function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(128, 0, 128, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

function showErrorBanner(message) {
  if (document.getElementById("errorBanner")) return;
  const banner = document.createElement("div");
  banner.id = "errorBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(220, 38, 38, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">error</span> Error: ${message}. Please refresh or try logging out.`;
  document.body.appendChild(banner);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    currentUser = user; // ✅ SAVE USER
    businessId = await getBusinessIdByEmail(user.email, user); // ✅ NO const
    if (!navigator.onLine) {
      showOfflineBanner();
    }

    const bizSnap = await getDoc(doc(db, "businesses", businessId));
    if (bizSnap.exists()) {
      currentBusinessName = bizSnap.data().name;
    }

    const invSnap = await getDocs(
      collection(db, "businesses", businessId, "inventory")
    );

    inventoryItems = invSnap.docs
      .map(d => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
    
    // ✅ ADD LISTENERS FOR LIVE UPDATES
    const liveFields = ["clientName", "eventDate", "eventLocation", "amountPaid", "returnDate"];
    liveFields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        // Use 'input' event so it updates as you type
        el.addEventListener("input", recalcTotal);
      }
    });

    const restoredDraft = await restoreDraftIfAny();
    if (!restoredDraft) {
      addItemRow();
    }
    await refreshAvailabilityForFormDates();
    recalcTotal();

    // Autosave every keystroke (debounced) across the whole form, including
    // dynamically-added item rows — nothing is written to Firestore until
    // "Create Booking" is actually pressed.
    const bookingForm = document.getElementById("addBookingForm");
    bookingForm?.addEventListener("input", scheduleDraftSave);
    bookingForm?.addEventListener("change", scheduleDraftSave);

  } catch (error) {
    console.error("Auth Init Error:", error);
    if (!navigator.onLine || error.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else if (error.message === "NO_BUSINESS" || error.message === "Business not found") {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      window.location.href = "setup.html";
    } else {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      showErrorBanner(error.message || error);
    }
  }
});

// 3. Receipt image preview handler
const receiptInput = document.getElementById("receiptImage");
const receiptPreview = document.getElementById("receiptPreview");
const receiptThumbnail = document.getElementById("receiptThumbnail");
const receiptText = document.getElementById("receiptText");

if (receiptInput) {
  receiptInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        receiptThumbnail.src = e.target.result;
        receiptPreview.style.display = "block";
        receiptText.textContent = "Tap to change receipt";
      };
      reader.readAsDataURL(file);
    }
  });
}

document
  .getElementById("addBookingForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    try {
      /* ===== VALIDATION ===== */

      const delivery = deliveryDate.value || eventDate.value;

      if (new Date(returnDate.value) < new Date(delivery)) {
        alert("Return date cannot be before delivery date");

        // ✅ FIX: restore button
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;

        return;
      }

      const rawItems = [];
      document.querySelectorAll(".item-row").forEach(row => {
        const { name, isCustom } = getRowItemName(row);
        const qty = Number(row.querySelector(".item-qty").value);
        const price = Number(row.querySelector(".item-price").value);
        const supplierInput = row.querySelector(".vendor-name");

        if (!name || qty <= 0) return;

        rawItems.push({ name, qty, price, isCustom, supplierInput: supplierInput?.value || "" });
      });

      if (!rawItems.length) {
        alert("Add at least one item");
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }

      /* ===== DATE-BASED AVAILABILITY CHECK =====
         Re-verify (right before saving) how much of each item is actually
         free for THIS booking's date window, since inventory or other
         bookings may have changed since the page loaded. */
      const { start: windowStart, end: windowEnd } = getFormDateWindow();
      const { availabilityMap: freshAvailabilityMap } = await checkDateAvailability(
        businessId,
        inventoryItems,
        rawItems,
        windowStart,
        windowEnd
      );

      const items = rawItems.map(ri => {
        if (ri.isCustom) {
          return {
            name: ri.name,
            qty: ri.qty,
            price: ri.price,
            total: ri.qty * ri.price,
            isCustom: true,
            shortage: ri.qty,
            borrowed: ri.qty,
            supplier: ri.supplierInput
          };
        }
        const key = ri.name.trim().toLowerCase();
        const freeForDates = freshAvailabilityMap.has(key) ? freshAvailabilityMap.get(key) : 0;
        const shortage = Math.max(0, ri.qty - freeForDates);
        return {
          name: ri.name,
          qty: ri.qty,
          price: ri.price,
          total: ri.qty * ri.price,
          availableAtBooking: freeForDates,
          shortage,
          borrowed: shortage > 0 ? shortage : 0,
          supplier: shortage > 0 ? ri.supplierInput : ""
        };
      });

      const overbookedItems = items.filter(i => i.shortage > 0);
      if (overbookedItems.length) {
        const msg = overbookedItems
          .map(i => `${i.name}: borrow ${i.shortage} (only ${i.availableAtBooking ?? 0} free for these dates)`)
          .join("\n");

        if (!confirm(`⚠ Not enough stock for these dates:\n${msg}\n\nContinue anyway (borrow the shortfall)?`)) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          return;
        }
      }

      /* ===== UPLOAD RECEIPT IMAGE ===== */
      let receiptImageUrl = null;
      const receiptFile = receiptInput?.files[0];
      if (receiptFile) {
        submitBtn.textContent = "Uploading receipt...";
        receiptImageUrl = await uploadReceiptImage(businessId, receiptFile);
      }

      // Inside the submit event listener, before creating bookingData:

      // ✅ Remove commas from total and paid before saving
      const totalAmount = document.getElementById("totalAmount");
      const amountPaid = document.getElementById("amountPaid");

      const cleanTotal = parseFloat(totalAmount.value.replace(/,/g, '')) || 0;
      const cleanPaid = parseFloat(amountPaid.value.replace(/,/g, '')) || 0;
      const cleanCaution = getFeeValue("cautionFee");
      const cleanTransportation = getFeeValue("transportationFee");
      const cleanOtherFees = getFeeValue("otherFees");

      // ✅ Update the bookingData payment section
      const bookingData = {
        client: {
          name: clientName.value.trim(),
          phone: clientPhone.value.trim(),
          email: clientEmail.value.trim() || ""
        },
        event: {
          type: eventType.value,
          date: eventDate.value,
          deliveryDate: deliveryDate.value || "",
          returnDate: returnDate.value,
          location: eventLocation.value || ""
        },
        items,
        payment: {
          total: cleanTotal,
          paid: cleanPaid,
          method: paymentMethod.value,
          cautionFee: cleanCaution,
          transportationFee: cleanTransportation,
          otherFees: cleanOtherFees
        },
        receiptImage: receiptImageUrl,
        notes: document.getElementById("notes")?.value || "",
        status: "active",
        createdBy: {
          uid: currentUser.uid,
          email: currentUser.email
        },
        createdAt: serverTimestamp()
      };
       
      /* ===== SAVE BOOKING ===== */
      const bookingRef = await addDoc(
        collection(db, "businesses", businessId, "bookings"),
        bookingData
      );

      // Add listeners for live updates
      ["clientName", "eventDate", "eventLocation", "amountPaid"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", recalcTotal);
      });

      // Also recalc on page load
      recalcTotal();

      // 🔔 Send notification about new booking with bookingId
      await sendNotification(
        businessId,
        `New booking added ${bookingData.client.name} on ${bookingData.event.date}`,
        currentUser.email, // ✅ FIXED
        "booking_added",      // type
        bookingRef.id         // bookingId
      );

      // Send real-time OneSignal push notification
      await sendPush(
        `New booking added: ${bookingData.client.name} on ${bookingData.event.date}`,
        `/bookings.html?highlight=${bookingRef.id}`
      );

      // 🎇 2. WELCOME NOTIFICATION (Add this part)
      // This checks if this is the very first booking in the system
      const allBookings = await getDocs(collection(db, "businesses", businessId, "bookings"));
      if (allBookings.size === 1) {
        await sendNotification(
          businessId,
          ` Welcome ${currentBusinessName}! ! You've just created your first booking for ${bookingData.client.name}. This platform is designed to help you track rentals and payments effortlessly. Explore your dashboard to see your new stats!`,
          "Tracknrent",
          "welcome_message",
          bookingRef.id
        );
      }

      /* Nothing to deduct — availability for any date window is computed
         live from active bookings (see availabilityService.js). */

      clearDraft();
      window.location.href = "bookings.html";
    } catch (error) {
      console.error("Error saving booking:", error);
      alert("Failed to save booking. Please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });


function updateSelectOptions() {
  const selectedItems = Array.from(document.querySelectorAll(".item-name"))
    .map(s => s.value)
    .filter(v => v && v !== "__custom__"); // "not in inventory" can be picked in more than one row

  document.querySelectorAll(".item-name").forEach(select => {
    Array.from(select.options).forEach(option => {
      if (!option.value || option.value === "__custom__") return; // keep placeholder + custom option always enabled
      // disable option if selected elsewhere
      option.disabled = selectedItems.includes(option.value) && select.value !== option.value;
    });
  });
}

window.shareToWhatsApp = function() {
  const phone = document.getElementById("clientPhone")?.value;
  const message = document.getElementById("liveReceiptText")?.innerText;

  if (!phone || phone.length < 5) {
    alert("Please enter a valid Client Phone number first!");
    return;
  }

  // Format phone for WhatsApp (removes spaces/dashes)
  const cleanPhone = phone.replace(/\D/g, '');
  const encodedMsg = encodeURIComponent(message);

  window.open(`https://wa.me/${cleanPhone}?text=${encodedMsg}`, '_blank');
};
// // ===== DYNAMIC BUY ME A COFFEE BUTTON WITH FLOATING ANIMATION =====
// (function() {
//   const bmcLink = "https://www.buymeacoffee.com/francisfortune"; // your profile link

//   // Create Buy Me a Coffee button
//   const coffeeBtn = document.createElement("button");
//   coffeeBtn.id = "buyCoffeeBtn";
//   coffeeBtn.innerHTML = "☕ Support Me";
//   coffeeBtn.style.position = "fixed";
//   coffeeBtn.style.bottom = "80px"; // leave space for bottom nav
//   coffeeBtn.style.right = "20px";
//   coffeeBtn.style.background = "Purple";
//   coffeeBtn.style.color = "#ffffff";
//   coffeeBtn.style.padding = "0.7rem 1.5rem";
//   coffeeBtn.style.fontWeight = "700";
//   coffeeBtn.style.borderRadius = "50px";
//   coffeeBtn.style.border = "none";
//   coffeeBtn.style.cursor = "pointer";
//   coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
//   coffeeBtn.style.zIndex = "9999";
//   coffeeBtn.style.display = "flex";
//   coffeeBtn.style.alignItems = "center";
//   coffeeBtn.style.justifyContent = "center";
//   coffeeBtn.style.transition = "transform 0.3s, box-shadow 0.3s";
//   coffeeBtn.style.fontSize = "1.3rem";

//   // Hover effect
//   coffeeBtn.onmouseover = () => {
//     coffeeBtn.style.transform = "translateY(-6px)";
//     coffeeBtn.style.boxShadow = "0 12px 24px rgba(0,0,0,0.35)";
//   };
//   coffeeBtn.onmouseout = () => {
//     coffeeBtn.style.transform = "translateY(0)";
//     coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
//   };

//   // Floating animation CSS
//   const style = document.createElement("style");
//   style.innerHTML = `
//     @keyframes floatButton {
//       0% { transform: translateY(0px); }
//       50% { transform: translateY(-8px); }
//       100% { transform: translateY(0px); }
//     }
//     #buyCoffeeBtn {
//       animation: floatButton 3s ease-in-out infinite;
//     }
//     /* Optional: Product Hunt button styles if used */
//     #productHuntBtn {
//       animation: floatButton 3s ease-in-out infinite;
//       background: linear-gradient(135deg, #DA552F, #FF6F4C);
//       color: #fff;
//       font-weight: 700;
//       border-radius: 50px;
//       border: none;
//       cursor: pointer;
//       box-shadow: 0 8px 16px rgba(0,0,0,0.3);
//       padding: 0.7rem 1.5rem;
//       display: flex;
//       align-items: center;
//       justify-content: center;
//       transition: transform 0.3s, box-shadow 0.3s;
//       z-index: 9999;
//       position: fixed;
//       bottom: 20px; /* will adjust dynamically */
//       right: 20px;
//     }
//     #productHuntBtn:hover {
//       transform: translateY(-6px);
//       box-shadow: 0 12px 24px rgba(0,0,0,0.35);
//     }
//   `;
//   document.head.appendChild(style);

//   // Responsive function
//   function updateBtnSize() {
//     const bottomMargin = 20; // default bottom spacing
//     if (window.innerWidth < 768) {
//       coffeeBtn.style.padding = "0.5rem 1.3rem";
//       coffeeBtn.style.fontSize = "1.4rem";
//       coffeeBtn.style.bottom = "130px"; // extra space for bottom nav
//       coffeeBtn.style.right = "15px";
//       // If Product Hunt button is used
//       const phBtn = document.getElementById("productHuntBtn");
//       if (phBtn) phBtn.style.bottom = "40px"; // below coffee button
//     } else {
//       coffeeBtn.style.padding = "0.7rem 1.5rem";
//       coffeeBtn.style.fontSize = "1rem";
//       coffeeBtn.style.bottom = "80px";
//       coffeeBtn.style.right = "20px";
//       const phBtn = document.getElementById("productHuntBtn");
//       if (phBtn) phBtn.style.bottom = "20px";
//     }
//   }
//   window.addEventListener("resize", updateBtnSize);
//   updateBtnSize();

//   // Append Buy Me a Coffee button
//   document.body.appendChild(coffeeBtn);

//   // Popup portal
//   coffeeBtn.addEventListener("click", () => {
//     const popupWidth = 500;
//     const popupHeight = 700;
//     const left = (window.innerWidth / 2) - (popupWidth / 2);
//     const top = (window.innerHeight / 2) - (popupHeight / 2);

//     window.open(
//       bmcLink,
//       "BuyMeACoffee",
//       `width=${popupWidth},height=${popupHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`
//     );
//   });

//   // Tooltip/Bio
//   coffeeBtn.title = `
// Hi! I'm Francis Fortune.
// I’m passionate about motivating young teens to explore technology, learn new skills, and create innovative solutions.
// .
// `;

  // ===== PRODUCT HUNT BUTTON (COMMENTED OUT FOR NOW) =====
  /*
  const phLink = "https://www.producthunt.com/posts/your-product";
  const phBtn = document.createElement("button");
  phBtn.id = "productHuntBtn";
  phBtn.innerHTML = "🚀 Product Hunt";
  phBtn.onclick = () => window.open(phLink, "_blank");
  document.body.appendChild(phBtn);
  updateBtnSize();
  */
// })();




