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
import { deductInventory, restoreInventory } from "./services/inventoryService.js";
import { generateReceiptImage } from "./pdf.js";

import { runAutomatedChecks } from "./services/reminderService.js";

let currentRole = "viewer";
let currentBusinessName = "";
let publicProfileSettings = { enabled: false, slug: "" }; // Store storefront status

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
   RECEIPT TEXT GENERATOR
========================= */
function generateReceiptText(booking) {
  const total = booking.payment?.total || 0;
  const paid = booking.payment?.paid || 0;
  const balance = total - paid;

  let itemsSummary = booking.items?.map(i =>
    `• ${i.name} (x${i.qty})\n${i.summary ? `   - ${i.summary}` : ""} - ₦${(i.total || 0).toLocaleString()}`
  ).join("\n") || "No items";

  const deliveryDate = booking.event?.deliveryDate || booking.event?.date || "Not set";
  const returnDate  = booking.event?.returnDate || "Not set";

  // Build the core receipt body
  let receiptText = `*${currentBusinessName} Booking Receipt*\n\n` +
    `Hi ${booking.client.name}, your booking details are below:\n\n` +
    `Event Date: ${formatDateTime(booking.event.date)}\n` +
    `Delivery Date: ${formatDateTime(deliveryDate)}\n` +
    `Return Date: ${formatDateTime(returnDate)}\n` +
    `Location: ${booking.event.location || "Not specified"}\n\n` +
    `Items Ordered:\n${itemsSummary}\n\n` +
    `Total: ₦${total.toLocaleString()}\n` +
    `Paid: ₦${paid.toLocaleString()}\n` +
    `Balance: ₦${balance.toLocaleString()}\n\n` +
    `Thank you for choosing ${currentBusinessName}!\n\n` +
    `---`;

  // Conditionally append store URL only if "Go Online" toggle is enabled AND a valid slug exists
  if (publicProfileSettings.enabled && publicProfileSettings.slug) {
    const storeUrl = `${window.location.origin}/p/${publicProfileSettings.slug}`;
    receiptText += `\n🌐 _View our store catalog: ${storeUrl}_`;
  }

  // App Footer
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
  if (booking.status === "returned") return "returned";
  const returnDate = booking.event?.returnDate;
  if (!returnDate) return "active";
  const now = new Date();
  const returnTime = new Date(returnDate);
  return now > returnTime ? "overdue" : "active";
}

let inventoryItems = [];
let allBookingsGlobal = [];

async function loadInventory(businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "inventory"));
  inventoryItems = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
