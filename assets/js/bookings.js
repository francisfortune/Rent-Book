import { auth, db } from "./firebase.js";
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

let currentRole = "viewer"; // Global role tracker


/* =========================
   RECEIPT TEXT GENERATOR
========================= */
function generateReceiptText(booking) {
  const total = booking.payment?.total || 0;
  const paid = booking.payment?.paid || 0;
  const balance = total - paid;
  
  let itemsSummary = booking.items?.map(i => 
    `• ${i.name} (x${i.qty}) - ₦${(i.total || 0).toLocaleString()}`
  ).join("\n") || "No items";

  return `*BOOKING RECEIPT*\n\n` +
    `Hi ${booking.client.name}, your booking details are below:\n\n` +
    `📅 *Date:* ${booking.event.date}\n` +
    `📍 *Location:* ${booking.event.location || "Not specified"}\n\n` +
    `*Items Ordered:* \n${itemsSummary}\n\n` +
    `💰 *Total:* ₦${total.toLocaleString()}\n` +
    `💳 *Paid:* ₦${paid.toLocaleString()}\n` +
    `📉 *Balance:* ₦${balance.toLocaleString()}\n\n` +
    `Thank you for your business!`;
}

window.shareToWhatsApp = function(phone, message) {
  if (!phone || phone.length < 5) return alert("No valid phone number found!");
  const cleanPhone = phone.replace(/\D/g, '');
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
};


/* =========================
   DYNAMIC STATUS CALCULATOR
========================= */
function getCalculatedStatus(booking) {
  // If the DB explicitly says 'returned', that takes precedence
  if (booking.status === "returned") return "returned";
  
  const today = new Date().toISOString().split('T')[0]; // Current date YYYY-MM-DD
  const returnDate = booking.event.returnDate;
  
  // If today is past the return date, it's overdue
  return today > returnDate ? "overdue" : "active";
}

/* =========================
   BUSINESS LOOKUP
========================= */
async function getBusinessIdByEmail(email) {
  const q = query(collection(db, "businessMembers"), where("email", "==", email));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("No business");
  const data = snap.docs[0].data();
  currentRole = data.role; 
  return data.businessId;
}

/* =========================
   INVENTORY RESTORE
========================= */
async function restoreInventory(businessId, items) {
  const invSnap = await getDocs(collection(db, "businesses", businessId, "inventory"));
  for (const item of items) {
    const match = invSnap.docs.find(d => d.data().name.toLowerCase() === item.name.toLowerCase());
    if (!match) continue;
    
    // Logic: If you booked 400 chairs but only had 300 (shortage 100), 
    // you only put 300 back into your stock.
    const restorableQty = Math.max(0, item.qty - (item.shortage || 0));
    if (restorableQty === 0) continue;
    
    await updateDoc(match.ref, {
      availableQuantity: match.data().availableQuantity + restorableQty
    });
  }
}

