import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  getDocs,
  where,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentRole = "viewer";
let currentBusiness = null;
let allBookings = [];
let inventoryItems = [];

/* ---------------- LOAD INVENTORY ---------------- */
async function loadInventory() {
  const snap = await getDocs(collection(db, "businesses", currentBusiness, "inventory"));
  inventoryItems = [];
  snap.forEach(d => inventoryItems.push({ id: d.id, ...d.data() }));
}

/* ---------------- OVERBOOK CHECK (UPDATED) ---------------- */
function detectOverbooked(booking) {
  let over = [];

  booking.items.forEach(item => {
    const inv = inventoryItems.find(i => i.name === item.name);
    if (!inv) return;

    const borrowed = Number(item.borrowed || 0);

    if (Number(item.qty) > Number(inv.quantity) + borrowed) {
      over.push({
        name: item.name,
        requested: item.qty,
        available: inv.quantity,
        borrowed: borrowed
      });
    }
  });

  return over;
}

/* ---------------- STATUS ---------------- */
function getBookingStatus(b) {
  if (b.status === "returned") return "returned";
  if (detectOverbooked(b).length > 0) return "overbooked";

  const today = new Date();
  const returnDate = b.event?.returnDate ? new Date(b.event.returnDate) : null;

  if (returnDate && returnDate < today) return "overdue";
  return "active";
}

/* ---------------- STATUS BADGE ---------------- */
function statusBadge(status) {
  const map = {
    active: "bg-green-100 text-green-700",
    returned: "bg-purple-100 text-purple-700",
    overdue: "bg-red-100 text-red-700",
    overbooked: "bg-orange-100 text-orange-700"
  };
  return `<span class="px-3 py-1 text-xs font-bold ${map[status]}">${status.toUpperCase()}</span>`;
}

/* ---------------- TOTAL ---------------- */
function calcTotal(items) {
  return items.reduce((sum, i) => sum + Number(i.price) * Number(i.qty), 0);
}

/* ---------------- OPEN BOOKING ---------------- */
window.openBooking = function(booking, id) {
  const modal = document.getElementById("bookingModal");
  const content = document.getElementById("modalContent");

  const total = calcTotal(booking.items);
  const paid = booking.paid || 0;
  const balance = total - paid;
  const status = getBookingStatus(booking);
  const overItems = detectOverbooked(booking);

  const overBadge = overItems.length > 0 
    ? `<p class="text-red-600 font-bold">Overbooked Items: ${overItems.length}</p>` 
    : '';

  content.innerHTML = `
    <div class="space-y-6">

      <div class="bg-purple-700 text-white p-6 shadow flex justify-between">
        <div>
          <h2 class="text-2xl font-bold">${booking.client.name}</h2>
          <p>${booking.client.phone || ""}</p>
        </div>
        ${statusBadge(status)}
      </div>

      ${overBadge}

      <div class="bg-white border rounded-xl p-5">
        ${booking.items.map(i => {
          const borrowed = Number(i.borrowed || 0);
          return `
          <div class="border-b py-3">
            <p class="font-bold">${i.name}</p>
            <p>Qty: ${i.qty}</p>

            ${borrowed > 0 ? `
              <p class="text-orange-600">Borrowed: ${borrowed}</p>
              <p class="text-sm text-gray-500">From: ${i.supplier || "Unknown"}</p>
            ` : ""}
          </div>`;
        }).join("")}
      </div>

      <div>
        <p>Total: ₦${total}</p>
        <p>Paid: ₦${paid}</p>
        <p>Balance: ₦${balance}</p>
      </div>

      <div class="space-y-3">
        ${currentRole !== "viewer" && status !== "returned"
          ? `<button class="bg-purple-600 text-white p-3 w-full" onclick='openEditModal(${JSON.stringify(booking)},"${id}")'>Edit</button>`
          : ""}

        ${currentRole !== "viewer" && status !== "returned"
          ? `<button class="bg-purple-800 text-white p-3 w-full" onclick='returnBooking("${id}")'>Mark Returned</button>`
          : ""}

        ${["admin","owner"].includes(currentRole)
          ? `<button class="bg-red-600 text-white p-3 w-full" onclick='deleteBooking("${id}")'>Delete</button>`
          : ""}
      </div>
    </div>
  `;

  modal.style.display = "flex";
}

