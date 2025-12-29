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
function listenToRecentBookings(businessId) {
  const tbody = document.getElementById("recent-bookings");
  if (!tbody) return;

  const q = query(
    collection(db, "businesses", businessId, "bookings"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  onSnapshot(q, (snap) => {
    tbody.innerHTML = "";
    let hasEvent = false;

    snap.forEach(docSnap => {
      const b = docSnap.data();
      if (!isWithinThisWeek(b.event?.date)) return;

      hasEvent = true;

      tbody.innerHTML += `
        <tr class="hover:bg-gray-50 transition-colors">
          <td class="py-3 font-medium text-gray-800">${b.items?.[0]?.name || "-"}</td>
          <td class="py-3 text-gray-600">${b.client?.name || "-"}</td>
          <td class="py-3 text-gray-600">${b.items?.reduce((t, i) => t + i.qty, 0) || 0}</td>
          <td class="py-3">
            <span class="status ${b.status} text-xs uppercase tracking-wider">${b.status}</span>
          </td>
        </tr>
      `;
    });

    if (!hasEvent) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center; opacity:.6; padding: 20px;">
            No events scheduled for this week
          </td>
        </tr>
      `;
    }
  });
}

/* =========================
   RECENT INVENTORY (RIGHT CARD)
========================= */
function listenToRecentInventory(businessId) {
  const tbody = document.getElementById("recent-customers");
  if (!tbody) return;

  const q = query(
    collection(db, "businesses", businessId, "inventory"),
    orderBy("createdAt", "desc"),
    limit(8)
  );

  onSnapshot(q, (snap) => {
    tbody.innerHTML = "";

    if (snap.empty) {
      tbody.innerHTML = `<tr><td style="text-align:center; opacity:.6; padding: 20px;">No inventory items yet</td></tr>`;
      return;
    }

    snap.forEach(docSnap => {
      const i = docSnap.data();
      const isLow = i.availableQuantity <= 5;

      tbody.innerHTML += `
        <tr class="hover:bg-gray-50 transition-colors">
          <td class="py-3 px-4">
            <div class="flex justify-between items-center">
              <div>
                <h4 class="font-bold text-gray-800">${i.name}</h4>
                <p class="text-xs text-gray-500">₦${i.price || 0} per unit</p>
              </div>
              <div class="text-right">
                <span class="text-sm font-semibold ${isLow ? 'text-red-600' : 'text-purple-600'}">
                  ${i.availableQuantity} left
                </span>
                ${isLow ? '<br><span class="text-[10px] bg-red-100 text-red-600 px-1 rounded uppercase font-bold">Low Stock</span>' : ''}
              </div>
            </div>
          </td>
        </tr>
      `;
    });
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
    listenToRecentBookings(businessId);
    listenToRecentInventory(businessId);
  } catch (err) {
    console.error("Dashboard error:", err);
    alert("Failed to load dashboard");
  }
});
