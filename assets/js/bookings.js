import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  onSnapshot,
  doc,
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

/* =========================
   OPEN MODAL
========================= */
window.openBooking = function (booking) {
  modalTitle.textContent = booking.client.name;

  modalContent.innerHTML = `
    <p><b>Phone:</b> ${booking.client.phone || "-"}</p>
    <p><b>Event Date:</b> ${booking.event.date}</p>
    <p><b>Return Date:</b> ${booking.event.returnDate}</p>
    <p><b>Location:</b> ${booking.event.location || "-"}</p>

    <hr>

    <h4>Items</h4>
    <ul>
      ${booking.items.map(i =>
        `<li>${i.name} × ${i.qty} — ₦${i.total}</li>`
      ).join("")}
    </ul>

    <hr>

    <p><b>Total:</b> ₦${booking.payment.total}</p>
    <p><b>Status:</b> ${booking.status}</p>
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
    <tr>
      <td>${b.client.name}</td>
      <td>${b.event.date}</td>
      <td>${b.items.length}</td>
      <td>
        <span class="status ${b.status}">
          ${b.status}
        </span>
      </td>
      <td>
        <button class="btn"
          onclick='openBooking(${JSON.stringify(b)})'>
          View
        </button>

        ${
          b.status === "active"
            ? `<button class="btn danger"
                onclick='returnBooking("${id}", "${businessId}", ${JSON.stringify(b.items)})'>
                Return
              </button>`
            : ""
        }
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
      tbody.innerHTML = "";

      if (snap.empty) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5"
              style="text-align:center; opacity:0.6;">
              No bookings yet
            </td>
          </tr>
        `;
        return;
      }

      snap.forEach(d => {
        tbody.innerHTML += renderRow(
          d.data(),
          d.id,
          businessId
        );
      });
    });

  } catch (err) {
    console.error("Booking load failed:", err);
    window.location.href = "setup.html";
  }
});
