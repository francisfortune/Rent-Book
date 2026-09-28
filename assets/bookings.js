import { auth, db } from "./firebase.js";
import { sendPush } from "./onesignal.js";

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
import { deductInventory, restoreInventory } from "./services/inventoryService.js";
import { generateReceiptImage } from "./pdf.js";
import { runAutomatedChecks } from "./services/reminderService.js";

let currentRole = "viewer";
let currentBusinessName = ""; // Global role tracker


/* =========================
   RECEIPT TEXT GENERATOR
========================= */
function generateReceiptText(booking) {
  const total = booking.payment?.total || 0;
  const paid = booking.payment?.paid || 0;
  const balance = total - paid;

  let itemsSummary = booking.items?.map(i =>
    `• ${i.name} (x${i.qty})
${i.summary ? `   - ${i.summary}` : ""} - ₦${(i.total || 0).toLocaleString()}`
  ).join("\n") || "No items";

  const deliveryDate =
    booking.event?.deliveryDate || booking.event?.date || "Not set";

  const returnDate =
    booking.event?.returnDate || "Not set";

  return `*BOOKING RECEIPT*\n\n` +
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
    `---\n` +
    `_Powered by Tracknrent_\n` +
    `👉 https://tracknrent.vercel.app`;
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/\D/g, "");

  // Remove leading zero → convert to Nigeria international format
  if (cleaned.startsWith("0")) {
    cleaned = "234" + cleaned.slice(1);
  }

  // If already correct, leave it
  if (!cleaned.startsWith("234") && cleaned.length === 10) {
    cleaned = "234" + cleaned;
  }

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

  inventoryItems = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  console.log("Inventory loaded:", inventoryItems);
}

/* =========================
   BUSINESS LOOKUP
========================= */
async function getBusinessIdByEmail(email) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user");
  const cacheKey = `businessId_${user.uid}`;
  const cached = localStorage.getItem(cacheKey);
  const cachedRole = localStorage.getItem(`cachedMemberRole_${user.uid}`);
  const cachedName = localStorage.getItem(`cachedBusinessName_${user.uid}`);

  if (cached && cachedRole && cachedName) {
    currentRole = cachedRole;
    currentBusinessName = cachedName;
    return cached;
  }

  let data = null;
  if (user.email) {
    const emailLower = user.email.toLowerCase().trim();
    const q = query(collection(db, "businessMembers"), where("email", "==", emailLower));
    let snap = await getDocs(q);
    if (snap.empty && user.email.trim() !== emailLower) {
      const qRaw = query(collection(db, "businessMembers"), where("email", "==", user.email.trim()));
      snap = await getDocs(qRaw);
    }
    if (!snap.empty) data = snap.docs[0].data();
  }
  if (!data && user.phoneNumber) {
    const q = query(collection(db, "businessMembers"), where("phone", "==", user.phoneNumber.trim()));
    const snap = await getDocs(q);
    if (!snap.empty) data = snap.docs[0].data();
  }

  if (!data) {
    if (!navigator.onLine) {
      if (cached) {
        currentRole = cachedRole || "viewer";
        currentBusinessName = cachedName || "Tracknrent";
        return cached;
      }
      throw new Error("OFFLINE_NO_CACHE");
    }
    throw new Error("No business");
  }

  currentRole = data.role;
  localStorage.setItem(`cachedMemberRole_${user.uid}`, data.role);

  const businessRef = doc(db, "businesses", data.businessId);
  const businessSnap = await getDoc(businessRef);

  if (businessSnap.exists()) {
    currentBusinessName = businessSnap.data().name;
    localStorage.setItem(`cachedBusinessName_${user.uid}`, currentBusinessName);
    console.log("Business Name Loaded:", currentBusinessName);
  }

  localStorage.setItem(cacheKey, data.businessId);
  return data.businessId;
}




