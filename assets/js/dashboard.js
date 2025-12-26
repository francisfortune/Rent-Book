import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =====================
   AUTH GUARD
===================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const businessId = await getUserBusinessId(user.uid);
    await loadDashboard(businessId, user);
  } catch (err) {
    console.error(err);
    alert("No business found. Redirecting to setup.");
    window.location.href = "setup.html";
  }
});

/* =====================
   GET USER BUSINESS
===================== */
async function getUserBusinessId(uid) {
  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists()) throw new Error("User doc missing");

  const data = userSnap.data();

  if (!data.businessId) throw new Error("User has no business");

  return data.businessId;
}

/* =====================
   LOAD DASHBOARD
===================== */
async function loadDashboard(businessId, user) {
  const businessRef = doc(db, "businesses", businessId);
  const businessSnap = await getDoc(businessRef);

  if (!businessSnap.exists()) {
    throw new Error("Business not found");
  }

  const business = businessSnap.data();

  // 🔤 Avatar letter
  document.querySelector(".user div").textContent =
    business.name.charAt(0).toUpperCase();

  // 🏷 Brand name
  document.getElementById("brand-name-mobile").textContent = business.name;

  // 👋 Welcome text
  document.getElementById("welcome-text").textContent =
    `Welcome back, ${user.displayName || "Partner"} `;

  // 📦 Inventory summary
  loadInventorySummary(business.inventory || []);

  // 📅 Recent bookings
  await loadRecentBookings(businessId);
}

/* =====================
   INVENTORY SUMMARY
===================== */
function loadInventorySummary(inventory) {
  let totalItems = 0;

  inventory.forEach(item => {
    totalItems += Number(item.quantity || 0);
  });

  document.querySelectorAll(".numbers")[0].textContent = inventory.length;
  document.querySelectorAll(".numbers")[1].textContent = totalItems;
}

/* =====================
   RECENT BOOKINGS
===================== */
async function loadRecentBookings(businessId) {
  const bookingsRef = collection(
    db,
    "businesses",
    businessId,
    "bookings"
  );

  const q = query(
    bookingsRef,
    orderBy("createdAt", "desc"),
    limit(5)
  );

  const snap = await getDocs(q);
  const tbody = document.querySelector(".recentOrders tbody");

  tbody.innerHTML = "";

  if (snap.empty) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;">
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
      <td>${b.itemName || "-"}</td>
      <td>${b.clientName || "-"}</td>
      <td>${b.paid ? "Paid" : "Pending"}</td>
      <td>
        <span class="status ${b.status || "pending"}">
          ${b.status || "Pending"}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
