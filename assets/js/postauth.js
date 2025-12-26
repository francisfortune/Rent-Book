import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  try {
    // 1️⃣ Check if user OWNS a business
    const ownerQuery = query(
      collection(db, "businesses"),
      where("ownerId", "==", user.uid)
    );

    const ownerSnap = await getDocs(ownerQuery);
    if (!ownerSnap.empty) {
      window.location.href = "dashboard.html";
      return;
    }

    // 2️⃣ Check if user is PARTNER
    const partnerQuery = query(
      collection(db, "businesses"),
      where("partners", "array-contains", user.email)
    );

    const partnerSnap = await getDocs(partnerQuery);
    if (!partnerSnap.empty) {
      window.location.href = "dashboard.html";
      return;
    }

    // 3️⃣ No business → setup
    window.location.href = "setup.html";

  } catch (err) {
    console.error("Routing error:", err);
    alert("Unable to load account");
  }
});