/* ---------------- EDIT MODAL (UPDATED) ---------------- */
window.openEditModal = function(b, id) {
  const content = document.getElementById("modalContent");

  content.innerHTML = `
    <div>
      <h2>Edit Booking</h2>

      <div id="itemsEditor">
        ${b.items.map(i => `
        <div class="itemRow grid grid-cols-6 gap-2 mb-2">
          <select class="item-name">
            ${inventoryItems.map(inv => `<option ${inv.name===i.name?"selected":""}>${inv.name}</option>`).join("")}
          </select>

          <input class="item-price" type="number" value="${i.price}">
          <input class="item-qty" type="number" value="${i.qty}">
          <input class="item-borrowed" type="number" value="${i.borrowed || 0}">
          <input class="item-supplier" placeholder="Supplier" value="${i.supplier || ""}">

          <button onclick="this.parentElement.remove()">✕</button>
        </div>
        `).join("")}
      </div>

      <button onclick="saveEdit('${id}')">Save</button>
    </div>
  `;
}

/* ---------------- SAVE EDIT ---------------- */
window.saveEdit = async function(id) {
  const items = [];

  document.querySelectorAll(".itemRow").forEach(row => {
    items.push({
      name: row.querySelector(".item-name").value,
      price: Number(row.querySelector(".item-price").value),
      qty: Number(row.querySelector(".item-qty").value),
      borrowed: Number(row.querySelector(".item-borrowed").value || 0),
      supplier: row.querySelector(".item-supplier").value || ""
    });
  });

  await updateDoc(doc(db, "businesses", currentBusiness, "bookings", id), { items });

  closeModal();
}

/* ---------------- RETURN (FIXED) ---------------- */
window.returnBooking = async function(id) {
  const index = allBookings.findIndex(b => b.id === id);
  const booking = allBookings[index];

  await Promise.all(
    booking.items.map(async item => {
      const inv = inventoryItems.find(i => i.name === item.name);
      if (!inv) return;

      const borrowed = Number(item.borrowed || 0);
      const ownedReturned = Number(item.qty) - borrowed;

      const newQty = Number(inv.quantity) + ownedReturned;

      await updateDoc(
        doc(db, "businesses", currentBusiness, "inventory", inv.id),
        { quantity: newQty }
      );

      inv.quantity = newQty;
    })
  );

  booking.status = "returned";
  allBookings[index] = booking;

  await updateDoc(
    doc(db, "businesses", currentBusiness, "bookings", id),
    { status: "returned" }
  );

  renderBookings();
  openBooking(booking, id);
}

/* ---------------- DELETE ---------------- */
window.deleteBooking = async function(id) {
  if (!confirm("Delete booking?")) return;
  await deleteDoc(doc(db, "businesses", currentBusiness, "bookings", id));
  renderBookings();
  closeModal();
}

/* ---------------- CLOSE MODAL ---------------- */
window.closeModal = function() {
  document.getElementById("bookingModal").style.display = "none";
}

/* ---------------- TABLE ROW ---------------- */
function renderRow(b) {
  const status = getBookingStatus(b);
  return `
    <tr>
      <td>${b.client?.name || ""}</td>
      <td>${b.event?.date || ""}</td>
      <td>${b.items?.length || 0} items</td>
      <td>${statusBadge(status)}</td>
      <td>
        <button onclick='openBooking(${JSON.stringify(b)},"${b.id}")'>View</button>
      </td>
    </tr>
  `;
}

/* ---------------- RENDER ---------------- */
function renderBookings() {
  const table = document.getElementById("bookingsTable");
  table.innerHTML = "";
  allBookings.forEach(b => table.innerHTML += renderRow(b));
}

/* ---------------- AUTH ---------------- */
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  const memberSnap = await getDocs(query(collection(db, "businessMembers"), where("email", "==", user.email)));
  const member = memberSnap.docs[0].data();

  currentRole = member.role;
  currentBusiness = member.businessId;

  await loadInventory();

  const q = query(collection(db, "businesses", currentBusiness, "bookings"), orderBy("createdAt", "desc"));

  onSnapshot(q, snap => {
    allBookings = [];
    snap.forEach(docSnap => allBookings.push({ id: docSnap.id, ...docSnap.data() }));
    renderBookings();
  });
});