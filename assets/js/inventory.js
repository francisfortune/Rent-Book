
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, query, where, getDocs, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "login.html";
  const userId = user.uid;

  const inventoryList = document.getElementById("inventoryList");
  const calcItem = document.getElementById("calcItem");
  const checkBtn = document.getElementById("checkBtn");
  const calcQty = document.getElementById("calcQty");
  const calcResult = document.getElementById("calcResult");
  const totalItemsEl = document.getElementById("totalItems");
  const availableItemsEl = document.getElementById("availableItems");
  const outItemsEl = document.getElementById("outItems");

  const staffForm = document.getElementById("staffForm");
  const staffList = document.getElementById("staffList");

  // Fetch Inventory
  async function loadInventory() {
    const q = query(collection(db, "inventory"), where("businessId", "==", userId));
    const snapshot = await getDocs(q);

    let totalItems = 0;
    let totalAvailable = 0;
    let totalOut = 0;
    inventoryList.innerHTML = "";
    calcItem.innerHTML = "";

    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const outQty = (data.totalQuantity - data.availableQuantity) || 0;

      totalItems += data.totalQuantity || 0;
      totalAvailable += data.availableQuantity || 0;
      totalOut += outQty;

      // Inventory item card
      const div = document.createElement("div");
      div.className = "inventory-item";
      div.innerHTML = `
        <div>
          <strong>${data.name}</strong>
          <p>Total: ${data.totalQuantity}</p>
        </div>
        <div class="stats">
          <span class="available">Available: ${data.availableQuantity}</span>
          <span class="out">Out: ${outQty}</span>
        </div>
      `;
      inventoryList.appendChild(div);

      // Add to calculator dropdown
      const option = document.createElement("option");
      option.value = data.name.toLowerCase();
      option.textContent = data.name;
      calcItem.appendChild(option);
    });

    totalItemsEl.textContent = totalItems;
    availableItemsEl.textContent = totalAvailable;
    outItemsEl.textContent = totalOut;
  }

  await loadInventory();

  // Inventory Calculator
  checkBtn.addEventListener("click", () => {
    const selectedItem = calcItem.value;
    const qty = Number(calcQty.value);
    if (!qty) {
      calcResult.textContent = "Enter a quantity.";
      calcResult.style.color = "black";
      return;
    }

    const q = query(collection(db, "inventory"), where("businessId", "==", userId));
    getDocs(q).then(snapshot => {
      const item = snapshot.docs.find(docSnap => docSnap.data().name.toLowerCase() === selectedItem);
      if (!item) {
        calcResult.textContent = "Item not found.";
        calcResult.style.color = "red";
        return;
      }
      const data = item.data();
      if (qty <= data.availableQuantity) {
        calcResult.textContent = "✅ You have enough items available.";
        calcResult.style.color = "green";
      } else {
        const short = qty - data.availableQuantity;
        calcResult.textContent = `⚠️ Short by ${short}. Rent from another rental or reduce quantity.`;
        calcResult.style.color = "#d00000";
      }
    });
  });

  // Staff Management
  staffForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("staffName").value;
    const role = document.getElementById("staffRole").value;
    const phone = document.getElementById("staffPhone").value;

    await addDoc(collection(db, "businesses", userId, "staff"), {
      name, role, phone, createdAt: new Date()
    });

    staffForm.reset();
    loadStaff();
  });

  async function loadStaff() {
    const q = query(collection(db, "businesses", userId, "staff"));
    const snapshot = await getDocs(q);
    staffList.innerHTML = "";
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const div = document.createElement("div");
      div.className = "staff-item";
      div.innerHTML = `
        <strong>${data.name}</strong> - ${data.role} - ${data.phone}
        <button data-id="${docSnap.id}" class="removeBtn">Remove</button>
      `;
      staffList.appendChild(div);
    });

    // Remove staff
    document.querySelectorAll(".removeBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const staffId = btn.dataset.id;
        await deleteDoc(doc(db, "businesses", userId, "staff", staffId));
        loadStaff();
      });
    });
  }

  await loadStaff();
});