/* =========================
   EXPORT BOOKINGS
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
      head: [[
        "#",
        "Client",
        "Phone",
        "Event",
        "Date",
        "Total",
        "Paid",
        "Status"
      ]],
      body: rows,
      styles: {
        fontSize: 9
      },
      headStyles: {
        fillColor: [128, 0, 128]
      }
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

  if (!items || items.length === 0) {
  alert("No items found in booking");
  return;
}


const btn = document.activeElement;
if(btn) disableButton(btn);

  // 1. Initial Checks
  const hasBorrowedItems = items.some(i => (i.shortage || 0) > 0);
  
  if (hasBorrowedItems) {
    if (!confirm("This booking was overbooked.\nHave you returned borrowed items to the vendor?")) return;
  }
  
  if (!confirm("Mark this booking as returned?")) return;

  // 2. Show Loader (Visual feedback is important for inventory sync)
  const loader = document.createElement("div");
  loader.id = "returnLoader";
  loader.style = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(8px);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 10000; font-family: sans-serif;
  `;
  loader.innerHTML = `
    <div class="spinner" style="
      width: 50px; height: 50px; border: 5px solid #f3f3f3; 
      border-top: 5px solid purple; border-radius: 50%; 
      animation: spin 1s linear infinite; margin-bottom: 20px;">
    </div>
    <h3 style="color: purple; font-weight: 800; margin: 0;">MARKING RETURN...</h3>
    <p style="color: purple; font-size: 0.8rem; margin-top: 5px;">Syncing inventory, please wait.</p>
    <style>
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;
  document.body.appendChild(loader);

  try {
    const bookingRef = doc(db, "businesses", businessId, "bookings", bookingId);
    const snap = await getDoc(bookingRef);

    if (!snap.exists()) {
      if (document.getElementById("returnLoader")) document.body.removeChild(loader);
      alert("Booking not found");
      return;
    }

    const booking = snap.data();

    // 3. Update Status in Database
    
    // 4. Restore physical items to inventory
   await restoreInventory(businessId, items);
await updateDoc(bookingRef, { status: "returned" });

    // 5. Success UI Cleanup
    if (document.getElementById("returnLoader")) document.body.removeChild(loader);
    closeModal();
    alert("Booking marked as returned successfully! ✅");

    // 6. Send Notification (Triggered after UI is clear)
    await sendNotification(
  businessId,
  `${booking.client.name}’s items have been returned successfully ✅`,
  auth.currentUser.email,
  "booking_returned",
  bookingId
);
    
  } catch (error) {
    // Error Cleanup
    if (document.getElementById("returnLoader")) document.body.removeChild(loader);
    console.error("Return failed:", error);
    alert("An error occurred during return. Please check your connection and try again.");
  }
};
/* =========================
   DELETE BOOKING (OWNER ONLY)
========================= */
window.deleteBooking = async function (bookingId, businessId) {
  const btn = event?.target;
  if(btn) disableButton(btn);

  if (currentRole !== "owner") {
    return alert("Permission Denied: Only Owners can delete.");
  }

  try {
    const bookingRef = doc(db, "businesses", businessId, "bookings", bookingId);
    const snap = await getDoc(bookingRef);

    if (!snap.exists()) {
      return alert("Booking not found.");
    }

    const booking = snap.data();

    // 🔥 WARNING if not returned
    if (booking.status !== "returned") {
      const confirmDelete = confirm(
        "⚠️ This booking has NOT been marked as returned.\n\n" +
        "Deleting it will restore items back into inventory.\n\n" +
        "Do you want to proceed?"
      );
      if (!confirmDelete) return;

      // ✅ Restore inventory FIRST
      await restoreInventory(businessId, booking.items || []);
    } else {
      // Normal confirmation
      if (!confirm(`Delete ${booking.client.name} booking permanently?`)) return;
    }

    // ✅ Delete booking
    await deleteDoc(bookingRef);

    await sendNotification(
  businessId,
  `${booking.client.name}’s booking has been deleted`,
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
const params = new URLSearchParams(window.location.search);
const highlightId = params.get("highlight");

if (highlightId) {
  console.log("Highlight booking:", highlightId);

  (async () => {
    try {
      // get businessId first (IMPORTANT: reuse your existing logic if needed)
      const user = auth.currentUser;
      if (!user) return;

      const businessId = await getBusinessIdByEmail(user.email);

      const bookingRef = doc(db, "businesses", businessId, "bookings", highlightId);
      const snap = await getDoc(bookingRef);

      if (!snap.exists()) {
        console.warn("Highlighted booking not found");
        return;
      }

      const booking = snap.data();

      // OPEN MODAL
      openBooking(booking, highlightId, businessId);

    } catch (err) {
      console.error("Highlight open error:", err);
    }
  })();
}




function getInventoryMap() {
  const map = {};
  inventoryItems.forEach(i => {
    map[i.name.toLowerCase()] = i;
  });
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

    // Real-time visual danger indicator for overbooking
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
  if (warningBadge) {
    warningBadge.style.display = workspaceOverbooked ? "inline-block" : "none";
  }
}

function attachRowCalculationListeners(row) {
  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");

  select?.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt && priceInput) {
      priceInput.value = opt.dataset.price || 0;
    }
    recalculateEditWorkspace();
  });

  qtyInput?.addEventListener("input", recalculateEditWorkspace);
  priceInput?.addEventListener("input", recalculateEditWorkspace);
}




