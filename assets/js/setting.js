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
  invitePartnerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = partnerEmail.value.trim().toLowerCase();
    const role = partnerRole.value;

    // 🔴 OLD: Only allowed registered users
    /*
    const userQuery = query(collection(db, "users"), where("email", "==", email));
    const userSnap = await getDocs(userQuery);

    if (userSnap.empty) {
      alert("This user is not registered on Rent Book.");
      return;
    }

    const inviteeData = userSnap.docs[0].data();
    */

    // ✅ NEW: Prevent duplicate invite
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

    // ✅ NEW: Check if user exists (optional)
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

    // 🔴 OLD permissions (kept)
    const permissions = {
      admin: { inventory: true, bookings: true, settings: true, reports: true },
      staff: { inventory: true, bookings: true, settings: false, reports: false },
      viewer: { inventory: false, bookings: false, settings: false, reports: false, viewOnly: true }
    };

    // 🔴 OLD addDoc replaced by conditional invite
    /*
    await addDoc(membersRef, {
      email,
      uid: inviteeData.uid,
      name: inviteeData.name || "User",
      role,
      permissions: permissions[role],
      businessId,
      invitedBy: user.email,
      status: "accepted",
      createdAt: serverTimestamp()
    });
    */

    // ✅ NEW: Works for registered + unregistered users
    await addDoc(membersRef, {
      email,
      uid, // null if not registered
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
        <div class="partne
