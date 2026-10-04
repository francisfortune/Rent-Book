// assets/js/rental-to-rental.js
// ============================================================================
// Rental to Rental page.
//
// Two tabs:
//   • Lent Out    — items YOU lent to other businesses. Writes here.
//   • Borrowed In — items you borrowed from vendors. Read-only, mirrors
//                   the underlying booking's status.
//
// Lent Out form is inline (like add.html): repeatable item rows, per-row
// availability hint, saves ONE Firestore doc per item (Option 2).
//
// Notifications:
//   • Lent out saved              → in-app + push
//   • Lent out marked returned    → in-app only
//   • Lent out deleted            → in-app only
// ============================================================================

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getBusinessIdByEmail } from "./shared.js";
import { sendPush } from "./onesignal.js";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getBorrowedInFromBookings } from "./services/rentalService.js";
import { getAvailabilityMap } from "./services/availabilityService.js";

let businessId = null;
let currentUser = null;
let currentTab = "out";
let lentOutCache = [];
let borrowedInCache = [];
let inventoryItems = [];
let unsubLentOut = null;

/* ============================================================
   HELPERS
============================================================ */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function toDateSafe(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function formatShort(d) {
  if (!d) return "—";
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

function money(n) {
  return `₦${Number(n || 0).toLocaleString("en-NG")}`;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function lentOutStatus(row) {
  if (row.status === "returned") return "returned";
  const ret = toDateSafe(row.returnDate);
  if (ret && ret < new Date()) return "overdue";
  return "active";
}

function borrowedInStatus(row) {
  const s = String(row.bookingStatus || "").toLowerCase();
  if (s === "returned") return "returned";
  if (s === "overdue") return "overdue";
  const ret = toDateSafe(row.returnDate);
  if (ret && ret < new Date()) return "overdue";
  return "active";
}

/* ============================================================
   NOTIFICATIONS
============================================================ */
async function sendNotification(message, type, { push = false, deepLink = "/rental-to-rental.html" } = {}) {
  try {
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message,
      type,
      triggeredBy: currentUser?.email || "System",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
  } catch (err) {
    console.error("[Rental] In-app notification failed:", err);
  }

  if (push) {
    try {
      await sendPush(message, deepLink);
    } catch (err) {
      console.warn("[Rental] Push failed:", err.message);
    }
  }
}

/* ============================================================
   AVAILABILITY — free right now
============================================================ */
function getFreeNow(itemName) {
  if (!itemName || !inventoryItems.length) return 0;
  const map = getAvailabilityMap(inventoryItems, borrowedInSource(), new Date(), new Date());
  const key = itemName.trim().toLowerCase();
  return map.has(key) ? map.get(key) : 0;
}

/** Borrowed-in rows double as "other active bookings" for availability math. */
function borrowedInSource() {
  return borrowedInCache
    .filter(r => r.bookingStatus !== "returned" && r.bookingStatus !== "cancelled")
    .map(r => ({
      items: [{
        name: r.itemName,
        qty: r.quantity,
        isCustom: r.isCustom,
        shortage: 0
      }]
    }));
}

/* ============================================================
   ITEM ROWS
============================================================ */
function buildItemRowHTML() {
  const options = inventoryItems.map(i => {
    const qty = Number(i.totalQuantity || 0);
    return `<option value="${escapeHtml(i.name)}" data-qty="${qty}">${escapeHtml(i.name)} (Total: ${qty})</option>`;
  }).join("");

  return `
    <div class="item-row">
      <select class="item-name">
        <option value="">— Select item —</option>
        ${options}
      </select>
      <input class="item-qty" type="number" min="1" value="1">
      <input class="item-price" type="number" min="0" placeholder="₦ price">
      <button type="button" class="row-remove" title="Remove">✕</button>
      <div class="row-hint"></div>
    </div>`;
}

function addItemRow() {
  const container = document.getElementById("itemsContainer");
  container.insertAdjacentHTML("beforeend", buildItemRowHTML());
  const row = container.lastElementChild;

  row.querySelector(".item-name").addEventListener("change", () => updateRowHint(row));
  row.querySelector(".item-qty").addEventListener("input", () => updateRowHint(row));
  row.querySelector(".item-price").addEventListener("input", () => updateRowHint(row));
  row.querySelector(".row-remove").addEventListener("click", () => {
    row.remove();
    // Always keep at least one row
    if (!document.querySelectorAll("#itemsContainer .item-row").length) addItemRow();
  });
}

function updateRowHint(row) {
  const item = row.querySelector(".item-name").value;
  const qty = Number(row.querySelector(".item-qty").value || 0);
  const hint = row.querySelector(".row-hint");

  if (!item) {
    hint.textContent = "";
    hint.className = "row-hint";
    return;
  }

  const free = getFreeNow(item);

  if (qty <= 0) {
    hint.textContent = `Available now: ${free}`;
    hint.className = "row-hint";
    return;
  }

  if (qty > free) {
    hint.textContent = `⚠ Only ${free} free right now (lending ${qty})`;
    hint.className = "row-hint warn";
  } else {
    hint.textContent = `✓ Available now: ${free} · ${free - qty} will remain`;
    hint.className = "row-hint ok";
  }
}

function clearAddForm() {
  document.getElementById("fBusiness").value = "";
  document.getElementById("fContact").value = "";
  document.getElementById("fPhone").value = "";
  document.getElementById("fOut").value = todayISO();
  document.getElementById("fReturn").value = "";
  document.getElementById("fNotes").value = "";
  const container = document.getElementById("itemsContainer");
  container.innerHTML = "";
  addItemRow();
}

function openAddCard() {
  clearAddForm();
  const card = document.getElementById("addCard");
  card.classList.add("open");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  // Focus business name after scroll
  setTimeout(() => document.getElementById("fBusiness")?.focus(), 350);
}

function closeAddCard() {
  document.getElementById("addCard").classList.remove("open");
}

/* ============================================================
   SUMMARY STRIP
============================================================ */
function renderSummary() {
  const outCount = lentOutCache.filter(r => lentOutStatus(r) !== "returned").length;
  const inCount = borrowedInCache.filter(r => borrowedInStatus(r) !== "returned").length;

  const outOverdue = lentOutCache.filter(r => lentOutStatus(r) === "overdue").length;
  const inOverdue = borrowedInCache.filter(r => borrowedInStatus(r) === "overdue").length;

  document.getElementById("summaryOut").textContent = outCount;
  document.getElementById("summaryIn").textContent = inCount;
  document.getElementById("summaryOverdue").textContent = outOverdue + inOverdue;
}

/* ============================================================
   RENDER ROWS (LIST)
============================================================ */
function renderRows() {
  const container = document.getElementById("rowsContainer");
  const statusFilter = document.getElementById("statusFilter").value;
  const search = (document.getElementById("searchInput").value || "").toLowerCase().trim();

  const source = currentTab === "out" ? lentOutCache : borrowedInCache;
  const statusFn = currentTab === "out" ? lentOutStatus : borrowedInStatus;

  let rows = source.filter(r => {
    const st = statusFn(r);
    if (statusFilter && st !== statusFilter) return false;
    if (search) {
      const hay = `${r.itemName || ""} ${r.rentedTo || r.vendor || ""} ${r.clientName || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty">
        <span class="material-symbols-outlined">inbox</span>
        ${currentTab === "out" ? "Nothing lent out yet" : "No borrowed items from bookings"}
      </div>`;
    return;
  }

  container.innerHTML = rows.map(r => {
    const st = statusFn(r);
    const isOut = currentTab === "out";

    const counterparty = isOut
      ? escapeHtml(r.rentedTo || "Unknown")
      : escapeHtml(r.vendor || "Unknown vendor");

    const metaExtra = isOut
      ? formatShort(toDateSafe(r.returnDate))
      : `for ${escapeHtml(r.clientName || "Client")} · ${escapeHtml(r.eventDate || "")}`;

    const directionPill = isOut
      ? `<span class="pill direction-out">→ Out</span>`
      : `<span class="pill direction-in">← In</span>`;

    const priceLine = isOut
      ? `<div class="row-price">${money(r.price)} × ${r.quantity} = ${money(Number(r.price || 0) * Number(r.quantity || 0))}</div>`
      : "";

    const actions = isOut
      ? `
        ${st !== "returned" ? `
          <button class="icon-btn" title="Mark returned" data-action="return" data-id="${r.id}">
            <span class="material-symbols-outlined">check_circle</span>
          </button>` : ""}
        <button class="icon-btn danger" title="Delete" data-action="delete" data-id="${r.id}">
          <span class="material-symbols-outlined">delete</span>
        </button>
      `
      : `
        <button class="icon-btn" title="Open booking" data-action="open-booking" data-id="${r.bookingId}">
          <span class="material-symbols-outlined">open_in_new</span>
        </button>
      `;

    return `
      <div class="row-card ${st}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(r.itemName)} · ${r.quantity}</div>
          <div class="row-meta">
            <span class="chip">
              <span class="material-symbols-outlined">${isOut ? "call_made" : "call_received"}</span>
              ${counterparty}
            </span>
            <span class="chip">
              <span class="material-symbols-outlined">event</span>
              ${metaExtra}
            </span>
          </div>
          ${priceLine}
        </div>
        <div class="row-side">
          <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
            ${directionPill}
            <span class="pill ${st}">${st}</span>
          </div>
          <div class="row-actions">${actions}</div>
        </div>
      </div>`;
  }).join("");

  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "return") markLentOutReturned(id);
      else if (action === "delete") deleteLentOut(id);
      else if (action === "open-booking") {
        window.location.href = `bookings.html?highlight=${id}`;
      }
    });
  });
}