/* =========================
   OPEN BOOKING MODAL
========================= */
window.openBooking = function (booking, id, businessId) {
  const status = getCalculatedStatus(booking);
  const isOverbooked = booking.items?.some(i => (i.shortage || 0) > 0);
  const totalAmount = booking.payment?.total || 0;
  const amountPaid = booking.payment?.paid || 0;
  const balanceRemaining = totalAmount - amountPaid;

  // Get all borrowed items with suppliers
// Inside window.openBooking...
const borrowedItems = booking.items?.filter(i => (i.shortage > 0 || i.supplier) && i.supplier !== "")?.map(i => {
  return `• ${i.name} ${i.shortage > 0 ? `(Borrowed: ${i.shortage})` : ''} from ${i.supplier}`;
}) || [];

const vendorBlock = borrowedItems.length
  ? `<div class="bg-purple-50 border border-purple-200 rounded-xl p-4">
       <p class="text-xs font-bold text-purple-700 uppercase">Vendor / Borrowed Items</p>
       <p class="text-sm text-gray-700 mt-1">${borrowedItems.join("<br>")}</p>
     </div>`
  : "";
  const receiptText = generateReceiptText(booking);
  
const statusColors = {
  returned: "from-green-600 to-green-800",
  active: "from-purple-700 to-purple-900",
  overdue: "from-red-600 to-red-800"
};

const badgeColors = {
  returned: "bg-green-400 text-green-900",
  active: "bg-purple-400 text-purple-900",
  overdue: "bg-red-400 text-red-900"
};

modalContent.innerHTML = `
<div class="space-y-6 animate__animated animate__fadeIn w-full max-w-5xl mx-auto px-3 sm:px-4">

  <!-- HEADER -->
  <div class="relative overflow-hidden bg-gradient-to-r ${statusColors[status]} p-4 sm:p-6 rounded-2xl text-white shadow-xl">

    <div class="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">

      <!-- CLIENT INFO -->
      <div class="min-w-0 flex-1">
        <p class="text-[10px] sm:text-xs uppercase tracking-widest opacity-80">Client Profile</p>

        <h3 class="text-lg sm:text-2xl font-black break-words leading-tight">
          ${booking.client.name}
        </h3>

        <p class="text-xs sm:text-sm opacity-90 italic break-all">
          ${booking.client.email || "No Email"}
        </p>

        <p class="text-xs sm:text-sm opacity-90 italic flex items-center gap-2">
          <ion-icon name="call-outline" class="text-sm"></ion-icon>
          <a href="tel:+${booking.client.phone}" class="break-all">
            ${booking.client.phone}
          </a>
        </p>

        ${isOverbooked ? `
          <div class="mt-2 bg-purple-500 text-[10px] font-black px-2 py-1 rounded shadow-sm inline-block uppercase">
            ⚠️ Overbooked: Vendor Stock Used
          </div>` : ''}
      </div>

      <!-- STATUS BADGE -->
      <div class="w-full sm:w-auto text-left sm:text-right">
        <span class="px-4 py-2 rounded-full text-xs font-black uppercase shadow-lg inline-block
          ${badgeColors[status]}">
          ${status}
        </span>
      </div>

    </div>
  </div>

  <!-- EVENT INFO -->
<div class="flex flex-col gap-3">

  <!-- TOP ROW -->
  <div class="flex flex-col sm:flex-row gap-3">

    <div class="flex-1 min-w-0 bg-gray-50 border-b-4 border-purple-500 p-4 rounded-2xl shadow-sm">
      <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">
        Event Type
      </p>

      <div class="flex items-center gap-2 mt-1">
        <ion-icon name="sparkles-outline" class="text-purple-600"></ion-icon>

        <p class="font-black text-gray-800 text-sm sm:text-base break-words">
          ${booking.event.type || "Other"}
        </p>
      </div>
    </div>

    
    <div class="flex-1 min-w-0 bg-gray-50 border-b-4 border-purple-500 p-4 rounded-2xl shadow-sm">
      <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">
        Event Date
      </p>

      <div class="flex items-center gap-2 mt-1">
        <ion-icon name="calendar-outline" class="text-purple-600"></ion-icon>

        <p class="font-black text-gray-800 text-sm sm:text-base break-all">
          ${booking.event.date || "Not set"}
        </p>
      </div>
    </div>

  </div>

  <!-- BOTTOM ROW -->
  <div class="flex flex-col lg:flex-row gap-3">

    <div class="flex-1 min-w-0 bg-gray-50 border-b-4 border-purple-500 p-4 rounded-2xl shadow-sm">
      <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">
        Delivery Date
      </p>

      <div class="flex items-start gap-2 mt-1">
        <ion-icon name="cube-outline" class="text-purple-600 mt-1"></ion-icon>

        <p class="font-black text-gray-800 text-sm break-all leading-relaxed">
          ${formatDateTime(booking.event.deliveryDate || booking.event.date)}
        </p>
      </div>
    </div>

    <div class="flex-1 min-w-0 bg-gray-50 border-b-4 ${
      status === "overdue"
        ? "border-red-500"
        : "border-purple-500"
    } p-4 rounded-2xl shadow-sm">

      <p class="text-[10px] uppercase text-gray-500 font-black tracking-wider">
        Return Date
      </p>

      <div class="flex items-start gap-2 mt-1">
        <ion-icon 
          name="return-up-back-outline" 
          class="${status === "overdue"
            ? "text-red-600"
            : "text-purple-600"} mt-1">
        </ion-icon>

        <p class="font-black text-sm break-all leading-relaxed ${
          status === "overdue"
            ? "text-red-600"
            : "text-gray-800"
        }">
          ${formatDateTime(booking.event.returnDate)}
        </p>
      </div>
    </div>

  </div>

</div>

  ${vendorBlock}

  <!-- RENTAL ITEMS -->
  <div>
    <h4 class="flex items-center gap-2 font-bold text-purple-800 mb-3 text-base">
      <ion-icon name="cart"></ion-icon>
      Rental Items
    </h4>

    <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
      ${(booking.items || []).map(i => `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-white border border-gray-100 p-3 rounded-xl shadow-sm">

          <div>
            <p class="font-bold text-gray-800">
              ${i.name}
              ${i.shortage > 0 ? `
                <span class="text-red-500 text-[10px] ml-1">
                  (Shortage: ${i.shortage})
                </span>` : ''}
            </p>

            <p class="text-[10px] text-purple-600 font-bold">
              Qty: ${i.qty} @ ₦${(i.price || 0).toLocaleString()}
            </p>
          </div>

          <span class="font-black text-gray-700">
            ₦${(i.total || 0).toLocaleString()}
          </span>

        </div>
      `).join("")}
    </div>
  </div>
<!-- PAYMENT SUMMARY -->
<div class="bg-white border-2 border-purple-100 rounded-2xl p-4 shadow-inner">

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">

    <!-- TOTAL -->
    <div class="bg-gray-50 p-3 rounded-xl">
      <p class="text-xs text-gray-500 font-bold">Total</p>
      <p class="text-lg font-black text-gray-800">
        ₦${(booking.payment?.total || 0).toLocaleString()}
      </p>
    </div>

    <!-- PAID -->
    <div class="bg-green-50 p-3 rounded-xl">
      <p class="text-xs text-green-600 font-bold">Paid</p>
      <p class="text-lg font-black text-green-700">
        ₦${(booking.payment?.paid || 0).toLocaleString()}
      </p>
    </div>

    <!-- BALANCE (REAL LOGIC) -->
    <div class="bg-red-50 p-3 rounded-xl">
      <p class="text-xs text-red-600 font-bold">
        ${(booking.payment?.paid || 0) >= (booking.payment?.total || 0)
          ? "Change"
          : "Balance"}
      </p>

      <p class="text-lg font-black text-red-700">

        ${(booking.payment?.paid || 0) === (booking.payment?.total || 0)
          ? "✓ Paid Full"
          : (booking.payment?.paid || 0) > (booking.payment?.total || 0)
          ? `₦${((booking.payment?.paid || 0) - (booking.payment?.total || 0)).toLocaleString()}`
          : `₦${((booking.payment?.total || 0) - (booking.payment?.paid || 0)).toLocaleString()}`
        }

      </p>
    </div>

  </div>
</div>

  <!-- NOTES -->
  ${booking.notes ? `
<div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
  <p class="text-xs font-bold text-yellow-700 uppercase">Notes</p>
  <p class="text-sm text-gray-700 mt-1 break-words">${booking.notes}</p>
</div>
` : ""}
<!-- RECEIPT -->
<div class="mt-6">

  <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
    <p class="text-[10px] font-black text-purple-700 uppercase">
      Live Receipt Preview
    </p>

    <span class="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold">
      WhatsApp Ready
    </span>
  </div>

  <div class="bg-gray-900 text-green-400 p-4 rounded-2xl font-mono text-xs whitespace-pre-wrap border-2 border-gray-800 shadow-inner overflow-auto max-h-72">
    ${receiptText}
  </div>

  <div class="flex flex-col sm:flex-row gap-3 mt-4">

    <button
      onclick="shareToWhatsApp('${booking.client.phone}', \`${receiptText}\`)"
      class="flex-1 min-h-[55px] px-4 bg-green-500 hover:bg-green-600 transition text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg">

      <ion-icon name="logo-whatsapp" class="text-xl"></ion-icon>

      <span class="text-sm sm:text-base text-center">
        Share Receipt
      </span>
    </button>

    <button
      id="downloadReceiptImgBtn"
      class="flex-1 min-h-[55px] px-4 bg-purple-600 hover:bg-purple-700 transition text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg">

      <span class="material-symbols-outlined text-xl">image</span>

      <span class="text-sm sm:text-base text-center">
        Download Receipt Image
      </span>
    </button>

  </div>

</div>

<!-- ACTION BUTTONS -->
<div class="space-y-3">

  ${status !== "returned" && currentRole !== "viewer" ? `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">

      <button
        class="py-3 bg-white border-2 border-purple-700 text-purple-700 rounded-xl font-black text-sm shadow-md hover:bg-purple-50 transition"
        onclick='openEditModal(${JSON.stringify(booking)}, "${id}", "${businessId}")'>
        EDIT BOOKING
      </button>

      <button
        class="py-3 bg-purple-700 text-white rounded-xl font-black text-sm shadow-lg hover:bg-purple-800 transition"
        onclick='returnBooking("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>
        MARK RETURNED
      </button>

    </div>
  ` : status === "returned" ? `
    <div class="p-4 bg-green-50 text-green-700 text-center font-bold rounded-xl border border-green-200">
      ✓ Items Successfully Returned
    </div>
  ` : ""}

  <!-- Bottom row -->
  <div class="flex flex-col sm:flex-row gap-3">

    <button
      onclick="closeModal()"
      class="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold uppercase text-xs hover:bg-gray-300 transition">
      Close
    </button>

    ${currentRole === "owner" ? `
      <button
        onclick='deleteBooking("${id}", "${businessId}")'
        class="sm:w-auto w-full px-6 py-3 bg-red-100 text-red-600 rounded-xl shadow-sm hover:bg-red-600 hover:text-white transition flex items-center justify-center gap-2">
        <ion-icon name="trash-outline"></ion-icon>
        Delete
      </button>
    ` : ""}

  </div>

</div>
</div>
`;

bookingModal.style.display = "flex";
document.body.style.overflow = "hidden";

const dlBtn = document.getElementById("downloadReceiptImgBtn");
if (dlBtn) {
  dlBtn.addEventListener("click", () => {
    generateReceiptImage(booking, currentBusinessName);
  });
}

setTimeout(() => {
document.querySelectorAll("#editItemsContainer .item-name").forEach(select => {

  select.addEventListener("change", (e) => {

    const opt = e.target.selectedOptions[0];
    const row = e.target.closest(".item-row");

    row.querySelector(".item-price").value =
      opt?.dataset.price || 0;

    recalculateEditTotal();
  });

});
}, 200);
};