window.returnBooking = async function(bookingId, businessId, items) {
  if (!items || items.length === 0) { alert("No items found in booking"); return; }

  const btn = document.activeElement;
  if (btn) disableButton(btn);

  const hasBorrowedItems = items.some(i => (i.shortage || 0) > 0);
  if (hasBorrowedItems) {
    if (!confirm("This booking was overbooked.\nHave you returned borrowed items to the vendor?")) return;
  }
  if (!confirm("Mark this booking as returned?")) return;

  const loader = document.createElement("div");
  loader.id = "returnLoader";
  loader.style = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.85);backdrop-filter:blur(8px);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;font-family:sans-serif;`;
  loader.innerHTML = `<div style="width:50px;height:50px;border:5px solid #f3f3f3;border-top:5px solid purple;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:20px;"></div><h3 style="color:purple;font-weight:800;">MARKING RETURN...</h3><p style="color:purple;font-size:0.8rem;margin-top:5px;">Syncing inventory, please wait.</p><style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style>`;
  document.body.appendChild(loader);

  try {
    const bookingRef = doc(db, "businesses", businessId, "bookings", bookingId);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) { document.body.removeChild(loader); alert("Booking not found"); return; }

    const booking = snap.data();
    await restoreInventory(businessId, items);
    await updateDoc(bookingRef, { status: "returned" });

    document.body.removeChild(loader);
    closeModal();
    alert("Booking marked as returned successfully! ✅");

    await sendNotification(
      businessId,
      `${booking.client.name}'s items have been returned successfully ✅`,
      auth.currentUser.email,
      "booking_returned",
      bookingId
    );
  } catch (error) {
    if (document.getElementById("returnLoader")) document.body.removeChild(loader);
    console.error("Return failed:", error);
    alert("An error occurred during return. Please check your connection and try again.");
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
      const confirmDelete = confirm("⚠️ This booking has NOT been marked as returned.\n\nDeleting it will restore items back into inventory.\n\nDo you want to proceed?");
      if (!confirmDelete) return;
      await restoreInventory(businessId, booking.items || []);
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
   URL HIGHLIGHT / STATUS PRE-FILTER
========================= */
const urlParams = new URLSearchParams(window.location.search);
const highlightId = urlParams.get("highlight");
const presetStatus = urlParams.get("status");

// Pre-select status filter from URL param (dashboard card links)
if (presetStatus) {
  const filterEl = document.getElementById("filterStatus");
  if (filterEl) filterEl.value = presetStatus;
}

function getInventoryMap() {
  const map = {};
  inventoryItems.forEach(i => { map[i.name.toLowerCase()] = i; });
  return map;
}

/* ========================================================
   REAL-TIME CALCULATION ENGINE FOR EDIT WORKSPACE
======================================================== */
function recalculateEditWorkspace() {
  const rows = document.querySelectorAll("#editItemsContainer .item-row");
  let calculatedGrandTotal = 0;
  let workspaceOverbooked = false;

  rows.forEach(row => {
    const select = row.querySelector(".item-name");
    const qtyInput = row.querySelector(".item-qty");
    const priceInput = row.querySelector(".item-price");

    const selectedOption = select?.selectedOptions[0];
    const availableStock = selectedOption ? Number(selectedOption.dataset.stock || 0) : 0;
    const qty = Number(qtyInput?.value || 0);
    const price = Number(priceInput?.value || 0);
    const rowTotal = qty * price;
    calculatedGrandTotal += rowTotal;

    if (qty > availableStock && select?.value !== "") {
      workspaceOverbooked = true;
      row.classList.add("border-l-4", "border-red-500", "bg-red-50");
    } else {
      row.classList.remove("border-l-4", "border-red-500", "bg-red-50");
    }
  });

  const totalInput = document.getElementById("editTotal");
  if (totalInput) totalInput.value = calculatedGrandTotal;

  const warningBadge = document.getElementById("editOverbookWarning");
  if (warningBadge) warningBadge.style.display = workspaceOverbooked ? "inline-block" : "none";
}

function attachRowCalculationListeners(row) {
  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");

  select?.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt && priceInput) priceInput.value = opt.dataset.price || 0;
    recalculateEditWorkspace();
  });
  qtyInput?.addEventListener("input", recalculateEditWorkspace);
  priceInput?.addEventListener("input", recalculateEditWorkspace);
}

/* =========================
   OPEN BOOKING MODAL
========================= */
window.openBooking = function(booking, id, businessId) {
  const status = getCalculatedStatus(booking);
  const isOverbooked = booking.items?.some(i => (i.shortage || 0) > 0);
  const totalAmount = booking.payment?.total || 0;
  const amountPaid = booking.payment?.paid || 0;
  const balanceRemaining = totalAmount - amountPaid;

  const borrowedItems = booking.items?.filter(i => (i.shortage > 0 || i.supplier) && i.supplier !== "")?.map(i =>
    `• ${i.name} ${i.shortage > 0 ? `(Borrowed: ${i.shortage})` : ''} from ${i.supplier}`
  ) || [];

  const vendorBlock = borrowedItems.length
    ? `<div class="bg-purple-50 border border-purple-200 rounded-xl p-4"><p class="text-xs font-bold text-purple-700 uppercase">Vendor / Borrowed Items</p><p class="text-sm text-gray-700 mt-1">${borrowedItems.join("<br>")}</p></div>`
    : "";

  const receiptText = generateReceiptText(booking);

  const statusColors = { returned: "from-green-600 to-green-800", active: "from-purple-700 to-purple-900", overdue: "from-red-600 to-red-800" };
  const badgeColors  = { returned: "bg-green-400 text-green-900", active: "bg-purple-400 text-purple-900", overdue: "bg-red-400 text-red-900" };

  modalContent.innerHTML = `
<div class="space-y-6 animate__animated animate__fadeIn w-full max-w-5xl mx-auto px-3 sm:px-4">
  <div class="relative overflow-hidden bg-gradient-to-r ${statusColors[status]} p-4 sm:p-6 rounded-2xl text-white shadow-xl">
    <div class="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div class="min-w-0 flex-1">
        <p class="text-[10px] sm:text-xs uppercase tracking-widest opacity-80">Client Profile</p>
        <h3 class="text-lg sm:text-2xl font-black break-words leading-tight">${booking.client.name}</h3>
        <p class="text-xs sm:text-sm opacity-90 italic break-all">${booking.client.email || "No Email"}</p>
        <p class="text-xs sm:text-sm opacity-90 italic flex items-center gap-2">
          <span class="material-symbols-outlined text-sm">call</span>
          <a href="tel:+${booking.client.phone}" class="break-all">${booking.client.phone}</a>
        </p>
        ${isOverbooked ? `<div class="mt-2 bg-purple-500 text-[10px] font-black px-2 py-1 rounded shadow-sm inline-block uppercase">⚠️ Overbooked: Vendor Stock Used</div>` : ''}
      </div>
      <div class="w-full sm:w-auto text-left sm:text-right">
        <span class="px-4 py-2 rounded-full text-xs font-black uppercase shadow-lg inline-block ${badgeColors[status]}">${status}</span>
      </div>
    </div>
  </div>

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
          <p class="font-black text-gray-800 text-sm sm:text-base break-all">${booking.event.date || "Not set"}</p>
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
            <p class="font-bold text-gray-800">${i.name}${i.shortage > 0 ? `<span class="text-red-500 text-[10px] ml-1">(Shortage: ${i.shortage})</span>` : ''}</p>
            <p class="text-[10px] text-purple-600 font-bold">Qty: ${i.qty} @ ₦${(i.price || 0).toLocaleString()}</p>
          </div>
          <span class="font-black text-gray-700">₦${(i.total || 0).toLocaleString()}</span>
        </div>
      `).join("")}
    </div>
  </div>

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

  