/* =========================
   RETURN BOOKING
========================= */
window.returnBooking = async function(bookingId, businessId, items) {
  const btn = event?.target;
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
      border-top: 5px solid #7c3aed; border-radius: 50%; 
      animation: spin 1s linear infinite; margin-bottom: 20px;">
    </div>
    <h3 style="color: #6d28d9; font-weight: 800; margin: 0;">MARKING RETURN...</h3>
    <p style="color: #6b7280; font-size: 0.8rem; margin-top: 5px;">Syncing inventory, please wait.</p>
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
    await updateDoc(bookingRef, { status: "returned" });
    
    // 4. Restore physical items to inventory
    await restoreInventory(businessId, items);

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
      if (!confirm("Delete this returned booking permanently?")) return;
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

  // You can auto-open it if you want:
  // openBooking(data, highlightId, businessId)
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
const borrowedItems = booking.items?.filter(i => i.shortage > 0 && i.supplier)?.map(i => {
  return `• ${i.name} (Borrowed: ${i.shortage}) from ${i.supplier}`;
}) || [];

const vendorBlock = borrowedItems.length
  ? `<div class="bg-purple-50 border border-purple-200 rounded-xl p-4">
       <p class="text-xs font-bold text-purple-700 uppercase">Vendor / Borrowed Items</p>
       <p class="text-sm text-gray-700 mt-1">${borrowedItems.join("<br>")}</p>
     </div>`
  : "";
const receiptText = generateReceiptText(booking);
  

  modalContent.innerHTML = `
<div class="space-y-6 animate__animated animate__fadeIn">
  
  <div class="relative overflow-hidden bg-gradient-to-r ${status === 'overdue' ? 'from-red-600 to-red-800' : 'from-purple-700 to-indigo-800'} p-6 rounded-2xl text-white shadow-xl">
    <div class="relative z-10 flex justify-between items-center">
      <div>
        <p class="text-xs uppercase tracking-widest opacity-80">Client Profile</p>
        <h3 class="text-2xl font-black">${booking.client.name}</h3>
        <p class="text-sm opacity-90 italic">${booking.client.email || "No Email"}</p>
        ${isOverbooked ? `<div class="mt-2 bg-purple-500 text-[10px] font-black px-2 py-1 rounded shadow-sm inline-block uppercase">⚠️ Overbooked: Vendor Stock Used</div>` : ''}
      </div>
      <div class="text-right">
        <span class="px-4 py-2 rounded-full text-xs font-black uppercase shadow-lg ${status === 'returned' ? 'bg-green-400 text-green-900' : 'bg-white text-purple-700'}">
          ${status}
        </span>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-3 gap-3 text-center">
    <div class="bg-gray-50 border-b-4 border-purple-500 p-3 rounded-xl shadow-sm">
      <p class="text-[10px] uppercase text-gray-500 font-bold">Event Type</p>
      <p class="font-bold text-gray-800">${booking.event.type || "Other"}</p>
    </div>
    <div class="bg-gray-50 border-b-4 border-purple-500 p-3 rounded-xl shadow-sm">
      <p class="text-[10px] uppercase text-gray-500 font-bold">Event Date</p>
      <p class="font-bold text-gray-800">${booking.event.date}</p>
    </div>
    <div class="bg-gray-50 border-b-4 border-purple-500 p-3 rounded-xl shadow-sm">
      <p class="text-[10px] uppercase text-gray-500 font-bold">Return Date</p>
      <p class="font-bold ${status === 'overdue' ? 'text-red-600' : 'text-gray-800'}">${booking.event.returnDate}</p>
    </div>
  </div>

  <div>
    <h4 class="flex items-center gap-2 font-bold text-purple-800 mb-3">
      <ion-icon name="cart"></ion-icon> Rental Inventory
    </h4>
    <div class="space-y-2 max-h-48 overflow-y-auto pr-2">
      ${booking.items.map(i => `
        <div class="flex justify-between items-center bg-white border border-gray-100 p-3 rounded-xl shadow-sm">
          <div>
            <p class="font-bold text-gray-800">${i.name} ${i.shortage > 0 ? `<span class="text-red-500 text-[10px] ml-1">(Shortage: ${i.shortage})</span>` : ''}</p>
            <p class="text-[10px] text-purple-600 font-bold">Qty: ${i.qty} @ ₦${(i.price || 0).toLocaleString()}</p>
          </div>
          <span class="font-black text-gray-700">₦${(i.total || 0).toLocaleString()}</span>
        </div>
      `).join("")}
    </div>
  </div>

  <div class="bg-white border-2 border-purple-100 rounded-2xl p-4 shadow-inner">
    <div class="flex justify-between items-end">

  <div>
  <p class="text-xs text-gray-500">Total Amount</p>
  <p class="text-2xl font-black text-purple-800">₦${totalAmount.toLocaleString()}</p>
</div>


    <div>
         <p class="text-xs text-gray-400">Amount Paid</p>
         <p class="text-xl font-black text-green-600">₦${amountPaid.toLocaleString()}</p>
       </div>
       <div class="text-right">
         <p class="text-xs text-gray-400">Balance Owed</p>
         <p class="text-xl font-black ${balanceRemaining > 0 ? 'text-red-500' : 'text-green-500'}">
           ₦${balanceRemaining.toLocaleString()}
         </p>
       </div>
       </div>

       </div>

${vendorBlock}

${booking.notes ? `
<div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
  <p class="text-xs font-bold text-yellow-700 uppercase">Notes</p>
  <p class="text-sm text-gray-700 mt-1">${booking.notes}</p>
</div>

<div class="mt-6">
       <p class="text-[10px] font-black text-purple-700 uppercase mb-2">Live Receipt Preview</p>
       <div class="bg-gray-900 text-green-400 p-4 rounded-xl font-mono text-xs whitespace-pre-wrap border-2 border-gray-800 shadow-inner">
${receiptText}
</div>
<button onclick="shareToWhatsApp('${booking.client.phone}', \`${receiptText}\`)" 
               class="w-full mt-3 py-3 bg-green-500 text-white rounded-xl font-black flex items-center justify-center gap-2 shadow-lg">
          <ion-icon name="logo-whatsapp"></ion-icon> SHARE RECEIPT TO WHATSAPP
       </button>
    </div>

` : ""}


  <div class="space-y-3">
    ${status !== "returned" && currentRole !== "viewer" ? `
      <div class="grid grid-cols-2 gap-2">
          <button class="py-3 bg-white border-2 border-purple-700 text-purple-700 rounded-xl font-black text-sm shadow-md" 
            onclick='openEditModal(${JSON.stringify(booking)}, "${id}", "${businessId}")'>EDIT BOOKING</button>
          <button class="py-3 bg-purple-700 text-white rounded-xl font-black text-sm shadow-lg" 
            onclick='returnBooking("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>MARK RETURNED</button>
      </div>
    ` : status === "returned" ? `<div class="p-4 bg-green-50 text-green-700 text-center font-bold rounded-xl border border-green-200">✓ Items Successfully Returned</div>` : ""}
    
    <div class="flex gap-2">
      <button onclick="closeModal()" class="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold uppercase text-xs">Close</button>
      ${currentRole === "owner" ? `
        <button onclick='deleteBooking("${id}", "${businessId}")' class="px-6 py-3 bg-red-100 text-red-600 rounded-xl shadow-sm hover:bg-red-600 hover:text-white transition-all">
          <ion-icon name="trash" size="small"></ion-icon>
        </button>
      ` : ""}
    </div>
  </div>
</div>`;
  bookingModal.style.display = "flex";
  document.body.style.overflow = "hidden";
};

