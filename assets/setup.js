// assets/js/setup.js
import { auth, db } from "./firebase.js";

import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
   GUARD: ENSURE USER HAS NO BUSINESS
========================= */
async function ensureNoExistingBusiness(user) {
  let businessId = null;
  if (user.email) {
    const emailLower = user.email.toLowerCase().trim();
    const q = query(
      collection(db, "businessMembers"),
      where("email", "==", emailLower)
    );
    let snap = await getDocs(q);
    if (snap.empty && user.email.trim() !== emailLower) {
      const qRaw = query(
        collection(db, "businessMembers"),
        where("email", "==", user.email.trim())
      );
      snap = await getDocs(qRaw);
    }
    if (!snap.empty) {
      businessId = snap.docs[0].data().businessId;
    }
  }
  if (!businessId && user.phoneNumber) {
    const q = query(
      collection(db, "businessMembers"),
      where("phone", "==", user.phoneNumber.trim())
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      businessId = snap.docs[0].data().businessId;
    }
  }

  if (businessId && navigator.onLine) {
    try {
      const bizSnap = await getDoc(doc(db, "businesses", businessId));
      if (bizSnap.exists()) {
        return false;
      }
    } catch (e) {
      console.error("Error verifying existing business doc:", e);
      return false;
    }
  }
  return true;
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





function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function processReferral(user, newBusinessId) {
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const refCode = userSnap.exists() ? userSnap.data().referredByCode : null;
    if (!refCode) return;

    const q = query(collection(db, "businesses"), where("referralCode", "==", refCode));
    const snap = await getDocs(q);
    if (snap.empty) return;

    const referrerDoc = snap.docs[0];
    if (referrerDoc.id === newBusinessId) return; // no self-referrals

    await addDoc(collection(db, "referrals"), {
      referrerBusinessId: referrerDoc.id,
      referredBusinessId: newBusinessId,
      referralCode: refCode,
      status: "valid",
      createdAt: serverTimestamp()
    });

    const newCount = (referrerDoc.data().referralCount || 0) + 1;
    const updates = { referralCount: newCount };
    if (newCount >= 10) updates["features.marketplace"] = true;
    await updateDoc(doc(db, "businesses", referrerDoc.id), updates);

    await addDoc(collection(db, "businesses", referrerDoc.id, "notifications"), {
      message: newCount >= 10
        ? "🎉 Referral milestone reached! Your business now has a featured Marketplace listing."
        : `🤝 A business you referred just completed setup! (${newCount}/10 referrals)`,
      type: "referral",
      triggeredBy: "Tracknrent",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
  } catch (err) {
    console.error("Referral processing failed:", err);
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

  referralCode: generateReferralCode(),   // ← add
  referralCount: 0,                       // ← add
  features: { marketplace: false },       // ← add
      settings: {
        inventoryEditableByStaff: false
      },
      createdAt: serverTimestamp()
    });

    await addDoc(collection(db, "businessMembers"), {
      businessId: businessRef.id,
      uid: user.uid,
      email: user.email ? user.email.toLowerCase().trim() : null,
      phone: user.phoneNumber || null,
      role: "owner",
      addedAt: serverTimestamp()
    });

    // Update users/{uid} document with businessId
    await setDoc(doc(db, "users", user.uid), {
      businessId: businessRef.id
    }, { merge: true });

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
          totalQuantity: qty,
          availableQuantity: qty,
          price,
          createdAt: serverTimestamp()
        }
      );
    }

    // ✅ ADD THIS LINE HERE (Right before redirect)
    await sendWelcomeNotification(businessRef.id, businessName);
    await processReferral(user, businessRef.id);

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

  const allowed = await ensureNoExistingBusiness(user);

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
/* =========================
   WELCOME NOTIFICATION
========================= */
async function sendWelcomeNotification(businessId, businessName) {
  try {
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `Welcome ${businessName}! 🎉 To get started, go to the Inventory tab to manage your items, or use the Bookings tab to schedule your first client event. We're here to help you grow!`,
      type: "welcome",
      triggeredBy: "Tracknrent",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
  } catch (err) {
    console.error("Welcome notification failed:", err);
  }
}