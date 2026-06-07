import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  RecaptchaVerifier,
  signInWithPhoneNumber
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
async function getMembershipByEmail(email, rawEmail = null) {
  const emailLower = email.toLowerCase().trim();
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", emailLower)
  );
  let snap = await getDocs(q);
  if (snap.empty && rawEmail && rawEmail.trim() !== emailLower) {
    const qRaw = query(
      collection(db, "businessMembers"),
      where("email", "==", rawEmail.trim())
    );
    snap = await getDocs(qRaw);
  }
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/* =========================
   OTP AND PHONE HANDLERS
========================= */
let registerConfirmationResult = null;
let loginConfirmationResult = null;
let recaptchaVerifier = null;

function initRecaptcha() {
  if (recaptchaVerifier) return;
  recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    size: 'invisible'
  });
}

const sendRegisterOtpBtn = document.getElementById("sendRegisterOtpBtn");
if (sendRegisterOtpBtn) {
  sendRegisterOtpBtn.addEventListener("click", async () => {
    const phoneInput = document.getElementById("registerPhone");
    const countryCode = document.getElementById("registerCountryCode").value;
    const phone = phoneInput.value.trim();
    if (!phone) return alert("Please enter your phone number.");
    const fullPhone = countryCode + phone.replace(/^0+/, '');
    
    try {
      initRecaptcha();
      sendRegisterOtpBtn.disabled = true;
      sendRegisterOtpBtn.textContent = "Sending...";
      registerConfirmationResult = await signInWithPhoneNumber(auth, fullPhone, recaptchaVerifier);
      alert("Verification code sent to " + fullPhone + " ✅");
      document.getElementById("registerOtpContainer").classList.remove("hidden");
      sendRegisterOtpBtn.textContent = "Resend SMS Code";
      sendRegisterOtpBtn.disabled = false;
    } catch (err) {
      console.error(err);
      alert("Error sending verification SMS: " + err.message);
      sendRegisterOtpBtn.disabled = false;
      sendRegisterOtpBtn.textContent = "Send Verification SMS";
    }
  });
}

const sendLoginOtpBtn = document.getElementById("sendLoginOtpBtn");
if (sendLoginOtpBtn) {
  sendLoginOtpBtn.addEventListener("click", async () => {
    const phoneInput = document.getElementById("loginPhone");
    const countryCode = document.getElementById("loginCountryCode").value;
    const phone = phoneInput.value.trim();
    if (!phone) return alert("Please enter your phone number.");
    const fullPhone = countryCode + phone.replace(/^0+/, '');
    
    try {
      initRecaptcha();
      sendLoginOtpBtn.disabled = true;
      sendLoginOtpBtn.textContent = "Sending...";
      loginConfirmationResult = await signInWithPhoneNumber(auth, fullPhone, recaptchaVerifier);
      alert("Verification code sent to " + fullPhone + " ✅");
      document.getElementById("loginOtpContainer").classList.remove("hidden");
      sendLoginOtpBtn.textContent = "Resend SMS Code";
      sendLoginOtpBtn.disabled = false;
    } catch (err) {
      console.error(err);
      alert("Error sending verification SMS: " + err.message);
      sendLoginOtpBtn.disabled = false;
      sendLoginOtpBtn.textContent = "Send Verification SMS";
    }
  });
}

/* =========================
   REGISTER
========================= */
const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const authMethod = document.getElementById("registerAuthMethod").value;
    const btn = registerForm.querySelector("button[type='submit']");
    setLoading(btn, true);

    const name = document.getElementById("registerName").value.trim();

    if (authMethod === 'email') {
      const email = registerForm.registerEmail.value.trim();
      const password = registerForm.registerPassword.value;

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          email: email,
          name: name,
          role: "owner",
          businessId: null,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        showMessage(err.message);
        setLoading(btn, false);
      }
    } else {
      const otp = document.getElementById("registerOtp").value.trim();
      if (!otp) {
        alert("Please enter the verification OTP code.");
        setLoading(btn, false);
        return;
      }
      if (!registerConfirmationResult) {
        alert("Please request verification SMS first.");
        setLoading(btn, false);
        return;
      }
      
      try {
        const userCredential = await registerConfirmationResult.confirm(otp);
        const user = userCredential.user;
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          phone: user.phoneNumber,
          name: name,
          role: "owner",
          businessId: null,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        showMessage("Invalid verification code: " + err.message);
        setLoading(btn, false);
      }
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

    const authMethod = document.getElementById("loginAuthMethod").value;
    const btn = loginForm.querySelector("button[type='submit']");
    setLoading(btn, true);

    if (authMethod === 'email') {
      const email = loginForm.loginEmail.value.trim();
      const password = loginForm.loginPassword.value;

      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch {
        showMessage("Invalid login details");
        setLoading(btn, false);
      }
    } else {
      const otp = document.getElementById("loginOtp").value.trim();
      if (!otp) {
        alert("Please enter the verification OTP code.");
        setLoading(btn, false);
        return;
      }
      if (!loginConfirmationResult) {
        alert("Please request verification SMS first.");
        setLoading(btn, false);
        return;
      }
      
      try {
        await loginConfirmationResult.confirm(otp);
      } catch (err) {
        showMessage("Invalid verification code: " + err.message);
        setLoading(btn, false);
      }
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
if (googleSignUp) googleSignUp.addEventListener("click", handleGoogleAuth);/* =========================
   AUTH STATE — ACCEPT INVITE
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  let membership = null;

  try {
    if (user.email) {
      membership = await getMembershipByEmail(user.email.toLowerCase().trim(), user.email);
    }
    if (!membership && user.phoneNumber) {
      const q = query(
        collection(db, "businessMembers"),
        where("phone", "==", user.phoneNumber.trim())
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        membership = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }
    }
    if (!membership) {
      // Look up if there's any businessMembers where uid matches
      const q = query(
        collection(db, "businessMembers"),
        where("uid", "==", user.uid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        membership = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }
    }
  } catch (err) {
    console.error("Error checking membership on login:", err);
  }

  if (!membership) {
    // New user, no invite
    window.location.href = "setup.html";
    return;
  }

  // Accept invite if pending
  if (membership.status === "pending") {
    try {
      await updateDoc(
        doc(db, "businessMembers", membership.id),
        {
          status: "accepted",
          uid: user.uid,
          joinedAt: serverTimestamp()
        }
      );
    } catch (err) {
      console.error("Error accepting invite:", err);
    }
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