/* =========================
   EDIT MODAL
========================= */
window.openEditModal = async function(booking, id, businessId) {
  modalContent.innerHTML = `
<div class="space-y-5 p-1 animate__animated animate__slideInUp">
  <div class="border-b pb-2 flex justify-between items-center">
    <h3 class="text-xl font-black text-purple-800 uppercase tracking-tighter">Modify Booking</h3>
    <ion-icon name="create-outline" class="text-2xl text-purple-400"></ion-icon>
  </div>

  <div class="space-y-2">
    <label class="text-[10px] font-black text-purple-700 uppercase">Client Information</label>
    <input id="editName" type="text" value="${booking.client.name}" class="w-full p-3 bg-gray-50 border rounded-xl" placeholder="Full Name">
    <div class="grid grid-cols-2 gap-2">
      <input id="editPhone" type="text" value="${booking.client.phone || ""}" class="p-3 bg-gray-50 border rounded-xl" placeholder="Phone">
      <input id="editEmail" type="email" value="${booking.client.email || ""}" class="p-3 bg-gray-50 border rounded-xl" placeholder="Email">
    </div>
  </div>

  <div class="space-y-2">
    <label class="text-[10px] font-black text-purple-700 uppercase">Event Details</label>
    <div class="grid grid-cols-2 gap-2">
      <input id="editDate" type="date" value="${booking.event.date}" class="p-3 bg-gray-50 border rounded-xl text-sm">
      <input id="editReturn" type="date" value="${booking.event.returnDate}" class="p-3 bg-gray-50 border rounded-xl text-sm">
    </div>
    <input id="editLocation" type="text" value="${booking.event.location || ""}" class="w-full p-3 bg-gray-50 border rounded-xl" placeholder="Location">
  </div>

  <div class="space-y-2">
    <label class="text-[10px] font-black text-purple-700 uppercase">Payment Info</label>
    <div class="grid grid-cols-2 gap-2">
      <div><p class="text-[9px] text-gray-400 ml-1">Total (₦)</p><input id="editTotal" type="number" value="${booking.payment?.total || 0}" class="w-full p-3 bg-gray-50 border rounded-xl font-bold"></div>
      <div><p class="text-[9px] text-gray-400 ml-1">Paid (₦)</p><input id="editPaid" type="number" value="${booking.payment?.paid || 0}" class="w-full p-3 bg-gray-50 border rounded-xl font-bold text-green-600"></div>
    </div>
  </div>

<div class="space-y-2">
  <label class="text-[10px] font-black text-purple-700 uppercase">Notes</label>
  <textarea id="editNotes" class="w-full p-3 bg-gray-50 border rounded-xl" placeholder="Additional notes...">${booking.notes || ""}</textarea>
</div>

  <div class="flex gap-2 pt-2">
    <button class="flex-1 py-4 bg-purple-700 text-white rounded-2xl font-black shadow-lg" onclick='saveEdit("${id}", "${businessId}")'>SAVE UPDATES</button>
    <button class="px-6 py-4 bg-gray-100 rounded-2xl font-bold text-gray-400" onclick='closeModal()'>CANCEL</button>
  </div>
</div>`;
};

