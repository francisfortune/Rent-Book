// assets/js/avatar.js
import { auth, db } from "./firebase.js";
import { getBusinessIdByEmail } from "./shared.js";
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
   SET AVATAR LETTER
========================= */
async function setAvatar() {
  const avatarEl = document.getElementById("user-avatar");
  if (!avatarEl) return;

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const businessId = await getBusinessIdByEmail(user.email, user).catch(() => null);
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
