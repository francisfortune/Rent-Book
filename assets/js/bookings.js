import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentRole = "viewer"; // Global role tracker

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
/* =========================
   RETURN BOOKING (WITH LOADING ANIMATION)
========================= */
window.returnBooking = async function (bookingId, businessId, items) {
  const hasBorrowedItems = items.some(i => i.shortage > 0);
  
  if (hasBorrowedItems) {
    if (!confirm("This booking was overbooked.\nHave you returned borrowed items to the vendor?")) return;
  }
  
  if (!confirm("Mark this booking as returned?")) return;

  // 1. Create and Show Futuristic Loader
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
    // 2. Process Updates
    await updateDoc(doc(db, "businesses", businessId, "bookings", bookingId), { 
      status: "returned" 
    });
    
    await restoreInventory(businessId, items);

    // 3. Close everything
    document.body.removeChild(loader);
    closeModal();
    alert("Booking marked as returned successfully! ✅");
    
  } catch (error) {
    document.body.removeChild(loader);
    console.error("Return failed:", error);
    alert("An error occurred. Please try again.");
  }
};
/* =========================
   DELETE BOOKING (OWNER ONLY)
========================= */
window.deleteBooking = async function (bookingId, businessId) {
  if (currentRole !== "owner") return alert("Permission Denied: Only Owners can delete.");
  if (!confirm("Permanently delete this booking?")) return;
  await deleteDoc(doc(db, "businesses", businessId, "bookings", bookingId));
  closeModal();
};

