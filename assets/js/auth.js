// assets/js/auth.js
import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
   HELPERS
========================= */
function showMessage(msg) {
  alert(msg);
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait..." : "Submit";
}

/* =========================
   BUSINESS MEMBERSHIP CHECK
========================= */
async function getBusinessIdByEmail(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );

  const snap = await getDocs(q);

  if (snap.empty) return null;

  return snap.docs[0].data().businessId;
}

/* =========================
   REGISTER
========================= */
const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = registerForm.querySelector("button");
    setLoading(btn, true);

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;

    try {
      // 1️⃣ Create Auth user
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // 2️⃣ Create Firestore user doc
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        name,
        email,
        createdAt: serverTimestamp()
      });

      // 3️⃣ Check business membership
      const businessId = await getBusinessIdByEmail(email);

      // 4️⃣ Redirect
      if (businessId) {
        window.location.href = "dashboard.html";
      } else {
        window.location.href = "setup.html";
      }

    } catch (err) {
      console.error(err);
      showMessage(err.message);
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
    setLoading(btn, true);

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
      await signInWithEmailAndPassword(auth, email, password);

      const businessId = await getBusinessIdByEmail(email);

      if (businessId) {
        window.location.href = "dashboard.html";
      } else {
        window.location.href = "setup.html";
      }

    } catch (err) {
      console.error(err);
      showMessage("Invalid login details");
    } finally {
      setLoading(btn, false);
    }
  });
}

/* =========================
   PASSWORD RESET
========================= */
window.resetPassword = async function () {
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) return showMessage("Enter your email first");

  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("Password reset email sent");
  } catch (err) {
    showMessage(err.message);
  }
};
