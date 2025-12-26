// assets/js/signup.js
import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  setDoc,
  collection
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const form = document.getElementById("signupForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const businessName = document.getElementById("businessName").value;

  try {
    // 1️⃣ Create auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // 2️⃣ Update display name
    await updateProfile(cred.user, { displayName: name });

    // 3️⃣ Create business
    const businessRef = doc(collection(db, "businesses"));

    await setDoc(businessRef, {
      name: businessName,
      ownerId: cred.user.uid,
      createdAt: Date.now()
    });

    // 4️⃣ Create user profile
    await setDoc(doc(db, "users", cred.user.uid), {
      name,
      email,
      role: "owner",
      businessId: businessRef.id,
      createdAt: Date.now()
    });

    window.location.href = "setup.html";

  } catch (err) {
    alert(err.message);
  }
});