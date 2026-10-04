// assets/js/inventory.js — FIXED
// ---------------------------------------------------------------------------
// Fixes in this version:
//   1. All onSnapshot listeners are tracked and cleaned up (no leaks).
//   2. Add/Edit/Delete handlers disable their button while in-flight — no
//      duplicate writes, no duplicate pushes from double-clicks/taps.
//   3. listenToOverbooked is registered once per auth session.
//   4. renderInventory no longer triggers itself indirectly via snapshot
//      cascades — activeBookingsCache is set once and reused.
//   5. All notifications go through a single sendInventoryNotification()
//      helper that logs errors instead of crashing.
//   6. Overbooked panel shows ANY booking with borrowed / not-in-inventory
//      items (matching the booking modal's "Vendor / Borrowed Items" block).
//   7. Overbooked panel ALSO shows rental-to-rental batches whose items[]
//      contain any shortage > 0 — i.e. lend-outs that exceeded stock.
//      This mirrors the "Overbooked" badge on rental-to-rental.html so
//      both pages agree on what "overbooked" means.
// ---------------------------------------------------------------------------

import { auth, db } from "./firebase.js";
import { getBusinessIdByEmail } from "./shared.js";
import { sendPush } from "./onesignal.js";
import {
  fetchActiveBookings,
  getAvailabilityMap
} from "./services/availabilityService.js";
import {
  isBookingOverbooked,
  getBookingLifecycle,
  renderLifecycleBadge
} from "./services/bookingStatus.js";

import {
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================================================
   NOTIFICATION HELPER (with Push)
   Single funnel for all inventory notifications.
========================================================= */
async function sendInventoryNotification(
  businessId,
  message,
  type = "inventory",
  deepLink = "/inventory.html"
) {
  try {
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message,
      type,
      triggeredBy: auth.currentUser?.email || "System",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });

    await sendPush(message, deepLink);
    console.log(`[Inventory] ✅ Notification + Push sent: ${message}`);
  } catch (err) {
    console.error("[Inventory] Notification failed:", err);
  }
}

/* =========================================================
   DOM ELEMENTS
========================================================= */
const totalItemsEl = document.getElementById("totalItems");
const availableItemsEl = document.getElementById("availableItems");
const outItemsEl = document.getElementById("outItems");
const inventoryList = document.getElementById("inventoryList");
const inventorySearch = document.getElementById("inventorySearch");

const calcItem = document.getElementById("calcItem");
const calcQty = document.getElementById("calcQty");
const calcResult = document.getElementById("calcResult");

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

/* =========================================================
   STATE
========================================================= */
let currentBusinessId = null;
let allInventoryItemsCache = [];
let activeBookingsCache = [];
let lastRenderedItems = { filtered: [], all: [] };

// Track every active listener so we can clean up if auth state changes.
let unsubInventory = null;
let unsubOverbooked = null;
let unsubLentOutOverbooked = null;

/* =========================================================
   HELPERS
========================================================= */
/**
 * A booking is "borrow-relevant" if it has any item that is:
 *   - short (shortage > 0), OR
 *   - supplied by a vendor (supplier non-empty), OR
 *   - a custom / not-in-inventory item.
 * This is the same rule used in bookings.js openBooking().
 */
function hasBorrowedOrCustomItems(booking) {
  if (isBookingOverbooked(booking)) return true;
  return (booking.items || []).some(
    (i) =>
      Number(i.shortage || 0) > 0 ||
      (i.supplier && String(i.supplier).trim() !== "") ||
      i.isCustom
  );
}

/**
 * Returns the list of borrowed / not-in-inventory items for a booking.
 * Same filter used to render the "Vendor / Borrowed Items" panel below.
 */
function getBorrowedItems(booking) {
  return (booking.items || []).filter(
    (i) =>
      Number(i.shortage || 0) > 0 ||
      (i.supplier && String(i.supplier).trim() !== "") ||
      i.isCustom
  );
}

/**
 * A rental-to-rental batch is "overbooked" if any of its items[] has
 * shortage > 0. Same rule as rental-to-rental.js's isRentalOverbooked().
 * Only batches with an items[] array count — legacy one-doc-per-item docs
 * don't have shortage fields, so they're skipped.
 */
