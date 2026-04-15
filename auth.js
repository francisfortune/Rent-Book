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



// async function initFCM(user, businessId) {
//   try {
//     const permission = await Notification.requestPermission();
//     if (permission !== "granted") return;

//     const token = await getToken(messaging, {
//       vapidKey: "YOUR_VAPID_KEY_HERE"
//     });

//     console.log("FCM Token:", token);

//     // Save token to Firestore (VERY IMPORTANT)
//     const userRef = doc(db, "businessMembers", user.uid);

//     await updateDoc(userRef, {
//       fcmTokens: arrayUnion(token)
//     });

//   } catch (err) {
//     console.error("FCM error:", err);
//   }
// }





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

/* =========================
   PASSWORD RESET MODAL
========================= */
document.addEventListener("DOMContentLoaded", () => {
  const resetModal = document.getElementById("resetModal");
  const forgotPassword = document.getElementById("forgotPassword");
  const closeReset = document.getElementById("closeReset");
  const sendResetBtn = document.getElementById("sendReset");

  if (!resetModal || !forgotPassword || !closeReset || !sendResetBtn) {
    console.error("Reset modal elements not found");
    return;
  }

  // Open modal when user clicks "Forgot Password?"
  forgotPassword.addEventListener("click", (e) => {
    e.preventDefault();
    resetModal.classList.remove("hidden");
    resetModal.classList.add("flex");
  });

  // Close modal when user clicks "Cancel"
  closeReset.addEventListener("click", () => {
    resetModal.classList.add("hidden");
  });

  // Send password reset email
  sendResetBtn.addEventListener("click", async () => {
    const email = document.getElementById("resetEmail").value.trim();

    if (!email) {
      alert("Please enter your email.");
      return;
    }

    try {
      // Try sending the reset email
      await sendPasswordResetEmail(auth, email);

      // Success message
alert("A password reset link has been sent to your email address. Kindly check your inbox and spam folder.");
      resetModal.classList.add("hidden");

    } catch (error) {
      console.error("Reset error:", error);

      // If the account doesn't exist or is Google-only
      if (error.code === "auth/user-not-found") {
        alert("No password set for this account. Try logging in with Google.");
      } else {
        alert(error.message);
      }
    }
  });
});

import { fetchSignInMethodsForEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

sendResetBtn.addEventListener("click", async () => {
  const email = document.getElementById("resetEmail").value.trim();
  if (!email) return alert("Please enter your email.");

  try {
    const methods = await fetchSignInMethodsForEmail(auth, email);

    if (methods.includes("google.com")) {
      alert("This account uses Google Sign-In. Use the Google login button.");
      return;
    }

    if (!methods.includes("password")) {
      alert("No password set for this account. Try logging in with Google.");
      return;
    }

    await sendPasswordResetEmail(auth, email);
    alert("📧 Reset link sent. Check your email.");
    resetModal.classList.add("hidden");

  } catch (error) {
    console.error("Reset error:", error);
    alert(error.message);
  }
});