/* ============================================================
   DATA LOADING
============================================================ */
function subscribeLentOut(bid) {
  const ref = collection(db, "businesses", bid, "externalRentals");
  const q = query(ref, orderBy("createdAt", "desc"));
  if (unsubLentOut) unsubLentOut();
  unsubLentOut = onSnapshot(q, (snap) => {
    lentOutCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSummary();
    if (currentTab === "out") renderRows();
  }, (err) => {
    console.error("Lent out subscription failed:", err);
    getDocs(ref).then((snap) => {
      lentOutCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSummary();
      if (currentTab === "out") renderRows();
    }).catch(() => {});
  });
}

async function loadBorrowedIn(bid) {
  borrowedInCache = await getBorrowedInFromBookings(bid);
  renderSummary();
  if (currentTab === "in") renderRows();
}

async function loadInventory(bid) {
  try {
    const snap = await getDocs(collection(db, "businesses", bid, "inventory"));
    inventoryItems = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
  } catch (err) {
    console.error("Inventory load failed:", err);
  }
}

/* ============================================================
   LENT OUT: RETURN / DELETE
============================================================ */
async function markLentOutReturned(id) {
  if (!confirm("Mark this as returned?")) return;
  const row = lentOutCache.find(r => r.id === id);
  try {
    await updateDoc(doc(db, "businesses", businessId, "externalRentals", id), {
      status: "returned",
      returnedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    if (row) {
      await sendNotification(
        `${row.itemName} (×${row.quantity}) returned from ${row.rentedTo}`,
        "rental_returned",
        { push: false }
      );
    }
  } catch (err) {
    console.error("Mark returned failed:", err);
    alert("Could not mark returned: " + err.message);
  }
}

async function deleteLentOut(id) {
  if (!confirm("Delete this lent-out record?")) return;
  const row = lentOutCache.find(r => r.id === id);
  try {
    await deleteDoc(doc(db, "businesses", businessId, "externalRentals", id));
    if (row) {
      await sendNotification(
        `Lent-out record deleted: ${row.itemName} (×${row.quantity}) to ${row.rentedTo}`,
        "rental_deleted",
        { push: false }
      );
    }
  } catch (err) {
    console.error("Delete failed:", err);
    alert("Could not delete: " + err.message);
  }
}

/* ============================================================
   SAVE LENT OUT (Option 2 — one doc per item)
============================================================ */
async function saveLentOut() {
  const business = document.getElementById("fBusiness").value.trim();
  const contactPerson = document.getElementById("fContact").value.trim();
  const contactPhone = document.getElementById("fPhone").value.trim();
  const rentalDate = document.getElementById("fOut").value;
  const returnDate = document.getElementById("fReturn").value;
  const notes = document.getElementById("fNotes").value.trim();

  if (!business) { alert("Business name is required."); return; }

  // Collect rows
  const rows = [];
  document.querySelectorAll("#itemsContainer .item-row").forEach(r => {
    const itemName = r.querySelector(".item-name").value;
    const quantity = Number(r.querySelector(".item-qty").value || 0);
    const price = Number(r.querySelector(".item-price").value || 0);
    if (itemName && quantity > 0) {
      rows.push({ itemName, quantity, price });
    }
  });

  if (!rows.length) { alert("Add at least one item."); return; }

  // Availability warning
  const short = rows.filter(r => r.quantity > getFreeNow(r.itemName));
  if (short.length) {
    const msg = short
      .map(r => `${r.itemName}: lending ${r.quantity}, only ${getFreeNow(r.itemName)} free`)
      .join("\n");
    const ok = confirm(`⚠ Not enough free stock:\n${msg}\n\nContinue anyway?`);
    if (!ok) return;
  }

  const saveBtn = document.getElementById("saveBtn");
  saveBtn.disabled = true;
  const originalText = saveBtn.textContent;
  saveBtn.textContent = "Saving...";

  try {
    const col = collection(db, "businesses", businessId, "externalRentals");
    for (const r of rows) {
      await addDoc(col, {
        itemName: r.itemName,
        quantity: r.quantity,
        price: r.price,
        rentedTo: business,
        contactPerson,
        contactPhone,
        rentalDate,
        returnDate,
        notes,
        status: "active",
        createdAt: serverTimestamp()
      });
    }

    const summary = rows.map(r => `${r.quantity}× ${r.itemName}`).join(", ");
    await sendNotification(
      `Lent out to ${business}: ${summary}`,
      "rental_lent_out",
      { push: true }
    );

    closeAddCard();
    clearAddForm();
  } catch (err) {
    console.error("Save failed:", err);
    alert("Could not save: " + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

/* ============================================================
   TABS
============================================================ */
function wireTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === currentTab) return;
      currentTab = tab;

      document.querySelectorAll(".tab-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === tab);
      });

      const addBtn = document.getElementById("addBtn");
      addBtn.style.display = tab === "out" ? "inline-flex" : "none";

      if (tab !== "out") closeAddCard();

      if (tab === "in" && businessId) loadBorrowedIn(businessId);
      renderRows();
    });
  });
}