function isLentOutOverbooked(batch) {
  if (!batch || batch.status === "returned" || batch.status === "cancelled") return false;
  if (!Array.isArray(batch.items)) return false;
  return batch.items.some((i) => Number(i.shortage || 0) > 0);
}

/* =========================================================
   BUTTON GUARD — disable a button while an async op runs
========================================================= */
async function withButtonLock(button, fn) {
  if (!button) return fn();
  if (button.dataset.locked === "1") return; // already running
  const originalText = button.textContent;
  button.dataset.locked = "1";
  button.disabled = true;
  button.style.opacity = "0.6";
  button.style.cursor = "not-allowed";
  try {
    return await fn();
  } finally {
    button.dataset.locked = "0";
    button.disabled = false;
    button.style.opacity = "";
    button.style.cursor = "";
    if (originalText) button.textContent = originalText;
  }
}

/* =========================================================
   OPEN EDIT MODAL
========================================================= */
function openEditModal(item) {
  editItemId.value = item.id;
  editItemName.value = item.name;
  editItemQty.value = item.totalQuantity;
  editItemAvail.value = item.availableQuantity;
  editItemPrice.value = item.price;
  editModal.classList.remove("hidden");
}

/* =========================================================
   RENDER INVENTORY
   "Available" / "Out" reflect what's free RIGHT NOW based on
   active bookings, not a decremented counter.
========================================================= */
function renderInventory(filteredItems, allItems) {
  if (!inventoryList || !calcItem) return;

  inventoryList.innerHTML = "";
  calcItem.innerHTML = "";
  lastRenderedItems = { filtered: filteredItems, all: allItems };
  allInventoryItemsCache = allItems;

  const nowMap = getAvailabilityMap(
    allItems,
    activeBookingsCache,
    new Date(),
    new Date()
  );

  let totalOwnedQty = 0;
  let totalAvailableQty = 0;
  let totalOutQty = 0;

  allItems.forEach((item) => {
    const totalQty = Number(item.totalQuantity || 0);
    const usableQty = Number(item.availableQuantity || 0);
    const freeNow = nowMap.has(item.name.trim().toLowerCase())
      ? nowMap.get(item.name.trim().toLowerCase())
      : usableQty;

    totalOwnedQty += totalQty;
    totalAvailableQty += freeNow;
    totalOutQty += Math.max(0, totalQty - freeNow);

    calcItem.innerHTML += `
      <option value="${item.name}" data-stock="${usableQty}">
        ${item.name} (${usableQty} usable stock)
      </option>
    `;
  });

  if (totalItemsEl) totalItemsEl.textContent = totalOwnedQty.toLocaleString();
  if (availableItemsEl) availableItemsEl.textContent = totalAvailableQty.toLocaleString();
  if (outItemsEl) outItemsEl.textContent = totalOutQty.toLocaleString();

  filteredItems.forEach((item) => {
    const key = item.name.trim().toLowerCase();
    const freeNow = nowMap.has(key) ? nowMap.get(key) : item.availableQuantity;

    const div = document.createElement("div");
    div.className =
      "inventory-item flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100 mb-3";
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

/* =========================================================
   OVERBOOKED PANEL
   Two sources feed this panel:
     1. Bookings   — items borrowed from a vendor (shortage > 0,
        supplier set, or isCustom). Same rule as bookings.js's
        "Vendor / Borrowed Items" block.
     2. Lend-outs  — externalRentals batches whose items[] have
        shortage > 0 (you lent more than you had).
        Same rule as rental-to-rental.js's Overbooked badge.

   Both are merged into one list. Rows are labelled with a
   "Booking" or "Lent Out" pill and routed accordingly.
========================================================= */
function listenToOverbooked(businessId) {
  const overbookedList =
    document.getElementById("overbookedList") ||
    document.getElementById("overbooked-list");

  if (!overbookedList) return;

  // Clean up prior subscriptions if any
  if (unsubOverbooked) unsubOverbooked();
  if (unsubLentOutOverbooked) unsubLentOutOverbooked();

  // Shared state written by both listeners, rendered together.
  let bookingRows = [];
  let lendRows = [];

  function renderMergedOverbooked() {
    overbookedList.innerHTML = "";

    const all = [...bookingRows, ...lendRows];

    if (!all.length) {
      overbookedList.innerHTML = `
        <p class="text-center text-gray-400 py-6 italic text-sm">
          No overbooked items 🎉
        </p>
      `;
      return;
    }

    // Newest-first sort on the best timestamp we have.
    all.sort((a, b) => (b._sortTs || 0) - (a._sortTs || 0));

    all.forEach((row) => {
      const div = document.createElement("div");
      div.className =
        "p-4 mb-3 bg-white border border-gray-100 rounded-2xl shadow-sm border-l-4 border-l-orange-500 transition-all hover:shadow-md cursor-pointer";

      if (row.kind === "booking") {
        // Same layout as the original booking-sourced rows.
        const borrowedItemsHtml = row.items
          .map((i) => {
            const vendor = i.supplier || "Unknown Vendor";
            const qty = Number(i.shortage || i.qty || 0);
            const customTag = i.isCustom ? " (not in inventory)" : "";
            return `• ${qty} × ${i.name}${customTag}
              <span class="text-purple-700 font-bold">[${vendor}]</span>`;
          })
          .join("<br>");

        div.innerHTML = `
          <div class="flex justify-between items-start">
            <div>
              <p class="font-bold text-gray-900 text-sm">
                ${row.clientName}
              </p>
              <p class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                <span class="material-symbols-outlined" style="font-size: 14px;">calendar_today</span>
                ${row.eventDate}
              </p>
              <div class="mt-1">${row.lifecycleBadge || ""}</div>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span class="bg-orange-100 text-orange-600 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                Shortage
              </span>
              <span class="bg-gray-100 text-gray-600 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                Booking
              </span>
            </div>
          </div>

          <div class="bg-purple-50 border border-purple-100 rounded-xl p-3 mt-3">
            <p class="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">
              Vendor / Borrowed Items
            </p>
            <div class="text-[11px] text-gray-700 leading-relaxed">
              ${borrowedItemsHtml}
            </div>
          </div>
        `;
      } else {
        // Lend-out row (from externalRentals, batch shape).
        const shortItemsHtml = row.items
          .filter((i) => Number(i.shortage || 0) > 0)
          .map((i) => {
            const qty = Number(i.qty || 0);
            const shortage = Number(i.shortage || 0);
            const free = Number(i.availableAtRental || 0);
            return `• ${qty} × ${i.name}
              <span class="text-orange-700 font-bold">[short by ${shortage}, only ${free} free]</span>`;
          })
          .join("<br>");

        div.innerHTML = `
          <div class="flex justify-between items-start">
            <div>
              <p class="font-bold text-gray-900 text-sm">
                ${row.rentedTo}
              </p>
              <p class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                <span class="material-symbols-outlined" style="font-size: 14px;">swap_horiz</span>
                Lent on ${row.rentalDate} · Return ${row.returnDate}
              </p>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span class="bg-orange-100 text-orange-600 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                Shortage
              </span>
              <span class="bg-purple-100 text-purple-700 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                Lent Out
              </span>
            </div>
          </div>

          <div class="bg-purple-50 border border-purple-100 rounded-xl p-3 mt-3">
            <p class="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">
              Over-lent Items
            </p>
            <div class="text-[11px] text-gray-700 leading-relaxed">
              ${shortItemsHtml}
            </div>
          </div>
        `;
      }

      div.onclick = () => {
        if (row.kind === "booking") {
          window.location.href = `bookings.html?highlight=${row.id}`;
        } else {
          window.location.href = `rental-to-rental.html`;
        }
      };

      overbookedList.appendChild(div);
    });
  }

  /* ---- Source 1: bookings ---- */
  const bookingsRef = collection(db, "businesses", businessId, "bookings");

  unsubOverbooked = onSnapshot(bookingsRef, (snap) => {
    // Keep the shared active-bookings cache fresh.
    activeBookingsCache = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => b.status !== "returned" && b.status !== "cancelled");

    // Re-render inventory (availability map depends on active bookings).
    if (lastRenderedItems.all.length) {
      renderInventory(lastRenderedItems.filtered, lastRenderedItems.all);
    }

    bookingRows = activeBookingsCache
      .filter(hasBorrowedOrCustomItems)
      .map((b) => {
        const ts = b.createdAt?.toDate?.()?.getTime?.() || 0;
        return {
          kind: "booking",
          id: b.id,
          clientName: b.client?.name || "Client",
          eventDate: b.event?.date || "No Date",
          items: getBorrowedItems(b),
          lifecycleBadge: renderLifecycleBadge(b, "text-[9px]"),
          _sortTs: ts
        };
      });

    renderMergedOverbooked();
  });

  /* ---- Source 2: rental-to-rental lend-outs ---- */
  const lendRef = collection(db, "businesses", businessId, "externalRentals");

  unsubLentOutOverbooked = onSnapshot(lendRef, (snap) => {
    const batches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    lendRows = batches
      .filter(isLentOutOverbooked)
      .map((batch) => {
        const ts = batch.createdAt?.toDate?.()?.getTime?.() || 0;
        return {
          kind: "lend",
          id: batch.id,
          rentedTo: batch.rentedTo || "Business",
          rentalDate: batch.rentalDate || "—",
          returnDate: batch.returnDate || "—",
          items: batch.items,
          _sortTs: ts
        };
      });

    renderMergedOverbooked();
  }, (err) => {
    console.warn("[Inventory] lend-out overbooked subscription failed:", err);
  });
}

/* =========================================================
   OFFLINE / ERROR BANNERS
========================================================= */
function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText =
    "position: fixed; top: 0; left: 0; right: 0; background: rgba(128, 0, 128, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

function showErrorBanner(message) {
  if (document.getElementById("errorBanner")) return;
  const banner = document.createElement("div");
  banner.id = "errorBanner";
  banner.style.cssText =
    "position: fixed; top: 0; left: 0; right: 0; background: rgba(220, 38, 38, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">error</span> Error: ${message}. Please refresh or try logging out.`;
  document.body.appendChild(banner);
}

/* =========================================================
   AUTH + LIVE DATA
========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    const businessId = await getBusinessIdByEmail(user.email, user);
    currentBusinessId = businessId;

    if (!navigator.onLine) showOfflineBanner();

    const invRef = collection(db, "businesses", businessId, "inventory");

    // Clean up any previous inventory subscription (e.g. auth re-fired).
    if (unsubInventory) unsubInventory();

    unsubInventory = onSnapshot(invRef, (snap) => {
      const allItems = snap.docs
        .map((d) => {
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
        })
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), undefined, {
            sensitivity: "base"
          })
        );

      function filterAndRender() {
        const q = (inventorySearch?.value || "").toLowerCase();
        const filtered = allItems.filter((i) =>
          String(i.name || "").toLowerCase().includes(q)
        );
        renderInventory(filtered, allItems);
      }

      if (inventorySearch) inventorySearch.oninput = filterAndRender;
      filterAndRender();
    });

    listenToOverbooked(businessId);

    // =====================================================
    // ADD ITEM
    // =====================================================
    const addItemForm = document.getElementById("addItemForm");
    if (addItemForm) {
      // Prevent stacking submit listeners across auth re-fires
      if (addItemForm.dataset.wired !== "1") {
        addItemForm.dataset.wired = "1";
        addItemForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const submitBtn = addItemForm.querySelector('button[type="submit"]');

          await withButtonLock(submitBtn, async () => {
            const name = document.getElementById("itemName").value.trim();
            const qty = Number(document.getElementById("itemQty").value);
            const price = Number(document.getElementById("itemPrice").value);

            if (!name || qty <= 0) return;

            try {
              await addDoc(invRef, {
                name,
                totalQuantity: qty,
                availableQuantity: qty,
                price,
                createdAt: serverTimestamp()
              });

              await sendInventoryNotification(
                currentBusinessId,
                `New item added: ${name} (${qty} units at ₦${price.toLocaleString()})`,
                "inventory_add",
                "/inventory.html"
              );

              addItemForm.reset();
            } catch (err) {
              console.error("[Inventory] Add failed:", err);
              alert("Failed to add item: " + err.message);
            }
          });
        });
      }
    }

    // =====================================================
    // EDIT MODAL — close
    // =====================================================
    if (closeEditModal) {
      closeEditModal.onclick = () => editModal.classList.add("hidden");
    }

    // =====================================================
    // EDIT MODAL — save
    // =====================================================
    if (editItemForm && editItemForm.dataset.wired !== "1") {
      editItemForm.dataset.wired = "1";
      editItemForm.onsubmit = async (e) => {
        e.preventDefault();
        const saveBtn = editItemForm.querySelector('button[type="submit"]');

        await withButtonLock(saveBtn, async () => {
          const name = editItemName.value.trim();
          const totalQty = Number(editItemQty.value);
          const avail = Number(editItemAvail.value);
          const price = Number(editItemPrice.value);
          const ref = doc(
            db,
            "businesses",
            currentBusinessId,
            "inventory",
            editItemId.value
          );

          try {
            await updateDoc(ref, {
              name,
              totalQuantity: totalQty,
              availableQuantity: avail,
              price,
              updatedAt: serverTimestamp()
            });

            let message = `Item updated: ${name}`;
            let type = "inventory_update";
            const deepLink = "/inventory.html";

            if (avail <= 5) {
              message = `LOW STOCK ALERT: ${name} only has ${avail} left! (Total: ${totalQty})`;
              type = "inventory_low_stock";
            }

            await sendInventoryNotification(
              currentBusinessId,
              message,
              type,
              deepLink
            );

            editModal.classList.add("hidden");
          } catch (err) {
            console.error("[Inventory] Edit failed:", err);
            alert("Failed to update item: " + err.message);
          }
        });
      };
    }

    // =====================================================
    // DELETE ITEM
    // =====================================================
    if (deleteItemBtn && deleteItemBtn.dataset.wired !== "1") {
      deleteItemBtn.dataset.wired = "1";
      deleteItemBtn.onclick = async () => {
        await withButtonLock(deleteItemBtn, async () => {
          const name = editItemName.value;
          if (!confirm(`Are you sure you want to delete ${name}?`)) return;

          try {
            await deleteDoc(
              doc(db, "businesses", currentBusinessId, "inventory", editItemId.value)
            );

            await sendInventoryNotification(
              currentBusinessId,
              `Item deleted: ${name} was removed from inventory`,
              "inventory_delete",
              "/inventory.html"
            );

            editModal.classList.add("hidden");
          } catch (err) {
            console.error("[Inventory] Delete failed:", err);
            alert("Failed to delete item: " + err.message);
          }
        });
      };
    }
  } catch (err) {
    console.error(err);
    if (!navigator.onLine || err.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else if (err.message === "NO_BUSINESS" || err.message === "Business not found") {
      if (user?.uid) localStorage.removeItem(`businessId_${user.uid}`);
      window.location.href = "setup.html";
    } else {
      if (user?.uid) localStorage.removeItem(`businessId_${user.uid}`);
      showErrorBanner(err.message || err);
    }
  }
});

/* =========================================================
   AVAILABILITY CHECK (date-aware)
========================================================= */
const checkBtn = document.getElementById("checkBtn");
if (checkBtn && checkBtn.dataset.wired !== "1") {
  checkBtn.dataset.wired = "1";
  checkBtn.onclick = async () => {
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

      const bookings = currentBusinessId
        ? await fetchActiveBookings(currentBusinessId)
        : activeBookingsCache;

      const map = getAvailabilityMap(allInventoryItemsCache, bookings, start, end);
      const key = itemName.trim().toLowerCase();
      const available = map.has(key) ? map.get(key) : 0;

      const dateNote = startVal
        ? ` for ${start.toLocaleDateString()}${
            endVal && endVal !== startVal ? ` → ${end.toLocaleDateString()}` : ""
          }`
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
}