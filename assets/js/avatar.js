// assets/js/avatar.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
   GET BUSINESS ID
========================= */
async function getBusinessIdByEmail(email) {
  const user = auth.currentUser;
  if (!user) return null;
  const cacheKey = `businessId_${user.uid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

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
    if (!snap.empty) businessId = snap.docs[0].data().businessId;
  }
  if (!businessId && user.phoneNumber) {
    const q = query(
      collection(db, "businessMembers"),
      where("phone", "==", user.phoneNumber.trim())
    );
    const snap = await getDocs(q);
    if (!snap.empty) businessId = snap.docs[0].data().businessId;
  }

  if (businessId) {
    localStorage.setItem(cacheKey, businessId);
  }
  return businessId;
}

/* =========================
   SET AVATAR LETTER
========================= */
async function setAvatar() {
  const avatarEl = document.getElementById("user-avatar");
  if (!avatarEl) return;

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const businessId = await getBusinessIdByEmail(user.email);
    if (!businessId) return;

    const businessSnap = await getDoc(
      doc(db, "businesses", businessId)
    );

    if (!businessSnap.exists()) return;

    const business = businessSnap.data();
    avatarEl.textContent =
      business.name.charAt(0).toUpperCase();
  });
}

setAvatar();
