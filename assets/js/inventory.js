import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
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

    inventoryList.innerHTML += `
      <div class="inventory-item">
        <strong>${item.name}</strong><br>
        Total: ${item.totalQuantity}<br>
        Available: ${item.availableQuantity}<br>
        ₦${item.price} / unit
      </div>
    `;

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
        inventoryList.innerHTML = "<p>No inventory items yet</p>";
        totalItemsEl.innerText = "0";
        availableItemsEl.innerText = "0";
        outItemsEl.innerText = "0";
        return;
      }

      const items = snap.docs.map(d => d.data());
      renderInventory(items);
    });

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
