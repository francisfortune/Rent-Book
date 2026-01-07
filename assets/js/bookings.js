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
/* =========================
   INVENTORY RESTORE (FIXED)
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

    // ✅ Restore ONLY what came from your inventory
    const restorableQty = Math.max(0, item.qty - (item.shortage || 0));

    if (restorableQty === 0) continue;

    await updateDoc(match.ref, {
      availableQuantity:
        match.data().availableQuantity + restorableQty
    });
  }
}

/* =========================
   RETURN BOOKING
========================= */
/* =========================
   RETURN BOOKING (FIXED)
========================= */
window.returnBooking = async function (bookingId, businessId, items) {
  // 🔶 Overbooking reminder
  const hasBorrowedItems = items.some(i => i.shortage > 0);

  if (hasBorrowedItems) {
    const confirmBorrowReturn = confirm(
      "This booking was overbooked.\nHave you returned borrowed items to the vendor?"
    );
    if (!confirmBorrowReturn) return;
  }

  if (!confirm("Mark this booking as returned?")) return;

  // Update booking
  await updateDoc(
    doc(db, "businesses", businessId, "bookings", bookingId),
    { status: "returned" }
  );

  // Restore inventory
  await restoreInventory(businessId, items);

  // Close modal
  closeModal();

  alert("Booking marked as returned successfully");
};

// window.deleteBooking = async function (bookingId, businessId) {
//   if (!confirm("Are you sure you want to delete this booking? This will NOT restore inventory automatically. Continue?")) return;

//   await deleteDoc(doc(db, "businesses", businessId, "bookings", bookingId));
//   closeModal();
// };

/* =========================
   OPEN MODAL
========================= */
window.openBooking = function (booking, id, businessId) {
  modalTitle.textContent = booking.client.name;

  bookingModal.style.display = "flex";
document.body.style.overflow = "hidden";

  // Calculate balance remaining
  const totalAmount = booking.payment?.total || 0;
  const amountPaid = booking.payment?.paid || 0;
  const balanceRemaining = totalAmount - amountPaid;
  const paymentStatus = balanceRemaining <= 0 ? 'Fully Paid' : `₦${balanceRemaining.toLocaleString()} remaining`;
  const paymentStatusClass = balanceRemaining <= 0 ? 'text-green-600' : 'text-orange-600';

modalContent.innerHTML = `
<div class="space-y-6">

  <!-- CLIENT HEADER -->
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-lg font-bold">${booking.client.name}</h3>
      <p class="text-sm text-gray-500">${booking.client.phone || ""}</p>
    </div>
    <span class="px-3 py-1 rounded-full text-xs font-semibold ${
      booking.status === "active"
        ? "bg-purple-100 text-purple-700"
        : "bg-green-100 text-green-700"
    }">
      ${booking.status}
    </span>
  </div>

  <!-- DATES -->
  <div class="grid grid-cols-2 gap-3 text-sm">
    <div class="bg-gray-50 p-3 rounded-lg">
      <p class="text-xs text-gray-500">Event</p>
      <p class="font-medium">${booking.event.date}</p>
    </div>
    <div class="bg-gray-50 p-3 rounded-lg">
      <p class="text-xs text-gray-500">Return</p>
      <p class="font-medium">${booking.event.returnDate}</p>
    </div>
  </div>

  <!-- ITEMS -->
  <div>
    <h4 class="font-semibold mb-2">Items</h4>
    <div class="space-y-2">
      ${booking.items.map(i => `
        <div class="flex justify-between bg-gray-50 p-3 rounded-lg text-sm">
          <span>${i.name} × ${i.qty}</span>
          <span>₦${i.total.toLocaleString()}</span>
        </div>
      `).join("")}
    </div>
  </div>

  <!-- OVERBOOK ALERT -->
  ${booking.items.some(i => i.shortage > 0) ? `
    <div class="p-4 bg-orange-50 border border-orange-200 rounded-xl">
      <p class="font-semibold text-orange-700 mb-1">Overbooked</p>
      ${booking.items.filter(i => i.shortage > 0)
        .map(i => `<p class="text-sm">Borrow ${i.shortage} × ${i.name}</p>`)
        .join("")}
    </div>
  ` : ""}

  <!-- PAYMENT -->
  <div class="grid grid-cols-3 gap-2 text-center">
    <div class="bg-gray-50 p-3 rounded-lg">
      <p class="text-xs">Total</p>
      <p class="font-bold">₦${totalAmount.toLocaleString()}</p>
    </div>
    <div class="bg-gray-50 p-3 rounded-lg">
      <p class="text-xs">Paid</p>
      <p class="font-bold text-green-600">₦${amountPaid.toLocaleString()}</p>
    </div>
    <div class="bg-gray-50 p-3 rounded-lg">
      <p class="text-xs">Balance</p>
      <p class="font-bold ${
        balanceRemaining <= 0 ? "text-green-600" : "text-orange-600"
      }">
        ₦${balanceRemaining.toLocaleString()}
      </p>
    </div>
  </div>

  ${booking.notes ? `
  <hr class="my-4">
  <div>
    <h4 class="font-bold mb-1">Notes</h4>
    <p class="text-gray-700 text-sm whitespace-pre-line">
      ${booking.notes}
    </p>
  </div>
` : ''}


  <!-- ACTION -->
  ${booking.status === "active" ? `
    <button
      class="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold"
      onclick='returnBooking("${id}", "${businessId}", ${JSON.stringify(booking.items)})'>
      Mark as Returned
    </button>
  ` : ""}

</div>
    </div>
  `;

  bookingModal.style.display = "flex";
};
window.closeModal = function () {
  bookingModal.style.display = "none";
  document.body.style.overflow = "";
};
bookingModal.addEventListener("click", (e) => {
  if (e.target === bookingModal) {
    closeModal();
  }
});

/* =========================
   LOAD BOOKINGS
========================= */
function renderRow(b, id, businessId) {
 const overbooked =
  b.status === "active" &&
  b.items?.some(i => i.shortage > 0);

  return `
    <tr class="hover:bg-gray-50 transition-colors">
      <td class="font-medium text-gray-800">
        ${b.client.name}
        ${overbooked ? `
          <span class="ml-2 px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">
            Overbooked
          </span>
        ` : ``}
      </td>

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
