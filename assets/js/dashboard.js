import { auth, db } from "./firebase.js";
import { sendPush } from "./onesignal.js";
import { getBusinessIdByEmail } from "./shared.js";


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
  limit,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getMessaging, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { runAutomatedChecks } from "./services/reminderService.js";

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
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return d >= start && d <= end;
}

/* =========================
   BUSINESS LOOKUP
========================= */


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
   INVENTORY COUNT
========================= */
function listenToInventoryCount(businessId) {
  const ref = collection(db, "businesses", businessId, "inventory");
  onSnapshot(ref, snap => {
    safeSetText("total-inventory", snap.size);
  });
}

// // Open/close notification modal
// const notifBtn = document.getElementById("notifBtn");
// const notifModal = document.getElementById("notifModal");

// if (notifBtn && notifModal) {
//   notifBtn.addEventListener("click", () => {
//     const isVisible = notifModal.style.display === "block";
//     notifModal.style.display = isVisible ? "none" : "block";
//   });

//   // Optional: close modal if clicked outside
//   document.addEventListener("click", (e) => {
//     if (!notifModal.contains(e.target) && e.target !== notifBtn) {
//       notifModal.style.display = "none";
//     }
//   });
// }

/* =========================
   BOOKING STATS
========================= */
function listenToBookingStats(businessId) {
  const ref = collection(db, "businesses", businessId, "bookings");

  onSnapshot(ref, async snap => {
    let active = 0;
    let returned = 0;
    let overdue = 0;
    let overbooked = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const d of snap.docs) {
      const b = d.data();
      let currentStatus = b.status;

      if (currentStatus !== "returned" && b.items?.some(i => Number(i.shortage) > 0)) overbooked++;

      if (!currentStatus) {
        currentStatus = "active";
        await updateDoc(d.ref, { status: "active" });
      }
      if (!b.createdAt) {
        await updateDoc(d.ref, { createdAt: serverTimestamp() });
      }

      if (currentStatus !== "returned" && b.event?.returnDate) {
        const rDate = new Date(b.event.returnDate);
        rDate.setHours(0, 0, 0, 0);
        if (today > rDate && currentStatus !== "overdue") {
          await updateDoc(d.ref, { status: "overdue" });
          currentStatus = "overdue";
        } else if (today <= rDate && currentStatus === "overdue") {
          await updateDoc(d.ref, { status: "active" });
          currentStatus = "active";
        }
      }

      if (currentStatus === "active") active++;
      else if (currentStatus === "returned") returned++;
      else if (currentStatus === "overdue") overdue++;
    }

    safeSetText("overbooked-bookings", overbooked);
    safeSetText("active-bookings", active);
    safeSetText("returned-bookings", returned);
    safeSetText("overdue-bookings", overdue);
  });
}

