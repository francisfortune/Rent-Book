// assets/js/settings.js
import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signOut, onAuthStateChanged } from
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
  if (snap.empty) return null;
  return snap.docs[0].data().businessId;
}
function setUserAvatar(businessName) {
    const avatar = document.getElementById("user-avatar");
    if (!avatar || !businessName) return;
  
    avatar.textContent = businessName.charAt(0).toUpperCase();
  }
  

/* =========================
   AUTH GUARD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  const businessId = await getBusinessId(user.email);
  if (!businessId) {
    window.location.href = "setup.html";
    return;
  }

  const membersRef = collection(db, "businessMembers");

  /* =========================
     INVITE PARTNER
  ========================= */
  invitePartnerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = partnerEmail.value.trim().toLowerCase();

    // Prevent duplicate invite
    const exists = await getDocs(
      query(membersRef,
        where("email", "==", email),
        where("businessId", "==", businessId)
      )
    );

    if (!exists.empty) {
      alert("User already invited");
      return;
    }

    await addDoc(membersRef, {
      email,
      role: partnerRole.value,
      businessId,
      invitedBy: user.email,
      createdAt: serverTimestamp()
    });

    invitePartnerForm.reset();
    loadPartners();
  });

  /* =========================
     LOAD PARTNERS
  ========================= */
  async function loadPartners() {
    const snap = await getDocs(
      query(membersRef, where("businessId", "==", businessId))
    );

    partnersList.innerHTML = "";

    snap.forEach(d => {
      const p = d.data();
      partnersList.innerHTML += `
        <div class="partner-row">
          ${p.email} — <strong>${p.role}</strong>
        </div>
      `;
    });
  }

  loadPartners();

  /* =========================
     LOGOUT
  ========================= */
  document
    .querySelector(".logout-btn")
    .addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "signup.html";
    });
});
