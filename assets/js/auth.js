// user/assets/js/auth.js
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
   HELPERS
========================= */
function showMessage(msg, type = "info") {
  alert(msg); // simple & reliable (can upgrade later)
}

function setLoading(btn, isLoading) {
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Please wait..." : btn.dataset.text;
}

/* =========================
   BUSINESS CHECK
========================= */
async function checkBusinessMembership(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );

  const snapshot = await getDocs(q);

  if (!snapshot.empty) {
    // user already belongs to a business
    return snapshot.docs[0].data().businessId;
  }

  return null; // no business yet
}

/* =========================
   REGISTER
========================= */
const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = registerForm.querySelector("button");
    btn.dataset.text = btn.textContent;
    setLoading(btn, true);

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;

    try {
      // 1️⃣ Create account
      const cred = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      // 2️⃣ Check if user was already invited to a business
      const businessId = await checkBusinessMembership(email);

      showMessage("Account created successfully ✅");

      // 3️⃣ Redirect
      if (businessId) {
        window.location.href = "dashboard.html";
      } else {
        window.location.href = "setup.html";
      }
    } catch (err) {
      showMessage(err.message, "error");
    } finally {
      setLoading(btn, false);
    }
  });
}

/* =========================
   LOGIN
========================= */
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = loginForm.querySelector("button");
    btn.dataset.text = btn.textContent;
    setLoading(btn, true);

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
      // 1️⃣ Sign in
      await signInWithEmailAndPassword(auth, email, password);

      // 2️⃣ Check business
      const businessId = await checkBusinessMembership(email);

      showMessage("Login successful ✅");

      // 3️⃣ Redirect
      if (businessId) {
        window.location.href = "dashboard.html";
      } else {
        window.location.href = "setup.html";
      }
    } catch (err) {
      showMessage("Invalid login details ❌", "error");
    } finally {
      setLoading(btn, false);
    }
  });
}

/* =========================
   FORGOT PASSWORD
========================= */
window.resetPassword = async function (email) {
  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("Password reset email sent 📩");
  } catch (err) {
    showMessage(err.message, "error");
  }
};
