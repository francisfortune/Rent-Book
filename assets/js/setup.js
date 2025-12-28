// assets/js/setup.js
import { auth, db } from "./firebase.js";

import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
   GUARD: ENSURE USER HAS NO BUSINESS
========================= */
async function ensureNoExistingBusiness(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );

  const snap = await getDocs(q);
  return snap.empty;
}

/* =========================
   CREATE INVENTORY
========================= */
async function createInitialInventory(businessId) {
  const inventoryItems = document.querySelectorAll(".inventory-item");

  for (const item of inventoryItems) {
    const name = item.querySelector(".item-name")?.value.trim();
    const qty = Number(item.querySelector(".item-qty")?.value || 0);
    const price = Number(item.querySelector(".item-price")?.value || 0);

    if (!name || qty <= 0) continue;

    await addDoc(collection(db, "inventory"), {
      businessId,
      name,
      quantity: qty,
      price,
      createdAt: serverTimestamp()
    });
  }
}

/* =========================
   SETUP SUBMIT
========================= */async function handleSetupSubmit(user) {
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Setting up...";

  try {
    const businessName = document.getElementById("businessName").value.trim();

    // 1️⃣ Create business
    const businessRef = await addDoc(collection(db, "businesses"), {
      name: businessName,
      ownerId: user.uid,
      currency: "NGN",
      location: "Enugu",
      settings: {
        inventoryEditableByStaff: false
      },
      createdAt: serverTimestamp()
    });

    // 2️⃣ Attach owner
    await addDoc(collection(db, "businessMembers"), {
      businessId: businessRef.id,
      uid: user.uid,
      email: user.email,
      role: "owner",
      addedAt: serverTimestamp()
    });

    // 3️⃣ SAVE INVENTORY (NESTED)
    const items = document.querySelectorAll(".inventory-item");

    for (const item of items) {
      const name = item.querySelector(".item-name").value.trim();
      const qty = Number(item.querySelector(".item-qty").value);
      const price =
        Number(item.querySelector(".item-price").value) || 0;

      if (!name || !qty) continue;

      await addDoc(
        collection(db, "businesses", businessRef.id, "inventory"),
        {
          name,
          quantity: qty,
          price,
          createdAt: serverTimestamp()
        }
      );
    }

    window.location.href = "dashboard.html";

  } catch (err) {
    console.error("Setup failed:", err);
    alert("Setup failed. Check Firestore rules.");
    btn.disabled = false;
    btn.textContent = "Complete Setup";
  }
}

/* =========================
   AUTH GUARD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  const allowed = await ensureNoExistingBusiness(user.email);

  if (!allowed) {
    window.location.href = "dashboard.html";
    return;
  }

  const form = document.getElementById("setupForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSetupSubmit(user);
    });
  }
});
