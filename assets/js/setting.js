// assets/js/settings.js
import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
  const invitePartnerForm = document.getElementById("invitePartnerForm");
  const partnerEmail = document.getElementById("partnerEmail");
  const partnerRole = document.getElementById("partnerRole");
  const partnersList = document.getElementById("partnersList");

  /* =========================
     INVITE PARTNER
  ========================= */
  if (invitePartnerForm) {
    invitePartnerForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = partnerEmail.value.trim().toLowerCase();
      const role = partnerRole.value;

      /* ==========================================
         ✅ NEW FIX: PREVENT MULTI-BUSINESS INVITES
      ========================================== */
      const globalMemberSnap = await getDocs(
        query(membersRef, where("email", "==", email))
      );

      if (!globalMemberSnap.empty) {
        const existingMember = globalMemberSnap.docs[0].data();

        if (existingMember.businessId !== businessId) {
          alert("This email is already linked to another business.");
          return;
        }
      }
      /* ===== END FIX ===== */

      // ✅ EXISTING: Prevent duplicate invite in SAME business
      const exists = await getDocs(
        query(
          membersRef,
          where("email", "==", email),
          where("businessId", "==", businessId)
        )
      );

      if (!exists.empty) {
        alert("This partner is already added to your business.");
        return;
      }

      // ✅ Check if user exists (optional)
      const userSnap = await getDocs(
        query(collection(db, "users"), where("email", "==", email))
      );

      let uid = null;
      let name = "Pending User";
      let status = "pending";

      if (!userSnap.empty) {
        const userData = userSnap.docs[0].data();
        uid = userData.uid;
        name = userData.name || "User";
        status = "accepted";
      }

      const permissions = {
        admin: { inventory: true, bookings: true, settings: true, reports: true },
        staff: { inventory: true, bookings: true, settings: false, reports: false },
        viewer: { inventory: false, bookings: false, settings: false, reports: false, viewOnly: true }
      };

      await addDoc(membersRef, {
        email,
        uid,
        name,
        role,
        permissions: permissions[role],
        businessId,
        invitedBy: user.email,
        status,
        createdAt: serverTimestamp()
      });

      invitePartnerForm.reset();
      loadPartners();
    });
  }

  /* =========================
     LOAD PARTNERS
  ========================= */
  async function loadPartners() {
    if (!partnersList) return;

    const snap = await getDocs(
      query(membersRef, where("businessId", "==", businessId))
    );

    partnersList.innerHTML = "";

    snap.forEach(d => {
      const p = d.data();
      partnersList.innerHTML += `
        <div class="partner-row">
          ${p.email} — <strong>${p.role}</strong>
          ${p.status === "pending" ? "(Pending)" : ""}
        </div>
      `;
    });
  }

  loadPartners();

  /* =========================
     LOGOUT (SAFE – NOT BROKEN)
  ========================= */
  const logoutBtn = document.querySelector(".logout-btn");

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "signup.html";
    });
  }
});