window.saveEdit = async function(id, businessId) {
  const saveBtn = document.querySelector('button[onclick^="saveEdit"]');
  disableButton(saveBtn);

  try {
    const updatedData = {
      "client.name": document.getElementById("editName").value,
      "client.phone": document.getElementById("editPhone").value,
      "client.email": document.getElementById("editEmail").value,
      "event.date": document.getElementById("editDate").value,
      "event.returnDate": document.getElementById("editReturn").value,
      "event.location": document.getElementById("editLocation").value,
      "payment.total": Number(document.getElementById("editTotal").value),
      "payment.paid": Number(document.getElementById("editPaid").value),
      "notes": document.getElementById("editNotes").value
    };

    await updateDoc(doc(db, "businesses", businessId, "bookings", id), updatedData);

    alert(`Booking updated successfully for ${updatedData["client.name"]} ✅`);
    closeModal();

 await sendNotification(
  businessId,
  `Booking for ${document.getElementById("editName").value} has been updated successfully ✏️`,
  auth.currentUser.email,
  "booking_updated",
  id
);

  } catch (e) { 
    alert("Error: " + e.message); 
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
    <tr class="hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100" onclick='openBooking(${JSON.stringify(b)}, "${id}", "${businessId}")'>
      <td class="p-4 font-medium text-gray-800">
        ${b.client.name}
        ${isOverbooked ? `<span class="ml-2 px-2 py-0.5 text-[9px] rounded-full bg-orange-100 text-orange-600 font-black uppercase">Overbooked</span>` : ``}
      </td>
      <td class="p-4 text-gray-600 text-sm">${b.event.date}</td>
      <td class="p-4 text-gray-600 text-sm">${b.items.length} items</td>
      <td class="p-4"><span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${colors[status]}">${status}</span></td>
      <td class="p-4"><button class="text-purple-600"><ion-icon name="eye-outline" class="text-xl"></ion-icon></button></td>
    </tr>
  `;
}


async function checkAndNotifyStatusChange(booking, id, businessId) {
  const calculated = getCalculatedStatus(booking);

  if (booking.status !== calculated) {
    await updateDoc(doc(db, "businesses", businessId, "bookings", id), {
      status: calculated
    });

await sendNotification(
  businessId,
  `Booking for ${booking.client.name} is now ${calculated.toUpperCase()}`,
  auth.currentUser.email,
  "status_change",
  id
);
  }
}
/* =========================
   AUTH GUARD + LIVE DATA
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { 
    window.location.href = "signup.html"; 
    return; 
  }

  try {
    const businessId = await getBusinessIdByEmail(user.email);
    const tbody = document.getElementById("bookingsTable");
    const q = query(collection(db, "businesses", businessId, "bookings"), orderBy("createdAt", "desc"));

    onSnapshot(q, (snap) => {
      const allBookings = snap.docs.map(d => ({ id: d.id, data: d.data() }));

      function filterAndRender() {
        const sFilter = document.getElementById("filterStatus").value;
        const dFilter = document.getElementById("filterDate").value;
        const searchInput = document.getElementById("searchInput");
        const search = searchInput ? searchInput.value.toLowerCase() : "";

        if (!tbody) return;
        tbody.innerHTML = "";

        const filtered = allBookings.filter(({ data }) => {
          const currentStatus = getCalculatedStatus(data);
          return (!sFilter || currentStatus === sFilter) &&
                 (!dFilter || data.event.date === dFilter) &&
                 (!search || data.client.name.toLowerCase().includes(search));
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center py-20 opacity-40 font-bold">No Bookings Found</td></tr>`;
          return;
        }

        filtered.forEach(({ id, data }) => {
          tbody.innerHTML += renderRow(data, id, businessId);
          // ✅ Background status check
          checkAndNotifyStatusChange(data, id, businessId);
        });
      }

      // Attach Listeners
      const sF = document.getElementById("filterStatus");
      const dF = document.getElementById("filterDate");
      const sI = document.getElementById("searchInput");

      if (sF) sF.onchange = filterAndRender;
      if (dF) dF.onchange = filterAndRender;
      if (sI) sI.oninput = filterAndRender;

      filterAndRender();
    }); // End onSnapshot

  } catch (err) {
    console.error("Dashboard Load Error:", err);
    // If business lookup fails, they might need to set up their profile
    // window.location.href = "setup.html"; 
  } // End try-catch
}); // End onAuthStateChanged