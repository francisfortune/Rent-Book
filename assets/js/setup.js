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
   GUARD: AUTH + NO BUSINESS
========================= */
async function ensureNoExistingBusiness(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );

  const snap = await getDocs(q);
  return snap.empty; // true = safe to create
}

/* =========================
   SETUP SUBMIT
========================= */
async function handleSetupSubmit(user) {
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Setting up...";

  try {
    const businessName =
      document.getElementById("businessName")?.value.trim();

    if (!businessName) {
      alert("Business name is required");
      btn.disabled = false;
      btn.textContent = "Complete Setup";
      return;
    }

    // 1️⃣ Create Business
    const businessRef = await addDoc(
      collection(db, "businesses"),
      {
        name: businessName,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      }
    );

    // 2️⃣ Attach Owner as Member
    await addDoc(collection(db, "businessMembers"), {
      businessId: businessRef.id,
      uid: user.uid,
      email: user.email,
      role: "owner",
      addedAt: serverTimestamp()
    });

    // 3️⃣ Redirect
    window.location.href = "dashboard.html";

  } catch (err) {
    console.error("Setup failed:", err);
    alert("Setup failed. Please try again.");
    btn.disabled = false;
    btn.textContent = "Complete Setup";
  }
}

/* =========================
   AUTH STATE LISTENER
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const allowed = await ensureNoExistingBusiness(user.email);

  if (!allowed) {
    // Already has a business → stop loop
    window.location.href = "dashboard.html";
    return;
  }

  // Bind submit only AFTER checks
  const form = document.getElementById("setupForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSetupSubmit(user);
    });
  }
});
