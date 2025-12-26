import { auth, db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from
"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { doc, getDoc } from
"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  const businessId = userSnap.data().businessId;

  loadBookings(businessId);
});

async function loadBookings(businessId) {
  const bookingsRef = collection(
    db,
    "businesses",
    businessId,
    "bookings"
  );

  const q = query(bookingsRef, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  const table = document.getElementById("bookingsTable");
  table.innerHTML = "";

  if (snap.empty) {
    table.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;">
          No bookings yet
        </td>
      </tr>
    `;
    return;
  }

  snap.forEach(docSnap => {
    const b = docSnap.data();

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.clientName}</td>
      <td>${b.date}</td>
      <td>${b.items?.length || 0}</td>
      <td>
        <span class="status ${b.status}">
          ${b.status}
        </span>
      </td>
      <td>
        <a href="edit-booking.html?id=${docSnap.id}">
          Edit
        </a>
      </td>
    `;
    table.appendChild(tr);
  });
}
