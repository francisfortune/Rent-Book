import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
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
   FIND BUSINESS MEMBER BY EMAIL
========================= */
async function getMembershipByEmail(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
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

    const email = registerForm.registerEmail.value.trim();
    const password = registerForm.registerPassword.value;

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      // redirect handled by auth listener
    } catch (err) {
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

    const email = loginForm.loginEmail.value.trim();
    const password = loginForm.loginPassword.value;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // redirect handled by auth listener
    } catch {
      showMessage("Invalid login details");
    } finally {
      setLoading(btn, false);
    }
  });
}

/* =========================
   AUTH STATE — ACCEPT INVITE
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const membership = await getMembershipByEmail(user.email);

  if (!membership) {
    // New user, no invite
    window.location.href = "setup.html";
    return;
  }

  // Accept invite if pending
  if (membership.status === "pending") {
    await updateDoc(
      collection(db, "businessMembers").doc(membership.id),
      {
        status: "accepted",
        uid: user.uid,
        joinedAt: serverTimestamp()
      }
    );
  }

  window.location.href = "dashboard.html";
});

/* =========================
   PASSWORD RESET
========================= */
window.resetPassword = async function () {
  const email = document.getElementById("loginEmail")?.value.trim();
  if (!email) return showMessage("Enter your email first");

  await sendPasswordResetEmail(auth, email);
  showMessage("Password reset email sent");
};
