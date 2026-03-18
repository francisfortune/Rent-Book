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
    let overbooked = 0;
    const now = new Date();

    for (const d of snap.docs) {
      const b = d.data();

      if (
        b.status === "active" &&
        b.items?.some(i => Number(i.shortage) > 0)
      ) {
        overbooked++;
      }

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

    const el = document.getElementById("overbooked-bookings");
    if (el) el.textContent = overbooked;

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
  <td class="py-3 font-medium text-gray-800">${b.event?.date ? new Date(b.event.date).toLocaleDateString() : "-"}</td>
  <td class="py-3 text-gray-600">${b.client?.name || "-"}</td>
  <td class="py-3 text-gray-600">${b.event?.location || "-"}</td>
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
   REAL-TIME INVENTORY (SORTED NEWEST FIRST)
   + LOW STOCK HIGHLIGHT
========================= */
function listenToInventory(businessId) {
  const tbody = document.getElementById("recent-customers");
  const totalInventoryEl = document.getElementById("total-inventory");
  if (!tbody || !totalInventoryEl) return;

  const ref = collection(db, "businesses", businessId, "inventory");
  const q = query(ref, orderBy("createdAt", "desc")); // newest first

  onSnapshot(q, snap => {
    // Update total inventory count
    totalInventoryEl.textContent = snap.size;

    // Update table
    tbody.innerHTML = "";

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; opacity:.6; padding: 20px;">No inventory items yet</td></tr>`;
      return;
    }

    snap.forEach(docSnap => {
      const i = docSnap.data();
      const isLow = i.availableQuantity <= 5; // 🔥 low stock highlight

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
    listenToInventory(businessId);
    
    // 🔔 Notifications history with modal
    listenToNotifications(businessId);
  } catch (err) {
    console.error("Dashboard error:", err);
    alert("Failed to load dashboard");
  }
});

/* =========================
   NOTIFICATIONS HISTORY MODAL
========================= */
function listenToNotifications(businessId) {
  const ref = collection(db, "businesses", businessId, "notifications");
  const dot = document.getElementById("notifDot");
  const notifList = document.getElementById("notifList");
  const modal = document.getElementById("notifModal");

  if (!dot || !notifList || !modal) return;

  onSnapshot(ref, snapshot => {
    const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const hasUnread = notifications.some(n => n.read === false);
    dot.style.display = hasUnread ? "block" : "none";

    if (notifications.length === 0) {
      notifList.innerHTML = '<p style="text-align:center; color: #888;">No notifications yet</p>';
    } else {
      notifList.innerHTML = notifications.map(n => `
        <div style="padding:8px 10px; border-bottom:1px solid #eee; cursor:pointer; background:${n.read ? '#fff' : '#f9f0ff'};">
          ${n.message}
        </div>
      `).join('');
    }
  });

  document.getElementById("notifBtn").addEventListener("click", () => {
    modal.style.display = modal.style.display === "none" ? "block" : "none";
  });
}

/* =========================
   BUY ME A COFFEE BUTTON
========================= */
(function() {
  const bmcLink = "https://www.buymeacoffee.com/francisfortune";

  const coffeeBtn = document.createElement("button");
  coffeeBtn.id = "buyCoffeeBtn";
  coffeeBtn.innerHTML = "☕ Support Me";
  coffeeBtn.style.position = "fixed";
  coffeeBtn.style.bottom = "80px";
  coffeeBtn.style.right = "20px";
  coffeeBtn.style.background = "Purple";
  coffeeBtn.style.color = "#fff";
  coffeeBtn.style.padding = "0.7rem 1.5rem";
  coffeeBtn.style.fontWeight = "700";
  coffeeBtn.style.borderRadius = "50px";
  coffeeBtn.style.border = "none";
  coffeeBtn.style.cursor = "pointer";
  coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
  coffeeBtn.style.zIndex = "9999";
  coffeeBtn.style.display = "flex";
  coffeeBtn.style.alignItems = "center";
  coffeeBtn.style.justifyContent = "center";
  coffeeBtn.style.transition = "transform 0.3s, box-shadow 0.3s";
  coffeeBtn.style.fontSize = "1.3rem";

  coffeeBtn.onmouseover = () => {
    coffeeBtn.style.transform = "translateY(-6px)";
    coffeeBtn.style.boxShadow = "0 12px 24px rgba(0,0,0,0.35)";
  };
  coffeeBtn.onmouseout = () => {
    coffeeBtn.style.transform = "translateY(0)";
    coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
  };

  const style = document.createElement("style");
  style.innerHTML = `
    @keyframes floatButton {
      0% { transform: translateY(0px); }
      50% { transform: translateY(-8px); }
      100% { transform: translateY(0px); }
    }
    #buyCoffeeBtn {
      animation: floatButton 3s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);

  function updateBtnSize() {
    if (window.innerWidth < 768) {
      coffeeBtn.style.padding = "0.5rem 1.3rem";
      coffeeBtn.style.fontSize = "1.4rem";
      coffeeBtn.style.bottom = "130px";
      coffeeBtn.style.right = "15px";
    } else {
      coffeeBtn.style.padding = "0.7rem 1.5rem";
      coffeeBtn.style.fontSize = "1rem";
      coffeeBtn.style.bottom = "80px";
      coffeeBtn.style.right = "20px";
    }
  }
  window.addEventListener("resize", updateBtnSize);
  updateBtnSize();

  document.body.appendChild(coffeeBtn);

  coffeeBtn.addEventListener("click", () => {
    const popupWidth = 500;
    const popupHeight = 700;
    const left = (window.innerWidth / 2) - (popupWidth / 2);
    const top = (window.innerHeight / 2) - (popupHeight / 2);

    window.open(
      bmcLink,
      "BuyMeACoffee",
      `width=${popupWidth},height=${popupHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`
    );
  });

  coffeeBtn.title = `
Hi! I'm Francis Fortune.
I’m passionate about motivating young teens to explore technology, learn new skills, and create innovative solutions.
`;
})();