/* =========================
   RECENT BOOKINGS
========================= */
function listenToRecentBookings(businessId) {
  const tbody = document.getElementById("recent-bookings");
  if (!tbody) return;

  const q = query(
    collection(db, "businesses", businessId, "bookings"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  onSnapshot(q, snap => {
    tbody.innerHTML = "";
    let hasEvent = false;

    snap.forEach(docSnap => {
      const b = docSnap.data();
      if (!isWithinThisWeek(b.event?.date)) return;
      hasEvent = true;
tbody.innerHTML += `
  <tr class="hover:bg-gray-50 border-b border-gray-100 transition-colors cursor-pointer">
    <td class="py-4 px-4 text-sm font-semibold text-gray-800">
      ${b.event?.date || "-"}
    </td>
    
    <td class="py-4 px-2 text-sm text-gray-600">
      <div class="flex flex-col">
        <span class="font-medium text-gray-800">${b.client?.name || "-"}</span>
        <span class="text-[10px] text-gray-400 opacity-80">${b.event?.location || "No Location"}</span>
      </div>
    </td>
    
    <td class="py-4 px-4 text-right">
      <span class="status ${b.status} px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm">
        ${b.status || "active"}
      </span>
    </td>
  </tr>`;
    });

    if (!hasEvent) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-5 opacity-60">No events scheduled for this week</td></tr>`;
    }
  });
}

/* =========================
   INVENTORY LIST
========================= */
function listenToInventory(businessId) {
  const tbody = document.getElementById("recent-customers");
  if (!tbody) return;

  const q = query(collection(db, "businesses", businessId, "inventory"), orderBy("createdAt", "desc"));

  onSnapshot(q, snap => {
    tbody.innerHTML = "";
    if (snap.empty) {
      tbody.innerHTML = `<tr><td class="text-center py-5 opacity-60">No items yet</td></tr>`;
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
                <p class="text-xs text-gray-500">₦${(i.price || 0).toLocaleString()}</p>
              </div>
              <div class="text-right">
                <span class="text-sm font-semibold ${isLow ? 'text-red-600' : 'text-purple-600'}">
                  ${i.availableQuantity} left
                </span>
                ${isLow ? '<br><span class="text-[10px] bg-red-100 text-red-600 px-1 rounded uppercase font-bold">Low Stock</span>' : ''}
              </div>
            </div>
          </td>
        </tr>`;
    });
  });
}

/* =========================
   AUTH GUARD
========================= */

function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(128, 0, 128, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

function showErrorBanner(message) {
  if (document.getElementById("errorBanner")) return;
  const banner = document.createElement("div");
  banner.id = "errorBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(220, 38, 38, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">error</span> Error: ${message}. Please refresh or try logging out.`;
  document.body.appendChild(banner);
}

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = "signup.html"; return; }
  try {
    const businessId = await getBusinessIdByEmail(user.email, user);
    if (!navigator.onLine) {
      showOfflineBanner();
    }
    
    // Trigger automated notification checks (throttled to 15 minutes)
    runAutomatedChecks(businessId).catch(err => console.error("Error running auto checks:", err));

    // Register service worker notification trigger
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data?.type === 'TRIGGER_AUTO_CHECKS') {
        runAutomatedChecks(businessId).catch(err => console.error(err));
      }
    });

    await loadDashboardUI(businessId);
    listenToInventoryCount(businessId);
    listenToBookingStats(businessId);
    listenToRecentBookings(businessId);
    listenToInventory(businessId);
    listenToNotifications(businessId);
  } catch (err) {
    console.error("Dashboard error:", err);
    if (!navigator.onLine || err.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else if (err.message === "NO_BUSINESS") {
      window.location.href = "setup.html";
    } else {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      showErrorBanner(err.message || err);
    }
  }



const messaging = getMessaging();

async function requestPushPermission() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const token = await getToken(messaging, {
      vapidKey: "YOUR_PUBLIC_VAPID_KEY"
    });

    console.log("FCM Token:", token);

    // SAVE token to Firestore for this user
    // db -> users/{uid}/fcmTokens
  } catch (err) {
    console.error("Push permission error:", err);
  }
}
});
// /* =========================
//    COFFEE BUTTON
// ========================= */
// (function() {
//   const coffeeBtn = document.createElement("button");
//   coffeeBtn.innerHTML = "☕ Support Me";
//   coffeeBtn.className = "animate-bounce";
//   Object.assign(coffeeBtn.style, {
//     position: "fixed", bottom: "80px", right: "20px", background: "Purple",
//     color: "#fff", padding: "12px 24px", fontWeight: "800", borderRadius: "50px",
//     zIndex: "9999", cursor: "pointer", border: "none", boxShadow: "0 10px 20px rgba(0,0,0,0.2)"
//   });
//   document.body.appendChild(coffeeBtn);
//   coffeeBtn.onclick = () => window.open("https://www.buymeacoffee.com/francisfortune", "_blank");
// })();

/* =========================
   LISTEN TO NOTIFICATIONS
========================= */
const notificationSound = new Audio("https://notificationsounds.com/storage/sounds/file-sounds-1150-pristine.mp3");

function triggerNotificationAlert() {
  // 🔊 Play sound
  notificationSound.play().catch(() => {});
  
  // 💥 Animate bell
  const btn = document.getElementById("notifBtn");
  if (btn) {
    btn.classList.add("shake");
    setTimeout(() => { btn.classList.remove("shake"); }, 600);
  }
}



