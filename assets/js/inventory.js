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
   NOTIFICATION HELPER
========================= */
async function sendInventoryNotification(businessId, message, type = "inventory") {
  try {
    const notifRef = collection(db, "businesses", businessId, "notifications");
    await addDoc(notifRef, {
      message: message,
      type: type,
      triggeredBy: auth.currentUser.email,
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
  } catch (err) {
    console.error("Notification failed:", err);
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
async function getBusinessId(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("No business found");
  return snap.docs[0].data().businessId;
}

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
========================= */
function renderInventory(filteredItems, allItems) {
  inventoryList.innerHTML = "";
  calcItem.innerHTML = "";

  let totalAvailableQty = 0;
  let totalOutQty = 0;

  // Totals & dropdown
  allItems.forEach(item => {
    totalAvailableQty += item.availableQuantity;
    totalOutQty += (item.totalQuantity - item.availableQuantity);

    calcItem.innerHTML += `
      <option value="${item.availableQuantity}">
        ${item.name} (${item.availableQuantity} avail)
      </option>
    `;
  });

  totalItemsEl.textContent = allItems.length;
  availableItemsEl.textContent = totalAvailableQty;
  outItemsEl.textContent = totalOutQty;

  // Inventory list
  filteredItems.forEach(item => {
    const div = document.createElement("div");
    div.className = "inventory-item flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100 mb-3";
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
}

/* =========================
   OVERBOOKED PANEL (SYNCED WITH BOOKINGS.JS)
========================= */
function listenToOverbooked(businessId) {
  const overbookedList = document.getElementById("overbookedList") || document.getElementById("overbooked-list"); 
  if (!overbookedList) return;

  const ref = collection(db, "businesses", businessId, "bookings");

  onSnapshot(ref, snap => {
    overbookedList.innerHTML = "";

    // 1. Get current date for status calculation (Matching bookings.js logic)
    const today = new Date().toISOString().split('T')[0];

    const overbooked = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => {
        // Only show if: 
        // A) It's not marked as returned 
        // B) It's not overdue or it's active (Status isn't "returned")
        // C) It actually has items with a shortage
        const status = b.status === "returned" ? "returned" : (today > b.event?.returnDate ? "overdue" : "active");
        return status !== "returned" && b.items?.some(i => (Number(i.shortage) || 0) > 0);
      });

    if (!overbooked.length) {
      overbookedList.innerHTML = `<p class="text-center text-gray-400 py-6 italic text-sm">No overbooked items 🎉</p>`;
      return;
    }

    overbooked.forEach(b => {
      const borrowedItems = b.items
        .filter(i => (Number(i.shortage) || 0) > 0)
        .map(i => {
          // SYNCED: Using 'supplier' as primary field to match your bookings.js
          const vendor = i.supplier || i.vendorName || i.vendor || "Unknown Vendor";
          return `• ${i.shortage} × ${i.name} <span class="text-purple-700 font-bold">[${vendor}]</span>`;
        });

      const vendorBlock = `<div class="bg-purple-50 border border-purple-100 rounded-xl p-3 mt-3">
             <p class="text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">Vendor / Borrowed Items</p>
             <div class="text-[11px] text-gray-700 leading-relaxed">
               ${borrowedItems.join("<br>")}
             </div>
           </div>`;

      const div = document.createElement("div");
      div.className = "p-4 mb-3 bg-white border border-gray-100 rounded-2xl shadow-sm border-l-4 border-l-orange-500 transition-all hover:shadow-md cursor-pointer";
      
      div.innerHTML = `
        <div class="flex justify-between items-start">
          <div>
            <p class="font-bold text-gray-900 text-sm">${b.client?.name || "Client"}</p>
            <p class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
              <ion-icon name="calendar-outline"></ion-icon> ${b.event?.date || "No Date"}
            </p>
          </div>
          <span class="bg-orange-100 text-blue-600 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">Shortage</span>
        </div>
        ${vendorBlock}
      `;
      
      div.onclick = () => window.location.href = `bookings.html#${b.id}`;
      overbookedList.appendChild(div);
    });
  });
}



/* =========================
   AUTH & LIVE DATA
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

  await addDoc(invRef, {
    name: name,
    totalQuantity: qty,
    availableQuantity: qty,
    price: Number(itemPrice.value),
    createdAt: serverTimestamp()
  });

  // Notification
  await sendInventoryNotification(businessId, `New item added: ${name} (${qty} units)`, "add");
  
  e.target.reset();
});
    // Close edit modal
    closeEditModal.onclick = () => editModal.classList.add("hidden");

  // Save changes in edit modal
editItemForm.onsubmit = async e => {
  e.preventDefault();
  const name = editItemName.value.trim();
  const avail = Number(editItemAvail.value);
  const ref = doc(db, "businesses", businessId, "inventory", editItemId.value);

  await updateDoc(ref, {
    name: name,
    totalQuantity: Number(editItemQty.value),
    availableQuantity: avail,
    price: Number(editItemPrice.value),
    updatedAt: serverTimestamp()
  });

  // 🔔 Trigger Low Stock Notification
  if (avail <= 5) {
    await sendInventoryNotification(businessId, `⚠️ Low Stock Alert: ${name} only has ${avail} left!`, "inventory");
  } else {
    await sendInventoryNotification(businessId, `Updated item: ${name}`, "inventory");
  }

  editModal.classList.add("hidden");
};
// Delete item
deleteItemBtn.onclick = async () => {
  const name = editItemName.value; // Get name before deleting
  if (!confirm(`Are you sure you want to delete ${name}?`)) return;
  
  await deleteDoc(doc(db, "businesses", businessId, "inventory", editItemId.value));
  
  await sendInventoryNotification(businessId, `Permanent Delete: ${name} was removed from inventory`, "inventory");
  
  editModal.classList.add("hidden");
};
  } catch (err) {
    console.error(err);
    window.location.href = "signup.html";
  }
});

/* =========================
   AVAILABILITY CHECK
========================= */
document.getElementById("checkBtn").onclick = () => {
  const available = Number(calcItem.value);
  const needed = Number(calcQty.value);

  if (!needed || needed <= 0) {
    calcResult.textContent = "Enter a valid quantity";
    calcResult.style.color = "orange";
    return;
  }

  if (needed <= available) {
    const remaining = available - needed;
    calcResult.textContent = `Available ✅ (${remaining} will remain)`;
    calcResult.style.color = "green";
  } else {
    const shortage = needed - available;
    calcResult.textContent = `Not enough ❌ (short by ${shortage})`;
    calcResult.style.color = "red";
  }
};
// ===== DYNAMIC BUY ME A COFFEE BUTTON WITH FLOATING ANIMATION =====
(function() {
  const bmcLink = "https://www.buymeacoffee.com/francisfortune"; // your profile link

  // Create Buy Me a Coffee button
  const coffeeBtn = document.createElement("button");
  coffeeBtn.id = "buyCoffeeBtn";
  coffeeBtn.innerHTML = "☕ Support Me";
  coffeeBtn.style.position = "fixed";
  coffeeBtn.style.bottom = "80px"; // leave space for bottom nav
  coffeeBtn.style.right = "20px";
  coffeeBtn.style.background = "Purple";
  coffeeBtn.style.color = "#ffffff";
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

  // Hover effect
  coffeeBtn.onmouseover = () => {
    coffeeBtn.style.transform = "translateY(-6px)";
    coffeeBtn.style.boxShadow = "0 12px 24px rgba(0,0,0,0.35)";
  };
  coffeeBtn.onmouseout = () => {
    coffeeBtn.style.transform = "translateY(0)";
    coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
  };

  // Floating animation CSS
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
    /* Optional: Product Hunt button styles if used */
    #productHuntBtn {
      animation: floatButton 3s ease-in-out infinite;
      background: linear-gradient(135deg, #DA552F, #FF6F4C);
      color: #fff;
      font-weight: 700;
      border-radius: 50px;
      border: none;
      cursor: pointer;
      box-shadow: 0 8px 16px rgba(0,0,0,0.3);
      padding: 0.7rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s, box-shadow 0.3s;
      z-index: 9999;
      position: fixed;
      bottom: 20px; /* will adjust dynamically */
      right: 20px;
    }
    #productHuntBtn:hover {
      transform: translateY(-6px);
      box-shadow: 0 12px 24px rgba(0,0,0,0.35);
    }
  `;
  document.head.appendChild(style);

  // Responsive function
  function updateBtnSize() {
    const bottomMargin = 20; // default bottom spacing
    if (window.innerWidth < 768) {
      coffeeBtn.style.padding = "0.5rem 1.3rem";
      coffeeBtn.style.fontSize = "1.4rem";
      coffeeBtn.style.bottom = "130px"; // extra space for bottom nav
      coffeeBtn.style.right = "15px";
      // If Product Hunt button is used
      const phBtn = document.getElementById("productHuntBtn");
      if (phBtn) phBtn.style.bottom = "40px"; // below coffee button
    } else {
      coffeeBtn.style.padding = "0.7rem 1.5rem";
      coffeeBtn.style.fontSize = "1rem";
      coffeeBtn.style.bottom = "80px";
      coffeeBtn.style.right = "20px";
      const phBtn = document.getElementById("productHuntBtn");
      if (phBtn) phBtn.style.bottom = "20px";
    }
  }
  window.addEventListener("resize", updateBtnSize);
  updateBtnSize();

  // Append Buy Me a Coffee button
  document.body.appendChild(coffeeBtn);

  // Popup portal
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

  // Tooltip/Bio
  coffeeBtn.title = `
Hi! I'm Francis Fortune.
I’m passionate about motivating young teens to explore technology, learn new skills, and create innovative solutions.
.
`;

  // ===== PRODUCT HUNT BUTTON (COMMENTED OUT FOR NOW) =====
  /*
  const phLink = "https://www.producthunt.com/posts/your-product";
  const phBtn = document.createElement("button");
  phBtn.id = "productHuntBtn";
  phBtn.innerHTML = "🚀 Product Hunt";
  phBtn.onclick = () => window.open(phLink, "_blank");
  document.body.appendChild(phBtn);
  updateBtnSize();
  */
})();
