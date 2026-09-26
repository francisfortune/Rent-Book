import { auth, db } from "./firebase.js";
import { getBusinessIdByEmail } from "./shared.js";
import { sendPush } from "./onesignal.js";  // ✅ ADD THIS
import { fetchActiveBookings, getAvailabilityMap, checkDateAvailability } from "./services/availabilityService.js";
import { isBookingOverbooked, getBookingLifecycle, renderLifecycleBadge } from "./services/bookingStatus.js";

import {
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
   NOTIFICATION HELPER (with Push)
========================= */
async function sendInventoryNotification(businessId, message, type = "inventory", deepLink = "/inventory.html") {
  try {
    // 1. Save to Firestore
    const notifRef = collection(db, "businesses", businessId, "notifications");
    await addDoc(notifRef, {
      message: message,
      type: type,
      triggeredBy: auth.currentUser?.email || "System",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });

    // 2. Send OneSignal Push Notification
    await sendPush(message, deepLink);
    
    console.log(`[Inventory] ✅ Notification + Push sent: ${message}`);
  } catch (err) {
    console.error("[Inventory] Notification failed:", err);
  }
}

/* =========================
   DOM ELEMENTS
========================= */
const totalItemsEl = document.getElementById("totalItems");
const availableItemsEl = document.getElementById("availableItems");
const outItemsEl = document.getElementById("outItems");
const inventoryList = document.getElementById("inventoryList");
const inventorySearch = document.getElementById("inventorySearch");

const calcItem = document.getElementById("calcItem");
const calcQty = document.getElementById("calcQty");
const calcResult = document.getElementById("calcResult");

const overbookedList = document.getElementById("overbookedList");

// Module-level state shared across the availability calculator, the
// overbooked panel and the stats cards, so everything stays in sync.
let currentBusinessId = null;
let allInventoryItemsCache = [];
let activeBookingsCache = [];
let lastRenderedItems = { filtered: [], all: [] };

async function refreshActiveBookingsCache(businessId) {
  try {
    activeBookingsCache = await fetchActiveBookings(businessId);
  } catch (err) {
    console.error("[Inventory] Failed to refresh active bookings cache:", err);
  }
  // Re-render with the freshest booking data so "Free today" stays accurate
  if (lastRenderedItems.all.length || lastRenderedItems.filtered.length) {
    renderInventory(lastRenderedItems.filtered, lastRenderedItems.all);
  }
}

// Edit modal elements
const editModal = document.getElementById("editModal");
const editItemForm = document.getElementById("editItemForm");
const editItemId = document.getElementById("editItemId");
const editItemName = document.getElementById("editItemName");
const editItemQty = document.getElementById("editItemQty");
const editItemAvail = document.getElementById("editItemAvail");
const editItemPrice = document.getElementById("editItemPrice");
const closeEditModal = document.getElementById("closeEditModal");
const deleteItemBtn = document.getElementById("deleteItemBtn");

/* =========================
   HELPER FUNCTIONS
========================= */


/* =========================
   OPEN EDIT MODAL
========================= */
function openEditModal(item) {
  editItemId.value = item.id;
  editItemName.value = item.name;
  editItemQty.value = item.totalQuantity;
  editItemAvail.value = item.availableQuantity;
  editItemPrice.value = item.price;
  editModal.classList.remove("hidden");
}

/* =========================
   RENDER INVENTORY
   ("Available" / "Out" now reflect what's actually free RIGHT NOW —
   i.e. usable stock minus whatever other active bookings currently
   overlap today's date — instead of a permanently-decremented counter.)
========================= */
function renderInventory(filteredItems, allItems) {
  inventoryList.innerHTML = "";
  calcItem.innerHTML = "";
  lastRenderedItems = { filtered: filteredItems, all: allItems };
  allInventoryItemsCache = allItems;

  const nowMap = getAvailabilityMap(allItems, activeBookingsCache, new Date(), new Date());

  let totalAssetsValue = 0;
  let totalAvailableQty = 0;
  let totalOutQty = 0;

  // Totals & dropdown
  allItems.forEach(item => {
    const totalQty = Number(item.totalQuantity || 0);
    const usableQty = Number(item.availableQuantity || 0);
    const price = Number(item.price || 0);
    const freeNow = nowMap.has(item.name.trim().toLowerCase())
      ? nowMap.get(item.name.trim().toLowerCase())
      : usableQty;

    totalAvailableQty += freeNow;
    totalOutQty += Math.max(0, usableQty - freeNow);

    // Asset value calculation (based on total owned, not just what's free)
    totalAssetsValue += totalQty * price;

    calcItem.innerHTML += `
      <option value="${item.name}" data-stock="${usableQty}">
        ${item.name} (${usableQty} usable stock)
      </option>
    `;
  });

  // Dashboard stats
  totalItemsEl.textContent = `₦${totalAssetsValue.toLocaleString()}`;
  availableItemsEl.textContent = totalAvailableQty.toLocaleString();
  outItemsEl.textContent = totalOutQty.toLocaleString();

  // Inventory list
  filteredItems.forEach(item => {
    const key = item.name.trim().toLowerCase();
    const freeNow = nowMap.has(key) ? nowMap.get(key) : item.availableQuantity;

    const div = document.createElement("div");
    div.className = "inventory-item flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100 mb-3";
    div.innerHTML = `
      <div>
        <strong class="text-lg">${item.name}</strong><br>
        <span class="text-sm text-gray-500">
          Total: ${item.totalQuantity} |
          Free today:
          <span class="${freeNow <= 5 ? "text-red-600 font-bold" : ""}">
            ${freeNow}
          </span>
          <span class="text-[11px] text-gray-400">(usable stock: ${item.availableQuantity})</span>
        </span><br>
        <span class="text-purple-600">₦${item.price} / unit</span>
      </div>
      <button class="edit-btn text-purple-600">
        <span class="material-symbols-outlined">edit</span>
      </button>
    `;
    div.querySelector(".edit-btn").onclick = () => openEditModal(item);
    inventoryList.appendChild(div);
  });
}

/* =========================
   OVERBOOKED PANEL (SYNCED WITH BOOKINGS.JS via bookingStatus.js —
   the exact same isBookingOverbooked() definition used there)
========================= */
function listenToOverbooked(businessId) {
  const overbookedList =
    document.getElementById("overbookedList") ||
    document.getElementById("overbooked-list");

  if (!overbookedList) return;

  const ref = collection(db, "businesses", businessId, "bookings");

  onSnapshot(ref, (snap) => {
    // Keep the shared active-bookings cache fresh for the availability
    // calculator + "Free today" stats every time bookings change.
    activeBookingsCache = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => b.status !== "returned" && b.status !== "cancelled");
    if (lastRenderedItems.all.length) {
      renderInventory(lastRenderedItems.filtered, lastRenderedItems.all);
    }

    overbookedList.innerHTML = "";

    const allBookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const overbooked = allBookings.filter(isBookingOverbooked);

    if (!overbooked.length) {
      overbookedList.innerHTML = `
        <p class="text-center text-gray-400 py-6 italic text-sm">
          No overbooked items 🎉
        </p>
      `;
      return;
    }

    overbooked.forEach((b) => {
      const life = getBookingLifecycle(b);
      const borrowedItems = b.items
        .filter((i) => Number(i.shortage || 0) > 0 || i.isCustom)
        .map((i) => {
          const vendor = i.supplier || "Unknown Vendor";
          const qty = Number(i.shortage || i.qty || 0);
          const customTag = i.isCustom ? " (not in inventory)" : "";

          return `• ${qty} × ${i.name}${customTag}
            <span class="text-purple-700 font-bold">[${vendor}]</span>`;
        });

      const div = document.createElement("div");
      div.className =
        "p-4 mb-3 bg-white border border-gray-100 rounded-2xl shadow-sm border-l-4 border-l-orange-500 transition-all hover:shadow-md cursor-pointer";

      div.innerHTML = `
        <div class="flex justify-between items-start">
          <div>
            <p class="font-bold text-gray-900 text-sm">
              ${b.client?.name || "Client"}
            </p>
            <p class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
              <span class="material-symbols-outlined" style="font-size: 14px;">calendar_today</span>
              ${b.event?.date || "No Date"}
            </p>
            <div class="mt-1">${renderLifecycleBadge(b, "text-[9px]")}</div>
          </div>
          <span class="bg-orange-100 text-orange-600 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
            Shortage
          </span>
        </div>

        <div class="bg-purple-50 border border-purple-100 rounded-xl p-3 mt-3">
          <p class="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">
            Vendor / Borrowed Items
          </p>
          <div class="text-[11px] text-gray-700 leading-relaxed">
            ${borrowedItems.join("<br>")}
          </div>
        </div>
      `;

      div.onclick = () => {
        window.location.href = `bookings.html?highlight=${b.id}`;
      };

      overbookedList.appendChild(div);
    });
  });
}


