// assets/js/auth.js

import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
   REGISTER USER
========================= */

const registerForm = document.getElementById("registerForm");

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault(); // stop page refresh

  // READ INPUTS (this is why IDs matter)
  const name = document.getElementById("registerName").value;
  const email = document.getElementById("registerEmail").value;
  const password = document.getElementById("registerPassword").value;

  try {
    // 1️⃣ Create auth account
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    const user = userCredential.user;

    // 2️⃣ Save extra info to Firestore
    await setDoc(doc(db, "users", user.uid), {
      name: name,
      email: email,
      createdAt: new Date()
    });

    // 3️⃣ Redirect to setup
    window.location.href = "user/setup.html";

  } catch (error) {
    alert(error.message);
  }
});

/* =========================
   LOGIN USER
========================= */

const loginForm = document.getElementById("loginForm");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "user/dashboard.html";
  } catch (error) {
    alert("Login failed");
  }
});

/* =========================
   SESSION PERSISTENCE
========================= */

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User still logged in:", user.uid);
  }
});
