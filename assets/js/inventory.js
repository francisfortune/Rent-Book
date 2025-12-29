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
const calcItem = document.getElementById("calcItem");
const calcQty = document.getElementById("calcQty");
const calcResult = document.getElementById("calcResult");

// Edit Modal Elements
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
   RENDER
========================= */
function renderInventory(items) {
  inventoryList.innerHTML = "";
  calcItem.innerHTML = "";

  let totalQty = 0;
  let availableQty = 0;

  items.forEach(item => {
    totalQty += item.totalQuantity;
    availableQty += item.availableQuantity;

    const itemDiv = document.createElement('div');
    itemDiv.className = 'inventory-item flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100 mb-3';
    itemDiv.innerHTML = `
      <div>
        <strong class="text-gray-800 text-lg">${item.name}</strong><br>
        <span class="text-gray-500 text-sm">Total: ${item.totalQuantity} | Available: <span class="${item.availableQuantity <= 5 ? 'text-red-500 font-bold' : ''}">${item.availableQuantity}</span></span><br>
        <span class="text-purple-600 font-medium">₦${item.price} / unit</span>
      </div>
      <button class="edit-btn p-2 bg-white rounded-full shadow-sm hover:shadow-md transition-all text-purple-600" data-id="${item.id}">
        <ion-icon name="create-outline"></ion-icon>
      </button>
    `;

    // Store data on the button for easy access
    const btn = itemDiv.querySelector('.edit-btn');
    btn.onclick = () => openEditModal(item);

    inventoryList.appendChild(itemDiv);

    calcItem.innerHTML += `
      <option value="${item.availableQuantity}">
        ${item.name}
      </option>
    `;
  });

  totalItemsEl.innerText = items.length;
  availableItemsEl.innerText = availableQty;
  outItemsEl.innerText = totalQty - availableQty;
}

/* =========================
   AUTH + LIVE DATA
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    const businessId = await getBusinessId(user.email);
    const invRef = collection(db, "businesses", businessId, "inventory");

    onSnapshot(invRef, (snap) => {
      if (snap.empty) {
        inventoryList.innerHTML = "<p class='text-center py-8 text-gray-500'>No inventory items yet. Add your first item above!</p>";
        totalItemsEl.innerText = "0";
        availableItemsEl.innerText = "0";
        outItemsEl.innerText = "0";
        return;
      }

      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderInventory(items);
    });

    /* EDIT MODAL LOGIC */
    function openEditModal(item) {
      editItemId.value = item.id;
      editItemName.value = item.name;
      editItemQty.value = item.totalQuantity;
      editItemAvail.value = item.availableQuantity;
      editItemPrice.value = item.price;
      editModal.classList.remove('hidden');
    }

    closeEditModal.onclick = () => editModal.classList.add('hidden');

    editItemForm.onsubmit = async (e) => {
      e.preventDefault();
      const id = editItemId.value;
      const itemRef = doc(db, "businesses", businessId, "inventory", id);

      await updateDoc(itemRef, {
        name: editItemName.value.trim(),
        totalQuantity: Number(editItemQty.value),
        availableQuantity: Number(editItemAvail.value),
        price: Number(editItemPrice.value),
        updatedAt: serverTimestamp()
      });

      editModal.classList.add('hidden');
    };

    deleteItemBtn.onclick = async () => {
      if (confirm("Are you sure you want to delete this item?")) {
        const id = editItemId.value;
        await deleteDoc(doc(db, "businesses", businessId, "inventory", id));
        editModal.classList.add('hidden');
      }
    };

    /* ADD ITEM */
    document
      .getElementById("addItemForm")
      .addEventListener("submit", async (e) => {
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
    calcResult.innerText = "Enter quantity";
    calcResult.style.color = "orange";
    return;
  }

  if (needed <= available) {
    calcResult.innerText = "Available ✅";
    calcResult.style.color = "green";
  } else {
    calcResult.innerText = "Not enough stock ❌";
    calcResult.style.color = "red";
  }
};