/* =========================
   AUTH & LIVE DATA
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
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    const businessId = await getBusinessIdByEmail(user.email, user);
    currentBusinessId = businessId;
    if (!navigator.onLine) {
      showOfflineBanner();
    }
    const invRef = collection(db, "businesses", businessId, "inventory");

    onSnapshot(invRef, snap => {
      const allItems = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          totalQuantity: Math.max(0, Number(data.totalQuantity || 0)),
          availableQuantity: Math.min(
            Math.max(0, Number(data.availableQuantity || 0)),
            Number(data.totalQuantity || 0)
          )
        };
      });

      function filterAndRender() {
        const q = inventorySearch.value.toLowerCase();
        const filtered = allItems.filter(i => i.name.toLowerCase().includes(q));
        renderInventory(filtered, allItems);
      }

      inventorySearch.oninput = filterAndRender;
      filterAndRender();
    });

    listenToOverbooked(businessId);


 // Add new item
document.getElementById("addItemForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = itemName.value.trim();
  const qty = Number(itemQty.value);
  const price = Number(itemPrice.value);

  await addDoc(invRef, {
    name: name,
    totalQuantity: qty,
    availableQuantity: qty,
    price: price,
    createdAt: serverTimestamp()
  });

  // ✅ Send Notification + Push
  await sendInventoryNotification(
    businessId, 
    `📦 New item added: ${name} (${qty} units at ₦${price.toLocaleString()})`, 
    "inventory_add",
    "/inventory.html"
  );
  
  e.target.reset();
});
    // Close edit modal
    closeEditModal.onclick = () => editModal.classList.add("hidden");

  // Save changes in edit modal
editItemForm.onsubmit = async e => {
  e.preventDefault();
  const name = editItemName.value.trim();
  const totalQty = Number(editItemQty.value);
  const avail = Number(editItemAvail.value);
  const price = Number(editItemPrice.value);
  const ref = doc(db, "businesses", businessId, "inventory", editItemId.value);

  await updateDoc(ref, {
    name: name,
    totalQuantity: totalQty,
    availableQuantity: avail,
    price: price,
    updatedAt: serverTimestamp()
  });

  // 🔔 Send Notification + Push
  let message = `✏️ Item updated: ${name}`;
  let type = "inventory_update";
  let deepLink = "/inventory.html";

  if (avail <= 5) {
    message = `⚠️ LOW STOCK ALERT: ${name} only has ${avail} left! (Total: ${totalQty})`;
    type = "inventory_low_stock";
    deepLink = "/inventory.html";
  }

  await sendInventoryNotification(businessId, message, type, deepLink);

  editModal.classList.add("hidden");
};

// Delete item
deleteItemBtn.onclick = async () => {
  const name = editItemName.value; // Get name before deleting
  if (!confirm(`Are you sure you want to delete ${name}?`)) return;
  
  await deleteDoc(doc(db, "businesses", businessId, "inventory", editItemId.value));
  
  // ✅ Send Notification + Push
  await sendInventoryNotification(
    businessId, 
    `🗑️ Item deleted: ${name} was removed from inventory`, 
    "inventory_delete",
    "/inventory.html"
  );
  
  editModal.classList.add("hidden");
};
  } catch (err) {
    console.error(err);
    if (!navigator.onLine || err.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else if (err.message === "NO_BUSINESS" || err.message === "Business not found") {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      window.location.href = "setup.html";
    } else {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      showErrorBanner(err.message || err);
    }
  }
});

/* =========================
   AVAILABILITY CHECK (date-aware)
   Locks in exactly the same way a real booking would: it checks how many
   units are free for a SPECIFIC date window, not just raw stock — so a
   500-chair booking two months out no longer blocks chairs needed tomorrow.
========================= */
document.getElementById("checkBtn").onclick = async () => {
  const itemName = calcItem.value;
  const needed = Number(calcQty.value);
  const startEl = document.getElementById("calcStart");
  const endEl = document.getElementById("calcEnd");
  const startVal = startEl?.value || "";
  const endVal = endEl?.value || startVal;

  if (!itemName) {
    calcResult.textContent = "Choose an item first";
    calcResult.style.color = "orange";
    return;
  }

  if (!needed || needed <= 0) {
    calcResult.textContent = "Enter a valid quantity";
    calcResult.style.color = "orange";
    return;
  }

  calcResult.textContent = "Checking...";
  calcResult.style.color = "#6b7280";

  try {
    const start = startVal ? new Date(startVal) : new Date();
    const end = endVal ? new Date(endVal) : start;

    // Always re-fetch fresh bookings for the check itself, so the result is
    // correct even if the cache hasn't caught up yet.
    const bookings = currentBusinessId ? await fetchActiveBookings(currentBusinessId) : activeBookingsCache;
    const map = getAvailabilityMap(allInventoryItemsCache, bookings, start, end);
    const key = itemName.trim().toLowerCase();
    const available = map.has(key) ? map.get(key) : 0;

    const dateNote = startVal
      ? ` for ${start.toLocaleDateString()}${endVal && endVal !== startVal ? ` → ${end.toLocaleDateString()}` : ""}`
      : " (today, since no dates were chosen)";

    if (needed <= available) {
      const remaining = available - needed;
      calcResult.textContent = `Available ✅ (${remaining} will remain)${dateNote}`;
      calcResult.style.color = "green";
    } else {
      const shortage = needed - available;
      calcResult.textContent = `Not enough ❌ (short by ${shortage}, only ${available} free)${dateNote}`;
      calcResult.style.color = "red";
    }
  } catch (err) {
    console.error("[Inventory] Availability check failed:", err);
    calcResult.textContent = "Could not check availability — please try again.";
    calcResult.style.color = "red";
  }
};