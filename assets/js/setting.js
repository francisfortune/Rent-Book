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
  const invitePartnerForm = document.getElementById("invitePartnerForm");
  const partnerEmail = document.getElementById("partnerEmail");
  const partnerRole = document.getElementById("partnerRole");
  const partnersList = document.getElementById("partnersList");

  /* =========================
     INVITE PARTNER
  ========================= */
  invitePartnerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = partnerEmail.value.trim().toLowerCase();
    const role = partnerRole.value;

    // 1. Check if user exists on the platform
    const userQuery = query(collection(db, "users"), where("email", "==", email));
    const userSnap = await getDocs(userQuery);

    if (userSnap.empty) {
      alert("This user is not registered on Rent Book. They must create an account first.");
      return;
    }

    const inviteeData = userSnap.docs[0].data();

    // 2. Prevent duplicate invite in this business
    const exists = await getDocs(
      query(membersRef,
        where("email", "==", email),
        where("businessId", "==", businessId)
      )
    );

    if (!exists.empty) {
      alert("This partner is already added to your business.");
      return;
    }

    // 3. Define permissions and add partner
    const permissions = {
      admin: { inventory: true, bookings: true, settings: true, reports: true },
      staff: { inventory: true, bookings: true, settings: false, reports: false },
      viewer: { inventory: false, bookings: false, settings: false, reports: false, viewOnly: true }
    };

    await addDoc(membersRef, {
      email,
      uid: inviteeData.uid,
      name: inviteeData.name || "User",
      role: role,
      permissions: permissions[role],
      businessId,
      invitedBy: user.email,
      status: "accepted", // Since they already exist, we can auto-accept or keep as pending
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