/* ============================================================
   BOOT
============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "signup.html"; return; }
  currentUser = user;

  try {
    businessId = await getBusinessIdByEmail(user.email, user);
  } catch (err) {
    console.error("Auth error:", err);
    return;
  }

  // Brand name
  try {
    const bizSnap = await getDoc(doc(db, "businesses", businessId));
    if (bizSnap.exists()) {
      const name = bizSnap.data().name || "Tracknrent";
      const el1 = document.getElementById("brand-name-mobile");
      const el2 = document.getElementById("brand-name-mobile-2");
      if (el1) el1.textContent = name;
      if (el2) el2.textContent = name;
    }
  } catch {}

  await loadInventory(businessId);
  await loadBorrowedIn(businessId);

  subscribeLentOut(businessId);
  wireTabs();

  // Add card wiring
  document.getElementById("addBtn").addEventListener("click", openAddCard);
  document.getElementById("cancelBtn").addEventListener("click", () => {
    closeAddCard();
    clearAddForm();
  });
  document.getElementById("saveBtn").addEventListener("click", saveLentOut);
  document.getElementById("addItemBtn").addEventListener("click", addItemRow);

  // Initialize with one empty row
  addItemRow();

  document.getElementById("statusFilter").addEventListener("change", renderRows);
  document.getElementById("searchInput").addEventListener("input", renderRows);

  renderRows();
});