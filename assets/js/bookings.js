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
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
   BUSINESS LOOKUP
========================= */
async function getBusinessIdByEmail(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("No business");
  return snap.docs[0].data().businessId;
}
function setUserAvatar(businessName) {
  const avatar = document.getElementById("user-avatar");
  if (!avatar || !businessName) return;

  avatar.textContent = businessName.charAt(0).toUpperCase();
}


/* =========================
   INVENTORY RESTORE (ON RETURN)
========================= */
async function restoreInventory(businessId, items) {
  const invSnap = await getDocs(
    collection(db, "businesses", businessId, "inventory")
  );

  for (const item of items) {
    const match = invSnap.docs.find(d =>
      d.data().name.toLowerCase() === item.name.toLowerCase()
    );

    if (!match) continue;

    await updateDoc(match.ref, {
      availableQuantity:
        match.data().availableQuantity + item.qty
    });
  }
}

/* =========================
   RETURN BOOKING
========================= */
window.returnBooking = async function (bookingId, businessId, items) {
  if (!confirm("Mark this booking as returned?")) return;

  await updateDoc(
    doc(db, "businesses", businessId, "bookings", bookingId),
    { status: "returned" }
  );

  await restoreInventory(businessId, items);
};

window.deleteBooking = async function (bookingId, businessId) {
  if (!confirm("Are you sure you want to delete this booking? This will NOT restore inventory automatically. Continue?")) return;

  await deleteDoc(doc(db, "businesses", businessId, "bookings", bookingId));
  closeModal();
};

/* =========================
   OPEN MODAL
========================= */
window.openBooking = function (booking, id, businessId) {
  modalTitle.textContent = booking.client.name;

  // Calculate balance remaining
  const totalAmount = booking.payment?.total || 0;
  const amountPaid = booking.payment?.paid || 0;
  const balanceRemaining = totalAmount - amountPaid;
  const paymentStatus = balanceRemaining <= 0 ? 'Fully Paid' : `₦${balanceRemaining.toLocaleString()} remaining`;
  const paymentStatusClass = balanceRemaining <= 0 ? 'text-green-600' : 'text-orange-600';

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <p><b>Phone:</b><br> ${booking.client.phone || "-"}</p>
        <p><b>Event Date:</b><br> ${booking.event.date}</p>
        <p><b>Return Date:</b><br> ${booking.event.returnDate}</p>
        <p><b>Location:</b><br> ${booking.event.location || "-"}</p>
      </div>

      <hr class="my-4">

      <h4 class="font-bold mb-2">Items</h4>
      <ul class="list-disc pl-5">
        ${booking.items.map(i =>
    `<li>${i.name} × ${i.qty} — ₦${i.total?.toLocaleString() || 0}</li>`
  ).join("")}
      </ul>

      <hr class="my-4">

      <!-- Payment Tracking Section -->
      <div class="bg-gray-50 rounded-xl p-4 space-y-3">
        <h4 class="font-bold text-gray-800">Payment Details</h4>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="bg-white rounded-lg p-3 shadow-sm">
            <p class="text-xs text-gray-500 uppercase tracking-wide">Total</p>
            <p class="text-lg font-bold text-gray-800">₦${totalAmount.toLocaleString()}</p>
          </div>
          <div class="bg-white rounded-lg p-3 shadow-sm">
            <p class="text-xs text-gray-500 uppercase tracking-wide">Paid</p>
            <p class="text-lg font-bold text-green-600">₦${amountPaid.toLocaleString()}</p>
          </div>
          <div class="bg-white rounded-lg p-3 shadow-sm">
            <p class="text-xs text-gray-500 uppercase tracking-wide">Balance</p>
            <p class="text-lg font-bold ${paymentStatusClass}">₦${balanceRemaining.toLocaleString()}</p>
          </div>
        </div>
        <div class="text-center">
          <span class="inline-block px-3 py-1 rounded-full text-sm font-medium ${balanceRemaining <= 0 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}">
            ${paymentStatus}
          </span>
        </div>
      </div>

      ${booking.receiptImage ? `
        <div class="mt-4">
          <h4 class="font-bold mb-2">Receipt</h4>
          <img src="${booking.receiptImage}" alt="Receipt" class="w-full max-h-64 object-contain rounded-lg border cursor-pointer" onclick="window.open('${booking.receiptImage}', '_blank')">
        </div>
      ` : ''}

      <hr class="my-4">

      <div class="flex justify-between items-center">
        <span class="status ${booking.status}">${booking.status}</span>
        <span class="text-sm text-gray-500">Payment: ${booking.payment?.method || 'N/A'}</span>
      </div>

      <div class="mt-6 flex gap-3">
        <button class="flex-1 py-2 bg-red-50 text-red-600 rounded-lg font-medium border border-red-100 hover:bg-red-100 transition-all" 
          onclick='deleteBooking("${id}", "${businessId}")'>
          Delete Booking
        </button>
        ${booking.status === 'active' ? `
          <button class="flex-[2] py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-all"
            onclick='returnBooking("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>
            Mark as Returned
          </button>
        ` : ''}
      </div>
    </div>
  `;

  bookingModal.style.display = "flex";
};
window.closeModal = function () {
  document.getElementById("bookingModal").style.display = "none";
};
/* =========================
   LOAD BOOKINGS
========================= */
function renderRow(b, id, businessId) {
  return `
    <tr class="hover:bg-gray-50 transition-colors">
      <td class="font-medium text-gray-800">${b.client.name}</td>
      <td class="text-gray-600">${b.event.date}</td>
      <td class="text-gray-600">${b.items.length} items</td>
      <td>
        <span class="status ${b.status} text-xs uppercase tracking-wider">
          ${b.status}
        </span>
      </td>
      <td>
        <button class="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-all"
          onclick='openBooking(${JSON.stringify(b)}, "${id}", "${businessId}")'>
          <ion-icon name="eye-outline" size="small"></ion-icon>
        </button>
      </td>
    </tr>
  `;
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

    const q = query(
      collection(db, "businesses", businessId, "bookings"),
      orderBy("createdAt", "desc")
    );

    onSnapshot(q, (snap) => {
      const allBookings = snap.docs.map(d => ({ id: d.id, data: d.data() }));

      function filterAndRender() {
        const status = document.getElementById("filterStatus").value;
        const date = document.getElementById("filterDate").value;
        const search = document.getElementById("searchInput").value.toLowerCase();

        tbody.innerHTML = "";

        const filtered = allBookings.filter(({ data }) => {
          const matchStatus = !status || data.status === status;
          const matchDate = !date || data.event.date === date;
          const matchSearch = !search || data.client.name.toLowerCase().includes(search);
          return matchStatus && matchDate && matchSearch;
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.6; padding: 40px;">No matching bookings found</td></tr>`;
          return;
        }

        filtered.forEach(({ id, data }) => {
          tbody.innerHTML += renderRow(data, id, businessId);
        });
      }

      // Re-filter when inputs change
      document.getElementById("filterStatus").onchange = filterAndRender;
      document.getElementById("filterDate").onchange = filterAndRender;
      document.getElementById("searchInput").oninput = filterAndRender;

      filterAndRender();
    });

  } catch (err) {
    console.error("Booking load failed:", err);
    window.location.href = "setup.html";
  }
});
