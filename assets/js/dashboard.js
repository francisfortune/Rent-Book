// assets/js/dashboard.js
import { auth, db } from "./firebase.js";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
   BUSINESS LOOKUP
========================= */
async function getBusinessIdByEmail(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );

  const snap = await getDocs(q);

  if (snap.empty) throw new Error("No business linked");

  return snap.docs[0].data().businessId;
}

/* =========================
   LOAD DASHBOARD
========================= */
async function loadDashboard(businessId, user) {
  const businessSnap = await getDoc(doc(db, "businesses", businessId));

  if (!businessSnap.exists()) {
    throw new Error("Business not found");
  }

  const business = businessSnap.data();

  document.getElementById("welcome-text").textContent =
    `Welcome to ${business.name}`;

  document.getElementById("brand-name").textContent = business.name;
  document.getElementById("brand-name-mobile").textContent = business.name;

  // placeholders (future)
  document.getElementById("total-inventory").textContent = "0";
  document.getElementById("active-bookings").textContent = "0";
  document.getElementById("returned-bookings").textContent = "0";
  document.getElementById("overdue-bookings").textContent = "0";
}

/* =========================
   AUTH GUARD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const businessId = await getBusinessIdByEmail(user.email);
    await loadDashboard(businessId, user);
  } catch (err) {
    console.error("Dashboard load failed:", err);
    window.location.href = "setup.html";
  }
});
