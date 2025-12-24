// assets/js/setup.js

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
   ADD INVENTORY ROW
========================= */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const businessRef = doc(db, "businesses", user.uid);
  const businessSnap = await getDoc(businessRef);

  if (businessSnap.exists()) {
    // Business already set up → block this page
    window.location.href = "dashboard.html";
  }
});

await addDoc(collection(db, "inventory"), {
  businessId: userId,
  name: name,
  totalQuantity: Number(qty),
  availableQuantity: Number(qty), // initially all available
  alertLevel: Number(alert),
  createdAt: new Date()
});




const addInventoryBtn = document.getElementById("addInventoryItem");
const inventoryWrapper = document.getElementById("inventoryWrapper");

addInventoryBtn.addEventListener("click", () => {
  const row = document.createElement("div");
  row.className = "inventory-row";

  row.innerHTML = `
    <input class="item-name" type="text" placeholder="Item name" />
    <input class="item-qty" type="number" placeholder="Quantity" />
    <input class="item-alert" type="number" placeholder="Low stock alert" />
  `;

  inventoryWrapper.appendChild(row);
});

/* =========================
   FINISH SETUP
========================= */

const finishBtn = document.getElementById("finishSetup");

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // No user? Go back to login
    window.location.href = "login.html";
    return;
  }

  const userId = user.uid;

  finishBtn.addEventListener("click", async () => {

    /* BUSINESS INFO */
    const businessData = {
      name: document.getElementById("businessName").value,
      type: document.getElementById("businessType").value,
      location: document.getElementById("businessLocation").value,
      phone: document.getElementById("businessPhone").value,
      ownerId: userId,
      createdAt: new Date()
    };

    // Save business under user
    await setDoc(doc(db, "businesses", userId), businessData);

    /* INVENTORY */
    const rows = document.querySelectorAll(".inventory-row");

    for (let row of rows) {
      const name = row.querySelector(".item-name").value;
      const qty = row.querySelector(".item-qty").value;
      const alert = row.querySelector(".item-alert").value;

      if (!name || !qty) continue;

      await addDoc(collection(db, "inventory"), {
        businessId: userId,
        name: name,
        quantity: Number(qty),
        alertLevel: Number(alert),
        createdAt: new Date()
      });
    }

    // DONE
    window.location.href = "dashboard.html";
  });
});