/* =========================
   EDIT MODAL
========================= */
/* ========================================================
   REDESIGNED EDIT MODAL — same IDs, purple accents added
======================================================== */
window.openEditModal = async function (booking, id, businessId) {
  modalContent.innerHTML = `
<div style="display:flex;flex-direction:column;gap:1.25rem;padding:1.75rem;max-width:680px;margin:0 auto;">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:1rem;border-bottom:0.5px solid #e5e5e5;">
    <div>
      <h3 style="font-size:16px;font-weight:500;margin:0 0 2px;color:purple;">Edit booking</h3>
      <p style="font-size:13px;color:#6b7280;margin:0;">Changes recalculate inventory instantly.</p>
      <div id="editOverbookWarning" style="display:none;margin-top:8px;background:#fef2f2;color:#b91c1c;font-size:12px;font-weight:500;padding:5px 10px;border-radius:6px;border:0.5px solid #fca5a5;">
        ⚠ One or more entries exceed stock capacity.
      </div>
    </div>
    <div style="width:36px;height:36px;border-radius:8px;background:#f5f0ff;border:0.5px solid #d8b4fe;display:flex;align-items:center;justify-content:center;">
      <ion-icon name="create-outline" style="font-size:18px;color:purple;"></ion-icon>
    </div>
  </div>

  <!-- Two-column: Customer + Logistics -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;">

    <!-- Customer -->
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:0.5px solid #e5e5e5;">
        <ion-icon name="person-outline" style="font-size:16px;color:purple;"></ion-icon>
        <span style="font-size:12px;font-weight:600;color:purple;text-transform:uppercase;letter-spacing:.04em;">Customer</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="font-size:12px;color:purple;">Full name</label>
        <input id="editName" type="text" value="${booking.client.name || ""}"
          style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Phone</label>
          <input id="editPhone" type="text" value="${booking.client.phone || ""}"
            style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Email</label>
          <input id="editEmail" type="email" value="${booking.client.email || ""}"
            style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
      </div>
    </div>

    <!-- Logistics -->
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:0.5px solid #e5e5e5;">
        <ion-icon name="calendar-clear-outline" style="font-size:16px;color:purple;"></ion-icon>
        <span style="font-size:12px;font-weight:600;color:purple;text-transform:uppercase;letter-spacing:.04em;">Logistics</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Event type</label>
          <input id="editEventType" type="text" list="eventTypesDataList" value="${booking.event.type || "Other"}"
            style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
          <datalist id="eventTypesDataList">
            <option value="Wedding"><option value="Birthday"><option value="Burial"><option value="Conference"><option value="Other">
          </datalist>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Event date</label>
          <input id="editDate" type="date" value="${booking.event.date || ""}"
            style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Delivery</label>
          <input id="editDelivery" type="datetime-local" value="${booking.event.deliveryDate || ""}"
            style="padding:8px 10px;font-size:12px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:purple;">Return deadline</label>
          <input id="editReturn" type="datetime-local" value="${booking.event.returnDate || ""}"
            style="padding:8px 10px;font-size:12px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="font-size:12px;color:purple;">Venue</label>
        <input id="editLocation" type="text" value="${booking.event.location || ""}"
          style="padding:8px 10px;font-size:14px;border-radius:6px;border:0.5px solid #d8b4fe;background:#fff;outline:none;width:100%;box-sizing:border-box;">
      </div>
    </div>

  </div>

  <!-- Items -->
  <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:10px;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;border-bottom:0.5px solid #e5e5e5;">
      <div style="display:flex;align-items:center;gap:8px;">
        <ion-icon name="list-baggage-outline" style="font-size:16px;color:purple;"></ion-icon>
        <span style="font-size:12px;font-weight:600;color:purple;text-transform:uppercase;letter-spacing:.04em;">Items</span>
      </div>
      <button type="button" onclick="addEditItem()"
        style="font-size:13px;font-weight:500;padding:5px 12px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f5f0ff;color:purple;cursor:pointer;">
        + Add item
      </button>
    </div>

    <div id="editItemsContainer" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;">
      ${(booking.items || []).map(item => `
        <div class="item-row" style="display:flex;gap:6px;align-items:center;background:#fff;border:0.5px solid #e5e5e5;border-radius:6px;padding:8px 10px;">
          <div style="flex:2;min-width:120px;">
            <select class="item-name" style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;color:#374151;outline:none;">
              <option value="">Select item</option>
              ${inventoryItems.map(inv => `
                <option value="${inv.name}" data-price="${inv.price}" data-stock="${inv.availableQuantity}" ${inv.name.toLowerCase() === item.name.toLowerCase() ? "selected" : ""}>
                  ${inv.name} (Stock: ${inv.availableQuantity})
                </option>
              `).join("")}
            </select>
          </div>
          <div style="width:70px;">
            <input class="item-qty" type="number" placeholder="Qty" value="${item.qty || 0}"
              style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;">
          </div>
          <div style="width:90px;">
            <input class="item-price" type="number" placeholder="₦" value="${item.price || 0}"
              style="width:100%;padding:6px 8px;font-size:13px;text-align:center;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;">
          </div>
          <div style="flex:1;min-width:80px;">
            <input class="item-supplier" type="text" value="${item.supplier || ""}" placeholder="Vendor"
              style="width:100%;padding:6px 8px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;outline:none;box-sizing:border-box;">
          </div>
          <button type="button" onclick="this.parentElement.remove(); recalculateEditWorkspace();"
            style="width:30px;height:30px;border:0.5px solid #fca5a5;border-radius:6px;background:#fef2f2;color:#b91c1c;cursor:pointer;font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
      `).join("")}
    </div>
  </div>

  <!-- Totals -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div style="background:#f5f0ff;border-radius:12px;border:0.5px solid #d8b4fe;padding:1rem 1.25rem;">
      <label style="font-size:12px;color:purple;display:block;margin-bottom:6px;font-weight:600;">Total valuation (₦)</label>
      <input id="editTotal" type="number" value="${booking.payment?.total || 0}" readonly
        style="width:100%;padding:4px 0;font-size:20px;font-weight:500;border:none;background:transparent;color:purple;outline:none;cursor:not-allowed;box-sizing:border-box;">
    </div>
    <div style="background:#f9fafb;border-radius:12px;border:0.5px solid #e5e5e5;padding:1rem 1.25rem;">
      <label style="font-size:12px;color:#9ca3af;display:block;margin-bottom:6px;">Amount paid (₦)</label>
      <input id="editPaid" type="number" value="${booking.payment?.paid || 0}"
        style="width:100%;padding:4px 0;font-size:20px;font-weight:500;border:none;background:transparent;color:#374151;outline:none;box-sizing:border-box;">
    </div>
  </div>

  <!-- Notes -->
  <div style="display:flex;flex-direction:column;gap:6px;">
    <label style="font-size:12px;color:purple;font-weight:600;">Internal notes</label>
    <textarea id="editNotes" placeholder="Internal updates, client agreements, balance notes..."
      style="width:100%;padding:10px;font-size:13px;border-radius:6px;border:0.5px solid #d8b4fe;background:#f9fafb;color:#374151;outline:none;min-height:72px;resize:vertical;box-sizing:border-box;font-family:inherit;">${booking.notes || ""}</textarea>
  </div>

  <!-- Actions -->
  <div style="display:flex;gap:8px;padding-top:4px;">
    <button style="flex:1;padding:11px;font-size:14px;font-weight:500;border-radius:6px;border:none;background:purple;color:#fff;cursor:pointer;"
      onclick='saveEdit("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>
      Save changes
    </button>
    <button style="padding:11px 24px;font-size:14px;font-weight:500;border-radius:6px;border:0.5px solid #d1d5db;background:#f9fafb;color:#6b7280;cursor:pointer;"
      onclick="closeModal()">
      Cancel
    </button>
  </div>

</div>`;

  document.querySelectorAll("#editItemsContainer .item-row").forEach(attachRowCalculationListeners);
  recalculateEditWorkspace();
};


