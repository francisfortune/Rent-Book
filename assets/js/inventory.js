import { auth, db } from "./firebase.js";
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
   BUSINESS LOOKUP
========================= */
async function getBusinessId(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("No business");
  return snap.docs[0].data().businessId;
}

/* =========================
   DOM
========================= */
const totalItemsEl = document.getElementById("totalItems");
const availableItemsEl = document.getElementById("availableItems");
const outItemsEl = document.getElementById("outItems");
const inventoryList = document.getElementById("inventoryList");
const inventorySearch = document.getElementById("inventorySearch");

const calcItem = document.getElementById("calcItem");
const calcQty = document.getElementById("calcQty");
const calcResult = document.getElementById("calcResult");

// Overbooked panel
const overbookedList = document.getElementById("overbookedList");

// Edit modal
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
   RENDER INVENTORY
========================= */
function renderInventory(filteredItems, allItems) {
  inventoryList.innerHTML = "";
  calcItem.innerHTML = "";

  let totalQty = 0;
  let availableQty = 0;
  let outQty = 0;

  allItems.forEach(item => {
const totalItems = allItems.length;
const availableItems = allItems.filter(i => i.availableQuantity > 0).length;
const outItems = allItems.filter(i => i.availableQuantity === 0).length;

totalItemsEl.textContent = totalItems;
availableItemsEl.textContent = availableItems;
outItemsEl.textContent = outItems;

    calcItem.innerHTML += `
      <option value="${item.availableQuantity}">
        ${item.name}
      </option>`;
  });

  filteredItems.forEach(item => {
    const div = document.createElement("div");
    div.className =
      "inventory-item flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100";

    div.innerHTML = `
      <div>
        <strong class="text-lg">${item.name}</strong><br>
        <span class="text-sm text-gray-500">
          Total: ${item.totalQuantity} |
          Available:
          <span class="${item.availableQuantity <= 5 ? "text-red-600 font-bold" : ""}">
            ${item.availableQuantity}
          </span>
        </span><br>
        <span class="text-purple-600">₦${item.price} / unit</span>
      </div>
      <button class="edit-btn text-purple-600">
        <ion-icon name="create-outline"></ion-icon>
      </button>
    `;

    div.querySelector(".edit-btn").onclick = () => openEditModal(item);
    inventoryList.appendChild(div);
  });

  totalItemsEl.textContent = totalQty;
  availableItemsEl.textContent = availableQty;
  outItemsEl.textContent = outQty;
}

/* =========================
   OVERBOOKED PANEL
========================= */
function listenToOverbooked(businessId) {
  const ref = collection(db, "businesses", businessId, "bookings");

  onSnapshot(ref, snap => {
    if (!overbookedList) return;

    overbookedList.innerHTML = "";

    const overbooked = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b =>
        b.status === "active" &&
        b.items?.some(i => i.shortage > 0)
      );

    if (!overbooked.length) {
      overbookedList.innerHTML =
        `<p class="text-gray-500">No overbooked items 🎉</p>`;
      return;
    }

    overbooked.forEach(b => {
      const borrowed = b.items
        .filter(i => i.shortage > 0)
        .map(i => `${i.shortage} × ${i.name}`)
        .join(", ");

      const div = document.createElement("div");
      div.className =
        "p-3 bg-orange-50 border border-orange-200 rounded-lg cursor-pointer hover:bg-orange-100";

      div.innerHTML = `
        <p class="font-semibold">${b.client?.name}</p>
        <p class="text-xs text-gray-600">${b.event?.date}</p>
        <p class="text-orange-700 text-sm">
          Borrowed: ${borrowed}
        </p>
      `;

      div.onclick = () => {
        window.location.href = `bookings.html#${b.id}`;
      };

      overbookedList.appendChild(div);
    });
  });
}

/* =========================
   AUTH + LIVE DATA
========================= */
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    const businessId = await getBusinessId(user.email);
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
        const filtered = allItems.filter(i =>
          i.name.toLowerCase().includes(q)
        );

        if (!allItems.length) {
          inventoryList.innerHTML =
            "<p class='text-center text-gray-500'>No inventory items yet</p>";
          totalItemsEl.textContent = "0";
          availableItemsEl.textContent = "0";
          outItemsEl.textContent = "0";
          return;
        }

        renderInventory(filtered, allItems);
      }

      inventorySearch.oninput = filterAndRender;
      filterAndRender();
    });

    listenToOverbooked(businessId);

    /* ADD ITEM */
    document.getElementById("addItemForm")
      .addEventListener("submit", async e => {
        e.preventDefault();

        await addDoc(invRef, {
          name: itemName.value.trim(),
          totalQuantity: Number(itemQty.value),
          availableQuantity: Number(itemQty.value),
          price: Number(itemPrice.value),
          createdAt: serverTimestamp()
        });

        e.target.reset();
      });

    /* EDIT MODAL */
    function openEditModal(item) {
      editItemId.value = item.id;
      editItemName.value = item.name;
      editItemQty.value = item.totalQuantity;
      editItemAvail.value = item.availableQuantity;
      editItemPrice.value = item.price;
      editModal.classList.remove("hidden");
    }

    closeEditModal.onclick = () =>
      editModal.classList.add("hidden");

    editItemForm.onsubmit = async e => {
      e.preventDefault();
      const ref = doc(db, "businesses", businessId, "inventory", editItemId.value);

      await updateDoc(ref, {
        name: editItemName.value.trim(),
        totalQuantity: Number(editItemQty.value),
        availableQuantity: Number(editItemAvail.value),
        price: Number(editItemPrice.value),
        updatedAt: serverTimestamp()
      });

      editModal.classList.add("hidden");
    };

    deleteItemBtn.onclick = async () => {
      if (!confirm("Delete this item?")) return;
      await deleteDoc(
        doc(db, "businesses", businessId, "inventory", editItemId.value)
      );
      editModal.classList.add("hidden");
    };

  } catch (err) {
    console.error(err);
    window.location.href = "setup.html";
  }
});

/* =========================
   AVAILABILITY CHECK
========================= */
document.getElementById("checkBtn").onclick = () => {
  const available = Number(calcItem.value);
  const needed = Number(calcQty.value);

  if (!needed) {
    calcResult.textContent = "Enter quantity";
    calcResult.style.color = "orange";
    return;
  }

  if (needed <= available) {
    calcResult.textContent = "Available ✅";
    calcResult.style.color = "green";
  } else {
    calcResult.textContent = "Not enough stock ❌";
    calcResult.style.color = "red";
  }
};
