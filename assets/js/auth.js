import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
  doc,
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
   GOOGLE AUTH
========================= */
async function handleGoogleAuth() {
  try {
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth, provider);
    const user = userCredential.user;

    // Check if user document exists
    const userDocRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userDocRef);

    if (!userSnapshot.exists()) {
      // Create user document for new signups
      await setDoc(userDocRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || 'Google User',
        role: "owner",
        businessId: null,
        createdAt: serverTimestamp()
      });
    }
    // Auth listener will handle the redirect
  } catch (err) {
    console.error("Google Auth Error:", err);
    showMessage(err.message || "Google Login failed");
  }
}

const googleLogin = document.getElementById("googleLogin");
const googleSignUp = document.getElementById("googleSignUp");

if (googleLogin) googleLogin.addEventListener("click", handleGoogleAuth);
if (googleSignUp) googleSignUp.addEventListener("click", handleGoogleAuth);

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
      doc(db, "businessMembers", membership.id),
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