function formatDateTime(value) {
  if (!value) return "Not set";

  const date = new Date(value);

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



/* ========================================================
   DYNAMIC SPAWN COMPONENT WITH INSTANT BINDINGS
======================================================== */
window.addEditItem = function () {
  const container = document.getElementById("editItemsContainer");
  const tempRowId = "row_" + Date.now();

  const elementString = `
    <div id="${tempRowId}" class="item-row flex flex-wrap lg:flex-nowrap gap-2 bg-gray-50 hover:bg-gray-100/50 p-3 rounded-xl border border-gray-200 transition items-center animate__animated animate__fadeIn">
      <div class="w-full lg:flex-1 min-w-[180px]">
        <select class="item-name w-full p-2.5 border border-gray-200 rounded-lg bg-white font-bold text-sm text-gray-700 outline-none">
          <option value="">-- Choose Inventory --</option>
          ${inventoryItems.map(inv => `
            <option value="${inv.name}" data-price="${inv.price}" data-stock="${inv.availableQuantity}">
              ${inv.name} (Available Stock: ${inv.availableQuantity})
            </option>
          `).join("")}
        </select>
      </div>
      <div class="w-[22%] min-w-[70px]">
        <input class="item-qty w-full p-2 border border-gray-200 rounded-lg text-center font-black text-sm" type="number" value="1">
      </div>
      <div class="w-[28%] min-w-[90px]">
        <input class="item-price w-full p-2 border border-gray-200 rounded-lg text-center font-mono text-sm text-purple-900 font-bold" type="number" value="0">
      </div>
      <div class="flex-1 min-w-[120px]">
        <input class="item-supplier w-full p-2 border border-gray-200 rounded-lg text-xs placeholder-gray-400 font-medium" placeholder="Outsource Vendor Partner">
      </div>
      <button type="button" class="w-10 h-10 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white flex items-center justify-center font-bold transition shadow-sm" onclick="this.parentElement.remove(); recalculateEditWorkspace();">✕</button>
    </div>
  `;

  container.insertAdjacentHTML("beforeend", elementString);
  const newlyCreatedRow = document.getElementById(tempRowId);
  attachRowCalculationListeners(newlyCreatedRow);
  recalculateEditWorkspace();
};






/* =========================================
   SAVING EDITS WITH INTELLIGENT INVENTORY DIFF
========================================= */
window.saveEdit = async function (id, businessId, originalItems) {
  const saveBtn = event?.target;
  if (saveBtn) disableButton(saveBtn);

  try {
    const rows = document.querySelectorAll("#editItemsContainer .item-row");
    const updatedItems = [];
    let hasError = false;

    // 1. BUILD NEW ITEMS ARRAY FROM THE FORM ROWS
    rows.forEach(row => {
      const select = row.querySelector(".item-name");
      const qtyInput = row.querySelector(".item-qty");
      const priceInput = row.querySelector(".item-price");
      const supplierInput = row.querySelector(".item-supplier");

      const name = select?.value?.trim();
      const qty = Number(qtyInput?.value || 0);
      const price = Number(priceInput?.value || 0);
      const supplier = supplierInput?.value?.trim() || "";

      if (!name || qty <= 0) {
        hasError = true;
        return;
      }

      updatedItems.push({
        name,
        qty,
        price,
        total: qty * price,
        supplier,
        shortage: 0
      });
    });

    if (hasError || updatedItems.length === 0) {
      alert("Please fill all items correctly.");
      if (saveBtn) enableButton(saveBtn);
      return;
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





window.closeModal = function () {
  bookingModal.style.display = "none";
  document.body.style.overflow = "";
};
function disableButton(button, duration = 1500) {
  button.disabled = true;
  button.classList.add("opacity-50", "cursor-not-allowed", "animate-pulse");
  setTimeout(() => {
    button.disabled = false;
    button.classList.remove("opacity-50", "cursor-not-allowed", "animate-pulse");
  }, duration);
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

      <td class="p-4 font-medium text-gray-800 cursor-pointer"
        data-id="${id}"
        data-business="${businessId}"
        onclick="handleViewClick(this)">
        ${b.client.name}
      </td>

      <td class="p-4 text-gray-600 text-sm cursor-pointer"
        data-id="${id}"
        data-business="${businessId}"
        onclick="handleViewClick(this)">
          ${formatDateTime(b.event.deliveryDate || b.event.date)}
      </td>

      <td class="p-4 cursor-pointer"
        data-id="${id}"
        data-business="${businessId}"
        onclick="handleViewClick(this)">
        <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${colors[status]}">
          ${status}
        </span>
        ${isOverbooked ? `
          <span class="ml-2 px-2 py-1 rounded-full text-[9px] font-black uppercase bg-orange-100 text-orange-600">
            Overbooked
          </span>
        ` : ""}
      </td>

      <td class="p-4">
        <button
          type="button"
          data-id="${id}"
          data-business="${businessId}"
          onclick="handleViewClick(this)"
          class="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl font-bold text-sm shadow-md transition-all duration-200">
          View
        </button>
      </td>
    </tr>
  `;
}

window.handleViewClick = function (element) {
  openBookingById(element.dataset.id, element.dataset.business);
};

window.openBookingById = async function (id, businessId) {
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

  // =========================
  // 1. STATUS CHANGE LOGIC
  // =========================
  if (booking.status !== calculated) {
    updates.status = calculated;

    if (calculated === "overdue" && !booking.overdueNotified) {
      await sendNotification(
        businessId,
        `⚠️ Booking for ${booking.client.name} is OVERDUE`,
        auth.currentUser.email,
        "booking_overdue",
        id
      );
      updates.overdueNotified = true;
    }

    if (calculated === "returned" && !booking.returnNotified) {
      await sendNotification(
        businessId,
        `✅ Booking for ${booking.client.name} has been RETURNED`,
        auth.currentUser.email,
        "booking_returned",
        id
      );
      updates.returnNotified = true;
    }
  }

  // =========================
  // 2. OVERBOOKED ALERT
  // =========================
  if (isOverbooked && !booking.overbookedNotified) {
    await sendNotification(
      businessId,
      `⚠️ Booking for ${booking.client.name} is OVERBOOKED (vendor stock used)`,
      auth.currentUser.email,
      "booking_overbooked",
      id
    );

    updates.overbookedNotified = true;
  }

  // =========================
  // 3. APPLY UPDATES ONCE
  // =========================
  if (Object.keys(updates).length > 0) {
    await updateDoc(bookingRef, updates);
  }
}

function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(128, 0, 128, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { 
    window.location.href = "signup.html"; 
    return; 
  }

  try {
    const businessId = await getBusinessIdByEmail(user.email);
    if (!navigator.onLine) {
      showOfflineBanner();
    }
    
    // Trigger automated notification checks (throttled to 15 minutes)
    runAutomatedChecks(businessId).catch(err => console.error("Error running auto checks:", err));

    // Register service worker notification trigger
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data?.type === 'TRIGGER_AUTO_CHECKS') {
        runAutomatedChecks(businessId).catch(err => console.error(err));
      }
    });

    const tbody = document.getElementById("bookingsTable");
    const q = query(collection(db, "businesses", businessId, "bookings"));

    onSnapshot(q, (snap) => {
      let mapped = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      mapped.sort((a, b) => {
        const timeA = a.data.createdAt?.toDate ? a.data.createdAt.toDate().getTime() : 
                      (a.data.createdAt ? new Date(a.data.createdAt).getTime() : 
                      (a.data.event?.date ? new Date(a.data.event.date).getTime() : 
                      (a.data.date ? new Date(a.data.date).getTime() : 0)));
        const timeB = b.data.createdAt?.toDate ? b.data.createdAt.toDate().getTime() : 
                      (b.data.createdAt ? new Date(b.data.createdAt).getTime() : 
                      (b.data.event?.date ? new Date(b.data.event.date).getTime() : 
                      (b.data.date ? new Date(b.data.date).getTime() : 0)));
        return timeB - timeA;
      });
      allBookingsGlobal = mapped;

      function filterAndRender() {
        const sFilter = document.getElementById("filterStatus")?.value || "";
        const dFilter = document.getElementById("filterDate")?.value || "";
        const searchInput = document.getElementById("searchInput");
        const search = searchInput ? searchInput.value.toLowerCase() : "";

        if (!tbody) return;
        tbody.innerHTML = "";

        const filtered = allBookingsGlobal.filter(({ data }) => {
          const currentStatus = getCalculatedStatus(data);
          
          // 1. Calculate Overbooked status based on item shortages safely
          const isOverbooked = data.items?.some(i => {
            const shortageNum = Number(i.shortage);
            return !isNaN(shortageNum) && shortageNum > 0;
          }) || false;

          // 2. Status Match Controller
          let matchesStatus = false;
          if (!sFilter) {
            matchesStatus = true;
          } else if (sFilter === "overbooked") {
            matchesStatus = isOverbooked;
          } else {
            matchesStatus = (currentStatus === sFilter);
          }

          // 3. Date Match Controller
          const matchesDate = !dFilter || data.event?.date === dFilter;

          // 4. Client Search Match
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

      const sF = document.getElementById("filterStatus");
      const dF = document.getElementById("filterDate");
      const sI = document.getElementById("searchInput");

      if (sF) sF.onchange = filterAndRender;
      if (dF) dF.onchange = filterAndRender;
      if (sI) sI.oninput = filterAndRender;

      filterAndRender();
    });

    await loadInventory(businessId);

  } catch (err) {
    console.error("Dashboard Load Error:", err);
    if (!navigator.onLine || err.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      window.location.href = "setup.html";
    }
  }
});


/* =========================
   NOTIFICATION HELPER
========================= */
async function sendNotification(businessId, message, userEmail, type, bookingId = "") {
  try {
    const notifRef = collection(db, "businesses", businessId, "notifications");
    await addDoc(notifRef, {
      message: message,
      triggeredBy: userEmail || "System",
      type: type,
      bookingId: bookingId,
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
    console.log("Notification sent successfully!");
  } catch (err) {
    console.error("Failed to send notification:", err);
  }
}


// Add this right inside your script block to handle URL parameter filtering
document.addEventListener("DOMContentLoaded", () => {
    // 1. Parse out the search params from the address bar
    const urlParams = new URLSearchParams(window.location.search);
    const targetStatus = urlParams.get('status'); // e.g. 'active', 'returned'

    if (targetStatus) {
        // 2. Identify your booking page's status dropdown element
        const statusDropdown = document.getElementById("filterStatus");
        
        if (statusDropdown) {
            // Check if the passed status exists as a valid selectable option
            const validOptions = Array.from(statusDropdown.options).map(opt => opt.value);
            
            if (validOptions.includes(targetStatus)) {
                // Set the value directly
                statusDropdown.value = targetStatus;
                
                // 3. Dispatch the change event to kick off your rendering engine/data SDK fetch
                statusDropdown.dispatchEvent(new Event('change'));
                console.log(`Successfully auto-filtered bookings by: ${targetStatus}`);
            }
        }
    }
});

// Expose globally so rendering logic can query current temporal card states
window.getCalculatedStatus = function(booking) {
  if (booking.status === "returned") return "returned";
  const returnDate = booking.event?.returnDate;
  if (!returnDate) return "active";

  const now = new Date();
  const returnTime = new Date(returnDate);
  return now > returnTime ? "overdue" : "active";
};





// Background tasks are processed client-side via sw.js and reminderService.js to comply with Firebase Spark free limits.