${booking.receiptImage ? `
  <div class="mt-4">
    <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
      <p class="text-[10px] font-black text-purple-700 uppercase flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">receipt_long</span> Receipt Image
      </p>
      <span class="text-[10px] bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-bold">Uploaded</span>
    </div>
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      <img src="${booking.receiptImage}" 
           alt="Receipt Image" 
           class="w-full max-h-64 object-contain"
           onerror="this.parentElement.innerHTML='<div class=\\'p-4 text-center text-gray-400 text-sm\\'>Image failed to load</div>'">
    </div>
  </div>
` : `
  <div class="mt-4">
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <p class="text-[10px] font-black text-gray-400 uppercase flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">receipt_long</span> Receipt Image
      </p>
      <span class="text-[10px] bg-gray-100 text-gray-400 px-2 py-1 rounded-full font-bold">Not uploaded</span>
    </div>
    <div class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
      <span class="material-symbols-outlined text-4xl text-gray-300">image</span>
      <p class="text-xs text-gray-400 mt-2">No receipt image available</p>
    </div>
  </div>
`}

  ${booking.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4"><p class="text-xs font-bold text-yellow-700 uppercase">Notes</p><p class="text-sm text-gray-700 mt-1 break-words">${booking.notes}</p></div>` : ""}

  <div class="mt-6">
    <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
      <p class="text-[10px] font-black text-purple-700 uppercase">Live Receipt Preview</p>
      <span class="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold">WhatsApp Ready</span>
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
      <div class="p-4 bg-green-50 text-green-700 text-center font-bold rounded-xl border border-green-200">✓ Items Successfully Returned</div>
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
              ${inventoryItems.map(inv => `<option value="${inv.name}" data-price="${inv.price}" data-stock="${inv.availableQuantity}" ${inv.name.toLowerCase() === item.name.toLowerCase() ? "selected" : ""}>${inv.name} (Stock: ${inv.availableQuantity})</option>`).join("")}
            </select>
          </div>
          <div style="width:70px;"><input class="item-qty" type="number" placeholder="Qty" value="${item.qty || 0}" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
          <div style="width:90px;"><input class="item-price" type="number" placeholder="₦" value="${item.price || 0}" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
          <div style="flex:1;min-width:80px;"><input class="item-supplier" type="text" value="${item.supplier || ""}" placeholder="Vendor" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
          <button type="button" onclick="this.parentElement.remove(); recalculateEditWorkspace();" style="width:30px;height:30px;border:0.5px solid #fca5a5;border-radius:6px;background:#fef2f2;color:#b91c1c;cursor:pointer;font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
      `).join("")}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div style="background:#f5f0ff;border-radius:12px;border:0.5px solid #d8b4fe;padding:1rem 1.25rem;">
      <label style="font-size:12px;color:purple;display:block;margin-bottom:6px;font-weight:600;">Total valuation (₦)</label>
      <input id="editTotal" type="number" value="${booking.payment?.total || 0}" readonly style="width:100%;padding:4px 0;font-size:20px;font-weight:500;border:none;background:transparent;color:purple;outline:none;cursor:not-allowed;box-sizing:border-box;">
    </div>
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;">
      <label style="font-size:12px;color:#9ca3af;display:block;margin-bottom:6px;">Amount paid (₦)</label>
      <input id="editPaid" type="number" value="${booking.payment?.paid || 0}" style="width:100%;padding:4px 0;font-size:20px;font-weight:500;border:none;background:transparent;color:#374151;outline:none;box-sizing:border-box;">
    </div>
  </div>


<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;border-top:1px solid #e5e5e5;padding-top:12px;">
  <label style="font-size:12px;color:purple;font-weight:600;">Receipt Image</label>
  ${booking.receiptImage ? `
    <div style="position:relative;display:inline-block;">
      <img src="${booking.receiptImage}" 
           alt="Receipt" 
           style="max-height:120px;max-width:100%;border-radius:8px;border:1px solid #e5e5e5;object-fit:contain;">
      <button type="button" onclick="document.getElementById('editReceiptInput').click()" 
              style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.7);color:white;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">
        Change
      </button>
    </div>
  ` : `
    <div style="background:#f9fafb;border:2px dashed #d8b4fe;border-radius:8px;padding:20px;text-align:center;cursor:pointer;"
         onclick="document.getElementById('editReceiptInput').click()">
      <span style="font-size:2rem;color:purple;">📸</span>
      <p style="font-size:12px;color:#6b7280;margin:4px 0 0;">Tap to upload receipt image</p>
    </div>
  `}
  <input type="file" id="editReceiptInput" accept="image/*" style="display:none;">
  <p id="editReceiptStatus" style="font-size:11px;color:#059669;margin-top:4px;display:none;">Image uploaded ✅</p>
</div>

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

  document.querySelectorAll("#editItemsContainer .item-row").forEach(attachRowCalculationListeners);
  recalculateEditWorkspace();

  // Add receipt image upload handler for edit modal
const editReceiptInput = document.getElementById('editReceiptInput');
if (editReceiptInput) {
  editReceiptInput.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const statusEl = document.getElementById('editReceiptStatus');
    statusEl.textContent = 'Uploading...';
    statusEl.style.display = 'block';
    statusEl.style.color = '#6b7280';
    
    try {
      const imageUrl = await uploadReceiptImage(businessId, file);
      // Store the new image URL to be saved with the booking
      window._editReceiptImageUrl = imageUrl;
      statusEl.textContent = '✅ Image uploaded!';
      statusEl.style.color = '#059669';
      
      // Update preview
      const container = this.parentElement;
      const preview = container.querySelector('img') || container.querySelector('div[style*="dashed"]');
      if (preview) {
        if (preview.tagName === 'IMG') {
          preview.src = imageUrl;
        } else {
          preview.outerHTML = `<img src="${imageUrl}" alt="Receipt" style="max-height:120px;max-width:100%;border-radius:8px;border:1px solid #e5e5e5;object-fit:contain;">`;
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
      statusEl.textContent = '❌ Upload failed';
      statusEl.style.color = '#dc2626';
    }
  });
}

};

function formatDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return date.toLocaleString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
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
        </select>
      </div>
      <div style="width:70px;"><input class="item-qty" type="number" value="1" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
      <div style="width:90px;"><input class="item-price" type="number" value="0" style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
      <div style="flex:1;min-width:80px;"><input class="item-supplier" type="text" placeholder="Vendor" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;"></div>
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
      const select = row.querySelector(".item-name");
      const qtyInput = row.querySelector(".item-qty");
      const priceInput = row.querySelector(".item-price");
      const supplierInput = row.querySelector(".item-supplier");

      const name = select?.value?.trim();
      const qty = Number(qtyInput?.value || 0);
      const price = Number(priceInput?.value || 0);
      const supplier = supplierInput?.value?.trim() || "";

      if (!name || qty <= 0) { hasError = true; return; }
      updatedItems.push({ name, qty, price, total: qty * price, supplier, shortage: 0 });
    });

    if (hasError || updatedItems.length === 0) {
      alert("Please fill all items correctly.");
      if (saveBtn) enableButton(saveBtn);
      return;
    }

    // ✅ Get receipt image URL from edit modal (if uploaded)
    const receiptImageUrl = window._editReceiptImageUrl || null;
    if (receiptImageUrl) {
      // Clear the temporary stored URL
      window._editReceiptImageUrl = null;
    }

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
      notes: document.getElementById("editNotes").value.trim()
    };

    // ✅ Add receipt image if uploaded
    if (receiptImageUrl) {
      updatedBookingData.receiptImage = receiptImageUrl;
    }

    await editBookingTransaction(businessId, id, updatedBookingData, originalItems, updatedItems);
    alert("Booking updated successfully! ✅");
    closeModal();

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

function recalculateEditTotal() {
  let total = 0;
  document.querySelectorAll("#editItemsContainer .item-row").forEach(row => {
    const qty = Number(row.querySelector(".item-qty")?.value || 0);
    const price = Number(row.querySelector(".item-price")?.value || 0);
    total += qty * price;
  });
  document.getElementById("editTotal").value = total;
}

/* =========================
   RENDER ROW (TABLE)
========================= */
function renderRow(b, id, businessId) {
  const status = getCalculatedStatus(b);
  const isOverbooked = b.items?.some(i => (i.shortage || 0) > 0);

  const colors = {
    active: "bg-blue-100 text-blue-700",
    returned: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-700"
  };

  return `
    <tr class="hover:bg-gray-50 transition-colors border-b border-gray-100">
      <td class="p-4 font-medium text-gray-800 cursor-pointer" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)">${b.client.name}</td>
      <td class="p-4 text-gray-600 text-sm cursor-pointer" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)">${formatDateTime(b.event.deliveryDate || b.event.date)}</td>
      <td class="p-4 cursor-pointer" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)">
        <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${colors[status]}">${status}</span>
        ${isOverbooked ? `<span class="ml-2 px-2 py-1 rounded-full text-[9px] font-black uppercase bg-orange-100 text-orange-600">Overbooked</span>` : ""}
      </td>
      <td class="p-4">
        <button type="button" data-id="${id}" data-business="${businessId}" onclick="handleViewClick(this)"
          class="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl font-bold text-sm shadow-md transition-all duration-200">View</button>
      </td>
    </tr>`;
}

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
      await sendNotification(businessId, `⚠️ Booking for ${booking.client.name} is OVERDUE`, auth.currentUser?.email, "booking_overdue", id);
      updates.overdueNotified = true;
    }
    if (calculated === "returned" && !booking.returnNotified) {
      await sendNotification(businessId, `✅ Booking for ${booking.client.name} has been RETURNED`, auth.currentUser?.email, "booking_returned", id);
      updates.returnNotified = true;
    }
  }
  if (isOverbooked && !booking.overbookedNotified) {
    await sendNotification(businessId, `⚠️ Booking for ${booking.client.name} is OVERBOOKED (vendor stock used)`, auth.currentUser?.email, "booking_overbooked", id);
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
   NOTIFICATION HELPER — saves to Firestore AND fires OneSignal push
========================= */
async function sendNotification(businessId, message, userEmail, type, bookingId = "") {
    try {
        // 1. Save in-app notification to Firestore (always works)
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

        // 2. Fire OneSignal push notification (optional, non-blocking)
        const deepLink = bookingId
            ? `/bookings.html?highlight=${bookingId}`
            : `/dashboard.html`;
        
        // ✅ Use the imported sendPush or fallback to window.sendPush
        try {
            if (typeof sendPush === 'function') {
                await sendPush(message, deepLink);
            } else if (window.sendPush) {
                await window.sendPush(message, deepLink);
            } else {
                // Try dynamic import
                const { sendPush: importedSendPush } = await import('./onesignal.js');
                await importedSendPush(message, deepLink);
            }
        } catch (pushError) {
            console.warn('[Notification] Push failed but in-app saved:', pushError.message);
            // ✅ Don't throw - push failure shouldn't break the UI
        }

        console.log("✅ Notification saved:", message);
    } catch (err) {
        console.error("[Notification] Error:", err);
        // ✅ Don't throw - notification failure shouldn't break the UI
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

    // Load inventory first so edit modal works immediately
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
        const search  = (document.getElementById("searchInput")?.value || "").toLowerCase();

        if (!tbody) return;
        tbody.innerHTML = "";

        const filtered = allBookingsGlobal.filter(({ data }) => {
          const currentStatus = getCalculatedStatus(data);
          const isOverbooked = data.items?.some(i => {
            const s = Number(i.shortage);
            return !isNaN(s) && s > 0;
          }) || false;

          let matchesStatus = !sFilter || (sFilter === "overbooked" ? isOverbooked : currentStatus === sFilter);
          const matchesDate   = !dFilter || data.event?.date === dFilter;
          const matchesSearch = !search || data.client?.name?.toLowerCase().includes(search);

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

      // Wire up filter controls
      const sF = document.getElementById("filterStatus");
      const dF = document.getElementById("filterDate");
      const sI = document.getElementById("searchInput");
      if (sF) sF.onchange = filterAndRender;
      if (dF) dF.onchange = filterAndRender;
      if (sI) sI.oninput = filterAndRender;

      filterAndRender();

      // Handle highlight from URL after data loads
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

