import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  updateDoc,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
   HELPERS
========================= */
function safeSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setUserAvatar(businessName) {
  const avatar = document.getElementById("user-avatar");
  if (!avatar || !businessName) return;
  avatar.textContent = businessName.charAt(0).toUpperCase();
}

function isWithinThisWeek(dateValue) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return d >= start && d <= end;
}

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

/* =========================
   LOAD DASHBOARD UI
========================= */
async function loadDashboardUI(businessId) {
  const snap = await getDoc(doc(db, "businesses", businessId));
  if (!snap.exists()) throw new Error("Business not found");

  const business = snap.data();

  safeSetText("welcome-text", `${business.name}`);
  safeSetText("brand-name", business.name);
  safeSetText("brand-name-mobile", business.name);
  setUserAvatar(business.name);
}

/* =========================
   INVENTORY COUNT (REALTIME)
========================= */
function listenToInventoryCount(businessId) {
  const ref = collection(db, "businesses", businessId, "inventory");
  onSnapshot(ref, snap => {
    safeSetText("total-inventory", snap.size);
  });
}

/* =========================
   BOOKING STATS + AUTO-REPAIR
========================= */
function listenToBookingStats(businessId) {
  const ref = collection(db, "businesses", businessId, "bookings");

  onSnapshot(ref, async snap => {
    let active = 0;
    let returned = 0;
    let overdue = 0;
    const now = new Date();

    for (const d of snap.docs) {
      const b = d.data();

      /* 🔧 AUTO-REPAIR */
      if (!b.status) {
        await updateDoc(d.ref, { status: "active" });
        active++;
        continue;
      }

      if (!b.createdAt) {
        await updateDoc(d.ref, { createdAt: new Date() });
      }

      /* ⏰ OVERDUE CHECK */
      if (
        b.status === "active" &&
        b.event?.returnDate
      ) {
        const r = new Date(b.event.returnDate);
        if (now > r) {
          await updateDoc(d.ref, { status: "overdue" });
          overdue++;
          continue;
        }
      }

      if (b.status === "active") active++;
      else if (b.status === "returned") returned++;
      else if (b.status === "overdue") overdue++;
    }

    safeSetText("active-bookings", active);
    safeSetText("returned-bookings", returned);
    safeSetText("overdue-bookings", overdue);
  });
}

/* =========================
   RECENT BOOKINGS (THIS WEEK)
========================= */
async function loadRecentBookings(businessId) {
  const tbody = document.getElementById("recent-bookings");
  if (!tbody) return;

  const q = query(
    collection(db, "businesses", businessId, "bookings"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  const snap = await getDocs(q);
  tbody.innerHTML = "";

  let hasEvent = false;

  snap.forEach(docSnap => {
    const b = docSnap.data();
    if (!isWithinThisWeek(b.event?.date)) return;

    hasEvent = true;

    tbody.innerHTML += `
      <tr>
        <td>${b.items?.[0]?.name || "-"}</td>
        <td>${b.client?.name || "-"}</td>
        <td>${b.items?.reduce((t,i)=>t+i.qty,0) || 0}</td>
        <td>
          <span class="status inProgress">active</span>
        </td>
      </tr>
    `;
  });

  if (!hasEvent) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; opacity:.6;">
          No events for this week
        </td>
      </tr>
    `;
  }
}

/* =========================
   RECENT INVENTORY (RIGHT CARD)
========================= */
async function loadRecentInventory(businessId) {
  const tbody = document.getElementById("recent-customers");
  if (!tbody) return;

  const q = query(
    collection(db, "businesses", businessId, "inventory"),
    orderBy("createdAt", "desc"),
    limit(5)
  );

  const snap = await getDocs(q);
  tbody.innerHTML = "";

  if (snap.empty) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" style="text-align:center; opacity:.6;">
          No items yet
        </td>
      </tr>
    `;
    return;
  }

  snap.forEach(docSnap => {
    const i = docSnap.data();
    tbody.innerHTML += `
      <tr>
        <td>
          <h4>
            ${i.name}<br>
            <span>₦${i.price || 0} per unit</span>
          </h4>
        </td>
      </tr>
    `;
  });
}

/* =========================
   AUTH GUARD
========================= */
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  let businessId;

  try {
    businessId = await getBusinessIdByEmail(user.email);
  } catch {
    window.location.href = "setup.html";
    return;
  }

  try {
    await loadDashboardUI(businessId);
    listenToInventoryCount(businessId);
    listenToBookingStats(businessId);
    await loadRecentBookings(businessId);
    await loadRecentInventory(businessId);
  } catch (err) {
    console.error("Dashboard error:", err);
    alert("Failed to load dashboard");
  }
});