/* =========================
   OPEN BOOKING MODAL (FUTURISTIC UI)
========================= */
window.openBooking = function (booking, id, businessId) {
  const totalAmount = booking.payment?.total || 0;
  const amountPaid = booking.payment?.paid || 0;
  const balanceRemaining = totalAmount - amountPaid;
  const status = booking.status;

  modalContent.innerHTML = `
<div class="space-y-6 animate__animated animate__fadeIn">
  
  <div class="relative overflow-hidden bg-gradient-to-r from-purple-700 to-indigo-800 p-6 rounded-2xl text-white shadow-xl">
    <div class="relative z-10 flex justify-between items-center">
      <div>
        <p class="text-xs uppercase tracking-widest opacity-80">Client Profile</p>
        <h3 class="text-2xl font-black">${booking.client.name}</h3>
        <p class="text-sm opacity-90 italic">${booking.client.email || "No Email Provided"}</p>
      <a href="tel:${booking.client.phone}" class="inline-flex items-center gap-2 bg-white/20 hover:bg-white/40 px-3 py-1.5 rounded-lg transition-all border border-white/30 text-sm font-bold no-underline text-white">
          <ion-icon name="call" class="text-lg"></ion-icon>
          <span>${booking.client.phone}</span>
        </a>
      </div>
      <div class="text-right">
        <span class="px-4 py-2 rounded-full text-xs font-black uppercase shadow-lg ${status === 'active' ? 'bg-white text-purple-700' : 'bg-green-400 text-green-900'}">
          ${status}
        </span>
      </div>
    </div>
    <div class="absolute -right-4 -bottom-4 opacity-10 text-8xl"><ion-icon name="person"></ion-icon></div>
  </div>

  <div class="grid grid-cols-3 gap-3">
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
      <p class="font-bold text-gray-800">${booking.event.returnDate}</p>
    </div>
  </div>

  <div class="bg-gray-50 p-3 rounded-xl border border-dashed border-purple-200">
      <p class="text-[10px] uppercase text-gray-500 font-bold">Venue Location</p>
      <p class="text-sm font-medium text-gray-700">${booking.event.location || "Not specified"}</p>
  </div>

  <div>
    <h4 class="flex items-center gap-2 font-bold text-purple-800 mb-3">
      <ion-icon name="cart"></ion-icon> Rental Inventory
    </h4>
    <div class="space-y-2 max-h-48 overflow-y-auto pr-2">
      ${booking.items.map(i => `
        <div class="flex justify-between items-center bg-white border border-gray-100 p-3 rounded-xl shadow-sm">
          <div>
            <p class="font-bold text-gray-800">${i.name}</p>
            <p class="text-[10px] text-purple-600 font-bold">Qty: ${i.qty} @ ₦${(i.price || 0).toLocaleString()} per unit</p>
          </div>
          <span class="font-black text-gray-700">₦${(i.total || 0).toLocaleString()}</span>
        </div>
      `).join("")}
    </div>
  </div>

  <div class="bg-white border-2 border-purple-100 rounded-2xl p-4 shadow-inner">
    <div class="flex justify-between mb-2 text-xs font-bold text-gray-500">
       <span>METHOD: ${booking.payment?.method || "Not Set"}</span>
       <span>TOTAL: ₦${totalAmount.toLocaleString()}</span>
    </div>
    <div class="flex justify-between items-end">
       <div>
         <p class="text-xs text-gray-400">Amount Paid</p>
         <p class="text-xl font-black text-green-600">₦${amountPaid.toLocaleString()}</p>
       </div>
       <div class="text-right">
         <p class="text-xs text-gray-400">Outstanding</p>
         <p class="text-xl font-black ${balanceRemaining > 0 ? 'text-red-500' : 'text-green-500'}">
           ₦${balanceRemaining.toLocaleString()}
         </p>
       </div>
    </div>
  </div>

  ${booking.notes ? `
    <div class="bg-purple-50 p-4 rounded-xl border-l-4 border-purple-700">
      <p class="text-[10px] font-bold text-purple-700 uppercase mb-1">Internal Notes</p>
      <p class="text-xs text-gray-600 leading-relaxed">${booking.notes}</p>
    </div>` : ''}

  <div class="space-y-3">
    ${status === "active" && currentRole !== "viewer" ? `
      <div class="grid grid-cols-2 gap-2">
         <button class="py-3 bg-white border-2 border-purple-700 text-purple-700 rounded-xl font-black text-sm shadow-md" 
            onclick='openEditModal(${JSON.stringify(booking)}, "${id}", "${businessId}")'>EDIT BOOKING</button>
         <button class="py-3 bg-purple-700 text-white rounded-xl font-black text-sm shadow-lg" 
            onclick='returnBooking("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>MARK RETURNED</button>
      </div>
    ` : status === "returned" ? `<div class="p-4 bg-green-50 text-green-700 text-center font-bold rounded-xl border">✓ Items Returned</div>` : ""}
    
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
};

/* =========================
   EDIT MODAL (MATCHING ADD PAGE FIELDS)
========================= */
window.openEditModal = async function(booking, id, businessId) {
  const invSnap = await getDocs(collection(db, "businesses", businessId, "inventory"));
  const inventory = invSnap.docs.map(d => d.data());

  modalContent.innerHTML = `
<div class="space-y-5 p-1 animate__animated animate__slideInUp">
  <div class="border-b pb-2 flex justify-between items-center">
    <h3 class="text-xl font-black text-purple-800 uppercase tracking-tighter">Modify Booking</h3>
    <ion-icon name="create-outline" class="text-2xl text-purple-400"></ion-icon>
  </div>

  <div class="space-y-2">
    <label class="text-[10px] font-black text-purple-700 uppercase">Client Information</label>
    <input id="editName" type="text" value="${booking.client.name}" class="w-full p-3 bg-gray-50 border rounded-xl focus:ring-2 ring-purple-500" placeholder="Full Name">
    <div class="grid grid-cols-2 gap-2">
      <input id="editPhone" type="text" value="${booking.client.phone || ""}" class="p-3 bg-gray-50 border rounded-xl" placeholder="Phone">
      <input id="editEmail" type="email" value="${booking.client.email || ""}" class="p-3 bg-gray-50 border rounded-xl" placeholder="Email">
    </div>
  </div>

  <div class="space-y-2">
    <label class="text-[10px] font-black text-purple-700 uppercase">Event Details</label>
    <select id="editType" class="w-full p-3 bg-gray-50 border rounded-xl">
      <option ${booking.event.type==='Wedding'?'selected':''}>Wedding</option>
      <option ${booking.event.type==='Birthday'?'selected':''}>Birthday</option>
      <option ${booking.event.type==='Burial'?'selected':''}>Burial</option>
      <option ${booking.event.type==='Conference'?'selected':''}>Conference</option>
      <option ${booking.event.type==='Other'?'selected':''}>Other</option>
    </select>
    <div class="grid grid-cols-2 gap-2">
      <input id="editDate" type="date" value="${booking.event.date}" class="p-3 bg-gray-50 border rounded-xl text-sm">
      <input id="editReturn" type="date" value="${booking.event.returnDate}" class="p-3 bg-gray-50 border rounded-xl text-sm">
    </div>
    <input id="editLocation" type="text" value="${booking.event.location || ""}" class="w-full p-3 bg-gray-50 border rounded-xl" placeholder="Location">
  </div>

  <div class="space-y-2">
    <label class="text-[10px] font-black text-purple-700 uppercase">Payment Info</label>
    <div class="grid grid-cols-2 gap-2">
      <div><p class="text-[9px] text-gray-400">Total (₦)</p><input id="editTotal" type="number" value="${booking.payment?.total || 0}" class="w-full p-3 bg-gray-50 border rounded-xl font-bold"></div>
      <div><p class="text-[9px] text-gray-400">Paid (₦)</p><input id="editPaid" type="number" value="${booking.payment?.paid || 0}" class="w-full p-3 bg-gray-50 border rounded-xl font-bold text-green-600"></div>
    </div>
    <select id="editMethod" class="w-full p-3 bg-gray-50 border rounded-xl text-sm">
      <option ${booking.payment?.method==='Cash'?'selected':''}>Cash</option>
      <option ${booking.payment?.method==='Transfer'?'selected':''}>Transfer</option>
    </select>
  </div>

  <textarea id="editNotes" class="w-full p-3 bg-gray-50 border rounded-xl text-sm h-20" placeholder="Notes...">${booking.notes || ""}</textarea>

  <div class="flex gap-2 pt-2">
    <button class="flex-1 py-4 bg-purple-700 text-white rounded-2xl font-black shadow-lg" onclick='saveEdit("${id}", "${businessId}")'>SAVE UPDATES</button>
    <button class="px-6 py-4 bg-gray-100 rounded-2xl font-bold text-gray-400" onclick='closeModal()'>CANCEL</button>
  </div>
</div>`;
};

window.saveEdit = async function(id, businessId) {
  try {
    await updateDoc(doc(db, "businesses", businessId, "bookings", id), {
      "client.name": document.getElementById("editName").value,
      "client.phone": document.getElementById("editPhone").value,
      "client.email": document.getElementById("editEmail").value,
      "event.type": document.getElementById("editType").value,
      "event.date": document.getElementById("editDate").value,
      "event.returnDate": document.getElementById("editReturn").value,
      "event.location": document.getElementById("editLocation").value,
      "payment.total": Number(document.getElementById("editTotal").value),
      "payment.paid": Number(document.getElementById("editPaid").value),
      "payment.method": document.getElementById("editMethod").value,
      "notes": document.getElementById("editNotes").value
    });
    alert("Record Synced Successfully! ✅");
    closeModal();
  } catch (e) { alert("Error updating record: " + e.message); }
};

window.closeModal = function () {
  bookingModal.style.display = "none";
  document.body.style.overflow = "";
};

/* =========================
   RENDER ROW
========================= */
function renderRow(b, id, businessId) {
  const overbooked = b.status === "active" && b.items?.some(i => i.shortage > 0);
  return `
    <tr class="hover:bg-gray-50 transition-colors cursor-pointer" onclick='openBooking(${JSON.stringify(b)}, "${id}", "${businessId}")'>
      <td class="font-medium text-gray-800">
        ${b.client.name}
        ${overbooked ? `<span class="ml-2 px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">Overbooked</span>` : ``}
      </td>
      <td class="text-gray-600">${b.event.date}</td>
      <td class="text-gray-600">${b.items.length} items</td>
      <td><span class="status ${b.status} text-xs uppercase tracking-wider">${b.status}</span></td>
      <td><button class="p-2 text-purple-600"><ion-icon name="eye-outline"></ion-icon></button></td>
    </tr>
  `;
}

/* =========================
   AUTH GUARD + LIVE DATA
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "signup.html"; return; }

  try {
    const businessId = await getBusinessIdByEmail(user.email);
    const tbody = document.getElementById("bookingsTable");
    const q = query(collection(db, "businesses", businessId, "bookings"), orderBy("createdAt", "desc"));

    onSnapshot(q, (snap) => {
      const allBookings = snap.docs.map(d => ({ id: d.id, data: d.data() }));

      function filterAndRender() {
        const status = document.getElementById("filterStatus").value;
        const date = document.getElementById("filterDate").value;
        const search = document.getElementById("searchInput").value.toLowerCase();
        tbody.innerHTML = "";

        const filtered = allBookings.filter(({ data }) => {
          return (!status || data.status === status) &&
                 (!date || data.event.date === date) &&
                 (!search || data.client.name.toLowerCase().includes(search));
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.6; padding: 40px;">No matching bookings found</td></tr>`;
          return;
        }
        filtered.forEach(({ id, data }) => { tbody.innerHTML += renderRow(data, id, businessId); });
      }

      document.getElementById("filterStatus").onchange = filterAndRender;
      document.getElementById("filterDate").onchange = filterAndRender;
      document.getElementById("searchInput").oninput = filterAndRender;
      filterAndRender();
    });
  } catch (err) { window.location.href = "setup.html"; }
});