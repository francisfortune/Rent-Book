// assets/js/signup.js
import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const form = document.getElementById("signupForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value.toLowerCase();
  const password = document.getElementById("password").value;
  const businessName = document.getElementById("businessName").value;

  try {
    // 1️⃣ Create auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // 2️⃣ Update display name
    await updateProfile(cred.user, { displayName: name });

    // 🔴 OLD: Immediately create business
    /*
    const businessRef = doc(collection(db, "businesses"));
    await setDoc(businessRef, {
      name: businessName,
      ownerId: cred.user.uid,
      createdAt: Date.now()
    });
    */

    // 3️⃣ Create user profile
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      name,
      email,
      createdAt: Date.now()
    });

    // ✅ NEW: Check pending invites
    const pendingSnap = await getDocs(
      query(
        collection(db, "businessMembers"),
        where("email", "==", email),
        where("uid", "==", null)
      )
    );

    if (!pendingSnap.empty) {
      for (const d of pendingSnap.docs) {
        await updateDoc(doc(db, "businessMembers", d.id), {
          uid: cred.user.uid,
          status: "accepted"
        });
      }

      window.location.href = "dashboard.html";
      return;
    }

    // ✅ NEW: Only create business if no invite exists
    const businessRef = doc(collection(db, "businesses"));

    await setDoc(businessRef, {
      name: businessName,
      ownerId: cred.user.uid,
      createdAt: Date.now()
    });

    await setDoc(doc(collection(db, "businessMembers")), {
      email,
      uid: cred.user.uid,
      name,
      role: "admin",
      businessId: businessRef.id,
      status: "accepted",
      createdAt: Date.now()
    });

    window.location.href = "setup.html";

  } catch (err) {
    alert(err.message);
  }
});