function listenToNotifications(businessId) {
  const notifRef = collection(db, "businesses", businessId, "notifications");
  const q = query(notifRef, orderBy("createdAt", "desc"), limit(20));

  const dot = document.getElementById("notifDot");
  const notifList = document.getElementById("notifList");
  const modal = document.getElementById("notifModal");

  onSnapshot(q, snapshot => {
    const user = auth.currentUser;
    if (!user) return;

    const notifications = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(n => !(n.deletedFor || []).includes(user.uid));

    // UNREAD COUNT BADGE
    const unreadCount = notifications.filter(
      n => !(n.readBy || []).includes(user.uid)
    ).length;
    
    if (dot) {
      if (unreadCount > 0) {
        dot.style.display = "flex";
        dot.style.alignItems = "center";
        dot.style.justifyContent = "center";
        dot.textContent = unreadCount > 99 ? "99+" : unreadCount;
        dot.style.background = "purple";
        dot.style.color = "white";
        dot.style.width = "20px";
        dot.style.height = "20px";
        dot.style.borderRadius = "50%";
        dot.style.fontSize = "12px";
        dot.style.fontWeight = "bold";
        triggerNotificationAlert();
      } else {
        dot.style.display = "none";
      }
    }

    if (!notifList) return;

    if (notifications.length === 0) {
      notifList.innerHTML = `<p class="text-center text-gray-400 py-4">No notifications</p>`;
      return;
    }

    // RENDER NOTIFICATIONS
    notifList.innerHTML = notifications.map(n => {
      const isRead = n.readBy?.includes(user?.uid);

      let icon = "notifications-outline";
      if (n.type?.includes("booking")) icon = "calendar-outline";
      else if (n.type === "add") icon = "add-circle-outline";
      else if (n.type === "welcome") icon = "sparkles-outline";
      else if (n.type === "inventory") icon = "cube-outline";

      let bgColor = isRead ? "bg-green-50" : "bg-purple-50";
      let borderColor = isRead ? "border-green-200" : "border-purple-300";
      let textWeight = isRead ? "font-normal" : "font-semibold";

      // UNREAD: One purple tick | READ: Two green ticks
      let tickIcon = isRead
        ? `<ion-icon name="checkmark-done" style="color:green;"></ion-icon>`
        : `<ion-icon name="checkmark" style="color:purple;"></ion-icon>`;

      return `
        <div class="p-3 border-b ${borderColor} ${bgColor} flex items-start gap-3">
          <div onclick="markNotificationReadAndRedirect('${businessId}', '${n.id}', '${n.type}', '${n.bookingId || ""}')" class="flex flex-1 gap-3 cursor-pointer">
            <ion-icon name="${icon}" style="font-size:1.5rem; color:purple;"></ion-icon>
            <div class="flex-1">
              <p class="text-sm ${textWeight}">${n.message}</p>
              <p class="text-[10px] text-gray-500">By: ${n.triggeredBy || "Unknown"}</p>
              <p class="text-[10px] text-gray-400 flex items-center gap-2">
                ${n.createdAt?.toDate?.().toLocaleString() || ""}
                ${tickIcon}
              </p>
            </div>
          </div>
          <button onclick="event.stopPropagation(); deleteNotification('${businessId}', '${n.id}')" class="text-gray-400">✖</button>
        </div>
      `;
    }).join("");
  });

  // TOGGLE MODAL
  const btn = document.getElementById("notifBtn");
  if (btn && modal) {
    btn.onclick = () => {
      modal.style.display = modal.style.display === "none" ? "block" : "none";
    };
  }
}
// DELETE (PER USER ONLY)
window.deleteNotification = async function(businessId, notifId) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const notifRef = doc(db, "businesses", businessId, "notifications", notifId);
    await updateDoc(notifRef, { deletedFor: arrayUnion(user.uid) });
  } catch (e) {
    console.error("Delete notification error:", e);
  }
};

// MARK AS READ + REDIRECT
window.markNotificationReadAndRedirect = async function(businessId, notifId, type, bookingId) {
  try {
    const notifRef = doc(db, "businesses", businessId, "notifications", notifId);
const user = auth.currentUser;

await updateDoc(notifRef, {
  readBy: arrayUnion(user.uid)
});
    const modal = document.getElementById("notifModal");
    if (modal) modal.style.display = "none";

    let targetPage = "dashboard.html";

    // ✅ BOOKINGS (covers ALL booking types)
    if (type.includes("booking")) {
      targetPage = bookingId
        ? `bookings.html?highlight=${bookingId}`
        : "bookings.html";
    }

    // ✅ ADD PAGE
    else if (type === "add") {
      targetPage = "add.html";
    }

    // ✅ INVENTORY PAGE
    else if (type === "inventory") {
      targetPage = "inventory.html";
    }

      // ✅ INVENTORY PAGE
    else if (type === "inventory") {
      targetPage = "settings.html";
    }

    else if (type === "welcome") {
  targetPage = "dashboard.html";
}

    // SETTINGS PAGE (ROBUST)
else if (String(type).toLowerCase() === "settings") {
  targetPage = "settings.html";
}
   if (targetPage) {
  window.location.href = targetPage;
} else {
  console.warn("No page matched for type:", type);
}

  } catch (e) {
    console.error("Notification redirect error:", e);
  }
};

// --- Avatar Dropdown Logic handled by avatar.js ---
const notifBtn = document.getElementById('notifBtn');
const notifModal = document.getElementById('notifModal');

// --- Dynamic Avatar Letter ---
// If you have a function that loads user data, add this line inside it:
function updateAvatar(businessName) {
    const avatarContainer = document.getElementById('user-avatar');
    if (avatarContainer && businessName) {
        avatarContainer.textContent = businessName.charAt(0).toUpperCase();
    }
}